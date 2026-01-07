/**
 * Test the fixed CCR-v1 calculation against known UI values
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

interface Resolution {
  resolved: boolean;
  payout: number;
}

function updateWithBuy(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;
  const numerator = pos.avgPrice * pos.amount + price * amount;
  const denominator = pos.amount + amount;
  return {
    amount: pos.amount + amount,
    avgPrice: denominator > 0 ? numerator / denominator : 0,
    realizedPnl: pos.realizedPnl,
  };
}

function updateWithSell(pos: Position, price: number, amount: number): Position {
  const adjustedAmount = Math.min(pos.amount, amount);
  if (adjustedAmount < 0.01) return pos;
  const deltaPnL = adjustedAmount * (price - pos.avgPrice);
  return {
    amount: pos.amount - adjustedAmount,
    avgPrice: pos.avgPrice,
    realizedPnl: pos.realizedPnl + deltaPnL,
  };
}

const resolutionCache = new Map<string, Resolution>();

async function loadAllResolutions(): Promise<void> {
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
  console.log(`Loaded ${resolutionCache.size} token resolutions\n`);
}

async function calcCCR1PnL(wallet: string): Promise<{
  realized_pnl: number;
  unrealized_pnl: number;
  trade_count: number;
}> {
  // FIXED: Use pm_trader_events_v2 directly with GROUP BY event_id
  const q = `
    SELECT
      any(f.transaction_hash) as transaction_hash,
      any(f.token_id) as token_id,
      any(f.side) as side,
      any(f.token_amount) / 1e6 as tokens,
      any(f.usdc_amount) / 1e6 as usdc,
      any(f.trade_time) as trade_time,
      any(m.condition_id) as condition_id,
      any(m.outcome_index) as outcome_index
    FROM pm_trader_events_v2 f
    INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    WHERE lower(f.trader_wallet) = lower('${wallet}')
      AND f.is_deleted = 0
    GROUP BY f.event_id
    ORDER BY transaction_hash, condition_id, outcome_index, trade_time
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rawFills = (await r.json()) as any[];

  // Paired-outcome normalization
  type Fill = {
    transaction_hash: string;
    token_id: string;
    side: string;
    tokens: number;
    usdc: number;
    trade_time: string;
    condition_id: string;
    outcome_index: number;
    isPairedHedgeLeg?: boolean;
  };

  const fills: Fill[] = rawFills.map((f) => ({
    transaction_hash: f.transaction_hash,
    token_id: f.token_id,
    side: f.side,
    tokens: Number(f.tokens),
    usdc: Number(f.usdc),
    trade_time: f.trade_time,
    condition_id: f.condition_id?.toLowerCase(),
    outcome_index: Number(f.outcome_index),
  }));

  // Group by (tx_hash, condition_id)
  const groups = new Map<string, Fill[]>();
  for (const f of fills) {
    const key = `${f.transaction_hash}_${f.condition_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const PAIRED_EPSILON = 1.0;
  for (const [, group] of groups) {
    const outcomes = new Set(group.map((g) => g.outcome_index));
    if (!outcomes.has(0) || !outcomes.has(1) || group.length < 2) continue;

    const o0 = group.filter((g) => g.outcome_index === 0);
    const o1 = group.filter((g) => g.outcome_index === 1);

    for (const a of o0) {
      for (const b of o1) {
        const opposite = a.side !== b.side;
        const amountMatch = Math.abs(a.tokens - b.tokens) <= PAIRED_EPSILON;
        if (opposite && amountMatch) {
          if (a.side === 'sell') a.isPairedHedgeLeg = true;
          else b.isPairedHedgeLeg = true;
          break;
        }
      }
    }
  }

  const normalizedFills = fills.filter((f) => !f.isPairedHedgeLeg);
  normalizedFills.sort((a, b) => {
    if (a.trade_time < b.trade_time) return -1;
    if (a.trade_time > b.trade_time) return 1;
    return a.transaction_hash.localeCompare(b.transaction_hash);
  });

  const positions = new Map<string, Position>();

  for (const trade of normalizedFills) {
    const key = trade.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;

    if (trade.side === 'buy') {
      pos = updateWithBuy(pos, price, trade.tokens);
    } else if (trade.side === 'sell') {
      pos = updateWithSell(pos, price, trade.tokens);
    }
    positions.set(key, pos);
  }

  let tradingPnl = 0;
  let resolutionPnl = 0;
  let unrealizedPnl = 0;

  for (const [tokenId, pos] of positions) {
    tradingPnl += pos.realizedPnl;

    if (pos.amount > 0.01) {
      const res = resolutionCache.get(tokenId);
      if (res?.resolved) {
        resolutionPnl += pos.amount * (res.payout - pos.avgPrice);
      } else {
        unrealizedPnl += pos.amount * (0.5 - pos.avgPrice);
      }
    }
  }

  return {
    realized_pnl: tradingPnl + resolutionPnl,
    unrealized_pnl: unrealizedPnl,
    trade_count: normalizedFills.length,
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
  console.log('='.repeat(80));
  console.log('TESTING FIXED CCR-v1 (using pm_trader_events_v2 with GROUP BY event_id)');
  console.log('='.repeat(80));

  await loadAllResolutions();

  console.log('Wallet           | CCR-v1 Realized | UI Total   | Diff      | % Diff');
  console.log('-'.repeat(80));

  for (const w of testWallets) {
    const pnl = await calcCCR1PnL(w.addr);
    const diff = pnl.realized_pnl - w.ui;
    const pctDiff = w.ui !== 0 ? ((diff / Math.abs(w.ui)) * 100).toFixed(1) : 'N/A';

    const ccr1Str = ('$' + pnl.realized_pnl.toFixed(0)).padStart(15);
    const uiStr = ('$' + w.ui.toFixed(0)).padStart(10);
    const diffStr = ('$' + diff.toFixed(0)).padStart(9);

    console.log(`${w.name.padEnd(16)} | ${ccr1Str} | ${uiStr} | ${diffStr} | ${pctDiff}%`);
  }

  console.log('-'.repeat(80));
  console.log('NOTE: UI Total includes unrealized. CCR-v1 is realized-only.');
}

main().catch(console.error);
