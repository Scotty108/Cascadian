/**
 * Debug Cashflow - Track USDC and token flows
 *
 * Key insight: For PnL, we need to track:
 * 1. Cash paid (buys) - negative
 * 2. Cash received (sells) - positive
 * 3. Current position value (tokens * resolution or mark price)
 *
 * PnL = cash_received - cash_paid + current_position_value
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

interface Trade {
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  price: number;
  tokens: number;
  usdc: number;
  ts: number;
}

async function getTrades(wallet: string): Promise<Trade[]> {
  const w = wallet.toLowerCase();

  const query = `
    SELECT
      substring(t.event_id, 1, 66) as tx_hash,
      m.condition_id,
      m.outcome_index,
      t.side,
      max(t.usdc_amount) / max(t.token_amount) as price,
      max(t.token_amount) / 1000000.0 as tokens,
      max(t.usdc_amount) / 1000000.0 as usdc,
      max(toUnixTimestamp(t.trade_time)) as ts
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${w}'
      AND m.condition_id IS NOT NULL
      AND m.condition_id != ''
    GROUP BY tx_hash, m.condition_id, m.outcome_index, t.side
    ORDER BY ts ASC, tx_hash ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => ({
    tx_hash: r.tx_hash,
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    side: r.side.toLowerCase(),
    price: Number(r.price),
    tokens: Number(r.tokens),
    usdc: Number(r.usdc),
    ts: Number(r.ts),
  }));
}

async function fetchApiPnl(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && data.length > 0) return data[data.length - 1].p;
    }
  } catch {}
  return null;
}

async function analyze(wallet: string) {
  console.log(`\n=== CASHFLOW ANALYSIS FOR ${wallet} ===\n`);

  const [trades, apiPnl] = await Promise.all([
    getTrades(wallet),
    fetchApiPnl(wallet)
  ]);

  console.log(`Total trades: ${trades.length}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Simple approach: track cash in/out and final token positions
  // PnL = cash_received - cash_paid + position_value_at_resolution

  let totalCashPaid = 0;     // for buys
  let totalCashReceived = 0;  // for sells

  interface Position {
    tokens: number;  // net tokens held
    cashPaid: number;
    cashReceived: number;
  }

  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const posKey = `${trade.condition_id}_${trade.outcome_index}`;

    let pos = positions.get(posKey);
    if (!pos) {
      pos = { tokens: 0, cashPaid: 0, cashReceived: 0 };
      positions.set(posKey, pos);
    }

    if (trade.side === 'buy') {
      pos.tokens += trade.tokens;
      pos.cashPaid += trade.usdc;
      totalCashPaid += trade.usdc;
    } else {
      pos.tokens -= trade.tokens;
      pos.cashReceived += trade.usdc;
      totalCashReceived += trade.usdc;
    }
  }

  console.log(`\n=== AGGREGATE CASHFLOW ===`);
  console.log(`Total cash paid (buys):     $${totalCashPaid.toFixed(2)}`);
  console.log(`Total cash received (sells): $${totalCashReceived.toFixed(2)}`);
  console.log(`Net cash flow:              $${(totalCashReceived - totalCashPaid).toFixed(2)}`);

  // Get resolutions
  const conditionIds = Array.from(new Set(Array.from(positions.keys()).map(k => k.split('_')[0])));
  const idList = conditionIds.map(id => `'${id}'`).join(',');

  let resolutions = new Map<string, number[]>();
  if (conditionIds.length > 0) {
    const query = `
      SELECT lower(condition_id) as condition_id, norm_prices
      FROM pm_condition_resolutions_norm
      WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0
    `;
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as { condition_id: string; norm_prices: number[] }[];
    for (const row of rows) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }

  // Calculate position values at resolution
  let totalPositionValue = 0;
  let unresolvedPositions: string[] = [];

  console.log(`\n=== POSITION VALUES ===`);
  console.log('condition_id         | idx | tokens  | res_price | value    | cash_in | cash_out | net_cash');
  console.log('-'.repeat(100));

  for (const [posKey, pos] of positions) {
    const [conditionId, outcomeIndexStr] = posKey.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr);

    const prices = resolutions.get(conditionId);
    let resPrice = 0;
    let resolved = false;

    if (prices && prices.length > outcomeIndex) {
      resPrice = prices[outcomeIndex];
      resolved = true;
    }

    const positionValue = pos.tokens * resPrice;
    totalPositionValue += positionValue;

    if (!resolved && Math.abs(pos.tokens) > 0.1) {
      unresolvedPositions.push(posKey);
    }

    if (Math.abs(pos.tokens) > 0.1 || Math.abs(pos.cashPaid) > 1 || Math.abs(pos.cashReceived) > 1) {
      const netCash = pos.cashReceived - pos.cashPaid;
      console.log(
        `${conditionId.substring(0, 20)}... | ${outcomeIndex}   | ` +
        `${pos.tokens.toFixed(1).padStart(7)} | ` +
        `${resPrice.toFixed(2).padStart(9)} | ` +
        `$${positionValue.toFixed(2).padStart(7)} | ` +
        `$${pos.cashPaid.toFixed(2).padStart(7)} | ` +
        `$${pos.cashReceived.toFixed(2).padStart(7)} | ` +
        `$${netCash.toFixed(2).padStart(7)}`
      );
    }
  }

  console.log(`\nTotal position value at resolution: $${totalPositionValue.toFixed(2)}`);
  console.log(`Unresolved positions: ${unresolvedPositions.length}`);

  // Calculate PnL using cashflow method
  // PnL = cash_received - cash_paid + position_value
  const cashflowPnl = totalCashReceived - totalCashPaid + totalPositionValue;

  console.log(`\n=== PNL COMPARISON ===`);
  console.log(`Cashflow method: $${cashflowPnl.toFixed(2)}`);
  console.log(`  = cash_received ($${totalCashReceived.toFixed(2)})`);
  console.log(`  - cash_paid ($${totalCashPaid.toFixed(2)})`);
  console.log(`  + position_value ($${totalPositionValue.toFixed(2)})`);
  console.log(`\nAPI PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference: $${apiPnl !== null ? (cashflowPnl - apiPnl).toFixed(2) : 'N/A'}`);

  // The key question: where is the $90 difference coming from?
  // Let's look at positions where net tokens != 0 (these contribute to position value)
  console.log(`\n=== POSITIONS WITH NET TOKENS ===`);
  let netTokenPositions = 0;
  let totalNetTokenValue = 0;

  for (const [posKey, pos] of positions) {
    if (Math.abs(pos.tokens) > 0.001) {
      netTokenPositions++;
      const [conditionId, outcomeIndexStr] = posKey.split('_');
      const outcomeIndex = parseInt(outcomeIndexStr);
      const prices = resolutions.get(conditionId);
      const resPrice = prices && prices.length > outcomeIndex ? prices[outcomeIndex] : 0;
      totalNetTokenValue += pos.tokens * resPrice;
    }
  }

  console.log(`Positions with net tokens: ${netTokenPositions}`);
  console.log(`Total net token value: $${totalNetTokenValue.toFixed(2)}`);

  process.exit(0);
}

const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';
analyze(wallet).catch(console.error);
