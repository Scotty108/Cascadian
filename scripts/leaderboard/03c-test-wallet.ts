/**
 * CCR-v1 sanity check for a single wallet (uses the same logic as 03c)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

interface Trade {
  side: string;
  usdc: number;
  tokens: number;
  token_id: string;
  trade_time: string;
  transaction_hash: string;
  condition_id: string;
  outcome_index: number;
  isPairedHedgeLeg?: boolean;
}

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
}

async function calcCCR1(wallet: string) {
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
    FROM pm_trader_events_dedup_v2_tbl f
    INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    WHERE lower(f.trader_wallet) = lower('${wallet}')
    GROUP BY f.event_id
    ORDER BY transaction_hash, condition_id, outcome_index, trade_time
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const fills = (await r.json()) as Trade[];

  // Paired-outcome normalization
  const groups = new Map<string, Trade[]>();
  for (const f of fills) {
    const key = `${f.transaction_hash}_${f.condition_id?.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ ...f, condition_id: f.condition_id?.toLowerCase(), outcome_index: Number(f.outcome_index) });
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

  const normalized = Array.from(groups.values()).flat().filter((f) => !f.isPairedHedgeLeg);
  normalized.sort((a, b) => {
    if (a.trade_time < b.trade_time) return -1;
    if (a.trade_time > b.trade_time) return 1;
    return a.transaction_hash.localeCompare(b.transaction_hash);
  });

  const positions = new Map<string, Position>();
  for (const t of normalized) {
    const key = t.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const price = t.tokens > 0 ? t.usdc / t.tokens : 0;
    if (t.side === 'buy') pos = updateWithBuy(pos, price, t.tokens);
    else if (t.side === 'sell') pos = updateWithSell(pos, price, t.tokens);
    positions.set(key, pos);
  }

  let tradingPnl = 0;
  let resolutionPnl = 0;
  for (const [tokenId, pos] of positions) {
    tradingPnl += pos.realizedPnl;
    if (pos.amount > 0.01) {
      const res = resolutionCache.get(tokenId);
      if (res?.resolved) {
        resolutionPnl += pos.amount * (res.payout - pos.avgPrice);
      }
    }
  }

  return {
    tradingPnl,
    resolutionPnl,
    realized: tradingPnl + resolutionPnl,
    tradeCount: normalized.length,
  };
}

async function main() {
  const wallet = process.argv[2];
  if (!wallet) {
    console.error('Usage: npx tsx scripts/leaderboard/03c-test-wallet.ts <wallet>');
    process.exit(1);
  }
  await loadAllResolutions();
  const res = await calcCCR1(wallet);
  console.log(`Wallet: ${wallet}`);
  console.log(`Trades (normalized): ${res.tradeCount}`);
  console.log(`Trading PnL: $${res.tradingPnl.toFixed(2)}`);
  console.log(`Resolution PnL: $${res.resolutionPnl.toFixed(2)}`);
  console.log(`Realized PnL: $${res.realized.toFixed(2)}`);
}

main().catch(console.error);
