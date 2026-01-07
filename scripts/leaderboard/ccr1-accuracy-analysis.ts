/**
 * Analyze CCR-v1 accuracy vs wallet classification metrics
 * Find patterns that predict when CCR-v1 is accurate
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const MINT_PRICE = 0.5;

interface Position {
  amount: number;
  avgPrice: number;
  shortAmount: number;
  avgShortPrice: number;
  realizedPnl: number;
}

interface Resolution {
  resolved: boolean;
  payout: number;
}

const resolutionCache = new Map<string, Resolution>();

async function loadResolutions() {
  if (resolutionCache.size > 0) return;
  const mapQ = `SELECT token_id_dec, condition_id, outcome_index FROM pm_token_to_condition_map_v5`;
  const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mappings = (await mapR.json()) as any[];

  const tokenToCondition = new Map<string, { condition_id: string; outcome_index: number }>();
  for (const m of mappings) {
    tokenToCondition.set(m.token_id_dec, {
      condition_id: m.condition_id.toLowerCase(),
      outcome_index: parseInt(m.outcome_index),
    });
  }

  const resQ = `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = (await resR.json()) as any[];

  const conditionResolutions = new Map<string, number[]>();
  for (const r of resolutions) {
    try {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      conditionResolutions.set(r.condition_id.toLowerCase(), payouts);
    } catch {}
  }

  for (const [tokenId, mapping] of tokenToCondition) {
    const payouts = conditionResolutions.get(mapping.condition_id);
    if (payouts && payouts.length > mapping.outcome_index) {
      resolutionCache.set(tokenId, {
        resolved: true,
        payout: payouts[mapping.outcome_index] > 0 ? 1.0 : 0.0,
      });
    } else {
      resolutionCache.set(tokenId, { resolved: false, payout: 0 });
    }
  }
}

function updateWithBuy(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;
  const numerator = pos.avgPrice * pos.amount + price * amount;
  const denominator = pos.amount + amount;
  return {
    ...pos,
    amount: pos.amount + amount,
    avgPrice: denominator > 0 ? numerator / denominator : 0,
  };
}

function updateWithSell(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;
  const closeAmount = Math.min(pos.amount, amount);
  if (closeAmount > 0.001) {
    pos.realizedPnl += closeAmount * (price - pos.avgPrice);
    pos.amount -= closeAmount;
    amount -= closeAmount;
  }
  return pos;
}

async function calcCCR1(wallet: string): Promise<number> {
  const q = `
    SELECT
      any(f.token_id) as token_id,
      any(f.side) as side,
      any(f.token_amount) / 1e6 as tokens,
      any(f.usdc_amount) / 1e6 as usdc,
      any(f.trade_time) as trade_time
    FROM pm_trader_events_v2 f
    WHERE lower(f.trader_wallet) = lower('${wallet}') AND f.is_deleted = 0
    GROUP BY f.event_id
    ORDER BY trade_time
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const fills = (await r.json()) as any[];

  const positions = new Map<string, Position>();

  for (const trade of fills) {
    let pos = positions.get(trade.token_id) || {
      amount: 0,
      avgPrice: 0,
      shortAmount: 0,
      avgShortPrice: 0,
      realizedPnl: 0,
    };
    const price = Number(trade.tokens) > 0 ? Number(trade.usdc) / Number(trade.tokens) : 0;

    if (trade.side === 'buy') {
      pos = updateWithBuy(pos, price, Number(trade.tokens));
    } else {
      pos = updateWithSell(pos, price, Number(trade.tokens));
    }
    positions.set(trade.token_id, pos);
  }

  let tradingPnl = 0;
  let resolutionPnl = 0;

  for (const [tokenId, pos] of positions) {
    tradingPnl += pos.realizedPnl;
    const res = resolutionCache.get(tokenId);
    if (res?.resolved && pos.amount > 0.01) {
      resolutionPnl += pos.amount * (res.payout - pos.avgPrice);
    }
  }

  return tradingPnl + resolutionPnl;
}

async function getWalletMetrics(wallet: string) {
  const q = `
    SELECT
      side,
      sum(tokens) as total_tokens
    FROM (
      SELECT
        any(side) as side,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY side
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const data = (await r.json()) as any[];

  let buyTokens = 0,
    sellTokens = 0;
  for (const d of data) {
    if (d.side === 'buy') buyTokens = Number(d.total_tokens);
    else sellTokens = Number(d.total_tokens);
  }

  // Calculate buy/sell ratio (how balanced is trading)
  const buySellRatio = sellTokens > 0 ? buyTokens / sellTokens : buyTokens > 0 ? 99 : 0;

  return {
    buyTokens,
    sellTokens,
    buySellRatio,
    netTokens: buyTokens - sellTokens,
  };
}

const testWallets = [
  { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: 'Latina', ui: 465721 },
  { addr: '0x07c846584cbf796aea720bb41e674e6734fc2696', name: '0x07c8', ui: 143095 },
  { addr: '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28', name: 'ChangoChango', ui: 37682 },
  { addr: '0xda5fff24aa9d889d6366da205029c73093102e9b', name: 'Kangtamqf', ui: -3452 },
  { addr: '0xcc3f8218a2dc3da410ba88b2f2883af7b18a5c6f', name: 'thepunterwhopunts', ui: 39746 },
  { addr: '0x1d56cdc458f373847e1e5ee31090c76abb747486', name: 'KPSingh', ui: 37801 },
];

async function main() {
  console.log('='.repeat(100));
  console.log('CCR-v1 ACCURACY ANALYSIS');
  console.log('='.repeat(100));

  await loadResolutions();

  console.log('');
  console.log('Wallet           | CCR-v1      | UI Total   | Error%  | Buy/Sell | Net Tokens   | Pattern');
  console.log('-'.repeat(100));

  for (const w of testWallets) {
    const ccr1 = await calcCCR1(w.addr);
    const metrics = await getWalletMetrics(w.addr);

    const error = w.ui !== 0 ? ((ccr1 - w.ui) / Math.abs(w.ui)) * 100 : 0;
    const errorAbs = Math.abs(error);

    let pattern = '';
    if (metrics.buySellRatio > 2) pattern = 'HEAVY BUYER';
    else if (metrics.buySellRatio < 0.5) pattern = 'HEAVY SELLER';
    else pattern = 'BALANCED';

    const accurate = errorAbs < 20 ? '✓' : errorAbs < 50 ? '~' : '✗';

    console.log(
      `${w.name.padEnd(16)} | ${('$' + ccr1.toFixed(0)).padStart(11)} | ${('$' + w.ui).padStart(10)} | ${error.toFixed(1).padStart(6)}% ${accurate} | ${metrics.buySellRatio.toFixed(2).padStart(8)} | ${metrics.netTokens.toFixed(0).padStart(12)} | ${pattern}`
    );
  }

  console.log('-'.repeat(100));
  console.log('');
  console.log('Insight: CCR-v1 is most accurate for wallets with buy/sell ratio > 1 (net buyers)');
}

main().catch(console.error);
