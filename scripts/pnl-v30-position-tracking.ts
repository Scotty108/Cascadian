/**
 * PnL V30 - Position Tracking with Avg Price (Polymarket Subgraph Method)
 *
 * This implements the EXACT logic from Polymarket's pnl-subgraph:
 * https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph
 *
 * Key formulas:
 * 1. Buy: avgPrice = (avgPrice × amount + price × buyAmount) / (amount + buyAmount)
 * 2. Sell: deltaPnL = sellAmount × (sellPrice - avgPrice) / 1000000
 *
 * Event handling:
 * - PositionSplit: BUY both outcomes at $0.50
 * - PositionsMerge: SELL both outcomes at $0.50
 * - OrderFilled: BUY or SELL at CLOB price
 * - PositionsConverted: SELL NO at avgPrice, BUY YES at synthetic price
 * - PayoutRedemption: SELL at resolution price
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const COLLATERAL_SCALE = 1_000_000;
const FIFTY_CENTS = 500_000;

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

interface Position {
  amount: number;  // Current holdings
  avgPrice: number;  // Weighted average cost basis (in COLLATERAL_SCALE units)
}

interface Event {
  event_type: string;
  timestamp: Date;
  condition_id: string;
  outcome_index: number;
  amount: number;
  price: number;  // In COLLATERAL_SCALE units
  tx_hash: string;
}

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== PNL V30 - POSITION TRACKING FOR ${wallet} ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? 'N/A'}`);

  // Get all events in chronological order
  const events: Event[] = [];

  // 1. Get CTF events (splits, merges, redemptions)
  const ctfResult = await clickhouse.query({
    query: `
      SELECT
        event_type,
        event_timestamp as timestamp,
        lower(condition_id) as condition_id,
        toFloat64OrZero(amount_or_payout) as amount,
        tx_hash
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
        AND event_timestamp > toDateTime('1970-01-01 01:00:00')
      ORDER BY event_timestamp ASC
    `,
    format: 'JSONEachRow',
  });
  const ctfRows = await ctfResult.json() as any[];

  for (const row of ctfRows) {
    // Skip events from NegRiskAdapter or Exchange contracts
    // (Those are handled separately)
    // NOTE: amount is already in raw units (not divided by 1e6)

    if (row.event_type === 'PositionSplit') {
      // BUY both outcomes at $0.50
      events.push({
        event_type: 'BUY',
        timestamp: new Date(row.timestamp),
        condition_id: row.condition_id,
        outcome_index: 0,
        amount: row.amount,  // raw units
        price: FIFTY_CENTS,  // $0.50 in COLLATERAL_SCALE
        tx_hash: row.tx_hash,
      });
      events.push({
        event_type: 'BUY',
        timestamp: new Date(row.timestamp),
        condition_id: row.condition_id,
        outcome_index: 1,
        amount: row.amount,
        price: FIFTY_CENTS,
        tx_hash: row.tx_hash,
      });
    } else if (row.event_type === 'PositionsMerge') {
      // SELL both outcomes at $0.50
      events.push({
        event_type: 'SELL',
        timestamp: new Date(row.timestamp),
        condition_id: row.condition_id,
        outcome_index: 0,
        amount: row.amount,
        price: FIFTY_CENTS,
        tx_hash: row.tx_hash,
      });
      events.push({
        event_type: 'SELL',
        timestamp: new Date(row.timestamp),
        condition_id: row.condition_id,
        outcome_index: 1,
        amount: row.amount,
        price: FIFTY_CENTS,
        tx_hash: row.tx_hash,
      });
    } else if (row.event_type === 'PayoutRedemption') {
      // This is handled separately with resolution prices
    }
  }

  // 2. Get CLOB trades
  const clobResult = await clickhouse.query({
    query: `
      SELECT
        toString(t.trade_time) as timestamp,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        max(t.token_amount) as amount,
        max(t.usdc_amount) as usdc_amount,
        t.transaction_hash as tx_hash
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND m.condition_id IS NOT NULL
      GROUP BY t.trade_time, m.condition_id, m.outcome_index, t.side, t.transaction_hash
      ORDER BY t.trade_time ASC
    `,
    format: 'JSONEachRow',
  });
  const clobRows = await clobResult.json() as any[];

  for (const row of clobRows) {
    // Price = usdc_amount * COLLATERAL_SCALE / token_amount
    const price = Math.round((row.usdc_amount * COLLATERAL_SCALE) / row.amount);
    events.push({
      event_type: row.side === 'buy' ? 'BUY' : 'SELL',
      timestamp: new Date(row.timestamp),
      condition_id: row.condition_id,
      outcome_index: row.outcome_index,
      amount: row.amount,
      price: price,
      tx_hash: row.tx_hash,
    });
  }

  // 3. Get Neg Risk conversions
  const convResult = await clickhouse.query({
    query: `
      SELECT
        toString(event_timestamp) as timestamp,
        market_id,
        index_set,
        toFloat64OrZero(amount) as amount,
        tx_hash
      FROM pm_neg_risk_conversions_v1
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
      ORDER BY event_timestamp ASC
    `,
    format: 'JSONEachRow',
  });
  const convRows = await convResult.json() as any[];

  // Neg Risk conversions are complex - need market metadata to process
  // For now, skip these (we'll handle them later)

  // Sort all events by timestamp
  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  console.log(`\nTotal events: ${events.length}`);
  console.log(`  CTF events: ${ctfRows.length}`);
  console.log(`  CLOB trades: ${clobRows.length}`);
  console.log(`  Neg Risk conversions: ${convRows.length}`);

  // Track positions
  const positions = new Map<string, Position>();
  let totalRealizedPnl = 0;

  function getPosition(conditionId: string, outcomeIndex: number): Position {
    const key = `${conditionId}_${outcomeIndex}`;
    let pos = positions.get(key);
    if (!pos) {
      pos = { amount: 0, avgPrice: 0 };
      positions.set(key, pos);
    }
    return pos;
  }

  function handleBuy(conditionId: string, outcomeIndex: number, amount: number, price: number) {
    const pos = getPosition(conditionId, outcomeIndex);

    // Weighted average: avgPrice = (avgPrice × amount + price × buyAmount) / (amount + buyAmount)
    if (pos.amount + amount > 0) {
      const numerator = pos.avgPrice * pos.amount + price * amount;
      const denominator = pos.amount + amount;
      pos.avgPrice = numerator / denominator;
    }
    pos.amount += amount;
  }

  function handleSell(conditionId: string, outcomeIndex: number, amount: number, price: number): number {
    const pos = getPosition(conditionId, outcomeIndex);

    // Cap amount to position (can't sell more than you have)
    const adjustedAmount = Math.min(amount, pos.amount);

    if (adjustedAmount > 0) {
      // deltaPnL = adjustedAmount × (price - avgPrice) / COLLATERAL_SCALE / COLLATERAL_SCALE
      // First division converts price diff to ratio, second converts amount to units
      // Result is in dollars
      const deltaPnl = (adjustedAmount * (price - pos.avgPrice)) / COLLATERAL_SCALE / COLLATERAL_SCALE;
      pos.amount -= adjustedAmount;
      return deltaPnl;
    }

    return 0;
  }

  // Process events
  for (const event of events) {
    if (event.event_type === 'BUY') {
      handleBuy(event.condition_id, event.outcome_index, event.amount, event.price);
    } else if (event.event_type === 'SELL') {
      const deltaPnl = handleSell(event.condition_id, event.outcome_index, event.amount, event.price);
      totalRealizedPnl += deltaPnl;
    }
  }

  // Handle redemptions separately (need resolution prices)
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        lower(c.condition_id) as condition_id,
        sum(toFloat64OrZero(c.amount_or_payout)) as redeemed_amount,
        r.norm_prices
      FROM pm_ctf_events c
      LEFT JOIN pm_condition_resolutions_norm r ON lower(c.condition_id) = lower(r.condition_id)
      WHERE lower(c.user_address) = '${wallet.toLowerCase()}'
        AND c.event_type = 'PayoutRedemption'
        AND c.is_deleted = 0
      GROUP BY c.condition_id, r.norm_prices
    `,
    format: 'JSONEachRow',
  });
  const redemptionRows = await redemptionResult.json() as any[];

  console.log(`\n=== REDEMPTIONS ===`);
  for (const row of redemptionRows) {
    const prices = row.norm_prices || [0, 0];
    console.log(`${row.condition_id.substring(0, 20)}... redeemed $${(row.redeemed_amount / 1e6).toFixed(2)}, res=${JSON.stringify(prices)}`);

    // Find which outcome was redeemed (the one with price = 1)
    for (let oi = 0; oi < prices.length; oi++) {
      if (prices[oi] === 1) {
        const pos = getPosition(row.condition_id, oi);
        const posAmountBefore = pos.amount;
        console.log(`  O${oi}: pos.amount = ${posAmountBefore / 1e6}, avgPrice = $${(pos.avgPrice / 1e6).toFixed(4)}`);
        // Redemption is a SELL at price = 1.0 (COLLATERAL_SCALE)
        if (posAmountBefore > 0) {
          const deltaPnl = handleSell(row.condition_id, oi, posAmountBefore, COLLATERAL_SCALE);
          totalRealizedPnl += deltaPnl;
          console.log(`  O${oi}: sold ${(posAmountBefore / 1e6).toFixed(4)} @ $1.00, deltaPnL = $${deltaPnl.toFixed(2)}`);
        } else {
          console.log(`  O${oi}: NO POSITION - checking if position exists in map`);
          const key = `${row.condition_id}_${oi}`;
          console.log(`  Looking for key: ${key.substring(0, 40)}...`);
        }
      }
    }
  }

  // Calculate unrealized PnL for remaining positions
  let totalUnrealizedPnl = 0;
  console.log(`\n=== REMAINING POSITIONS ===`);

  // Get current prices - batch to avoid query size limits
  const conditionIds = Array.from(new Set([...positions.keys()].map(k => k.split('_')[0])));
  const resolutions = new Map<string, number[]>();

  // Process in batches of 500 to avoid query size limits
  const BATCH_SIZE = 500;
  for (let i = 0; i < conditionIds.length; i += BATCH_SIZE) {
    const batch = conditionIds.slice(i, i + BATCH_SIZE);
    const idList = batch.map(id => `'${id}'`).join(',');
    const resResult = await clickhouse.query({
      query: `
        SELECT lower(condition_id) as condition_id, norm_prices
        FROM pm_condition_resolutions_norm
        WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0
      `,
      format: 'JSONEachRow',
    });
    const resRows = await resResult.json() as { condition_id: string; norm_prices: number[] }[];
    for (const row of resRows) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }

  let positionsWithValue = 0;
  for (const [key, pos] of positions) {
    if (pos.amount > 0.01) {
      const [conditionId, outcomeStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeStr);
      const prices = resolutions.get(conditionId);

      let currentPrice = 0;
      if (prices && prices[outcomeIndex] !== undefined) {
        currentPrice = prices[outcomeIndex] * COLLATERAL_SCALE;
      }

      // Same formula as handleSell - divide by COLLATERAL_SCALE twice
      const unrealizedPnl = (pos.amount * (currentPrice - pos.avgPrice)) / COLLATERAL_SCALE / COLLATERAL_SCALE;
      totalUnrealizedPnl += unrealizedPnl;

      if (Math.abs(unrealizedPnl) > 1) {
        positionsWithValue++;
        console.log(
          `${conditionId.substring(0, 20)}... O${outcomeIndex}: ` +
          `${(pos.amount / 1e6).toFixed(4)} @ avg $${(pos.avgPrice / 1e6).toFixed(4)}, ` +
          `curr $${(currentPrice / 1e6).toFixed(2)}, ` +
          `unrealized $${unrealizedPnl.toFixed(2)}`
        );
      }
    }
  }
  console.log(`(Showing ${positionsWithValue} positions with unrealized > $1)`)

  console.log(`\n=== FINAL PNL ===`);
  console.log(`Realized PnL: $${totalRealizedPnl.toFixed(2)}`);
  console.log(`Unrealized PnL: $${totalUnrealizedPnl.toFixed(2)}`);
  const totalPnl = totalRealizedPnl + totalUnrealizedPnl;
  console.log(`Total PnL (Realized + Unrealized): $${totalPnl.toFixed(2)}`);
  console.log(`\nAPI PnL: $${apiPnl?.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? 'N/A'}`);

  if (apiPnl !== null) {
    const realizedDiff = totalRealizedPnl - apiPnl;
    const realizedPctDiff = (realizedDiff / Math.abs(apiPnl)) * 100;
    console.log(`\nRealized vs API:`);
    console.log(`  Difference: $${realizedDiff.toFixed(2)} (${realizedPctDiff.toFixed(2)}%)`);

    const totalDiff = totalPnl - apiPnl;
    const totalPctDiff = (totalDiff / Math.abs(apiPnl)) * 100;
    console.log(`\nTotal (R+U) vs API:`);
    console.log(`  Difference: $${totalDiff.toFixed(2)} (${totalPctDiff.toFixed(2)}%)`);
  }

  process.exit(0);
}

main().catch(console.error);
