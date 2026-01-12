/**
 * PnL V30 - Complete Implementation Using All Data Sources
 *
 * Based on Polymarket's official pnl-subgraph formulas:
 *
 * Data Sources:
 * 1. pm_trader_events_v3 - CLOB trades (OrderFilled)
 * 2. pm_ctf_events - Split, Merge, Redemption events
 * 3. pm_neg_risk_conversions_v1 - PositionsConverted events
 *
 * Formulas:
 * 1. avgPrice = (old_avgPrice × old_amount + buy_price × buy_amount) / new_amount
 * 2. realizedPnL += adjustedAmount × (sell_price - avgPrice) / 1000000
 * 3. Split: Buy both outcomes at $0.50 each
 * 4. Merge: Sell both outcomes at $0.50 each
 * 5. Neg Risk YES price = (noPrice × noCount - 1000000 × (noCount - 1)) / (questionCount - noCount)
 * 6. Redemption: Sell at resolution price
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const COLLATERAL_SCALE = 1000000;  // $1.00
const FIFTY_CENTS = 500000;        // $0.50
const BATCH_SIZE = 1000;           // For batched queries

interface Position {
  amount: number;      // Token balance
  avgPrice: number;    // Cost basis (6 decimals)
  realizedPnl: number; // Cumulative realized PnL
}

interface Event {
  timestamp: number;
  type: 'buy' | 'sell' | 'split' | 'merge' | 'conversion' | 'redemption';
  conditionId: string;
  outcomeIndex: number;
  amount: number;      // Token amount
  price: number;       // Price (6 decimals)
  // For conversions
  conversionData?: {
    indexSet: number;   // Bitmask of outcomes being converted
    questionCount: number;
  };
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

function updatePositionWithBuy(pos: Position, amount: number, price: number): void {
  if (pos.amount + amount > 0) {
    pos.avgPrice = Math.round((pos.avgPrice * pos.amount + price * amount) / (pos.amount + amount));
  }
  pos.amount += amount;
}

function updatePositionWithSell(pos: Position, amount: number, price: number): void {
  const adjustedAmount = Math.min(amount, Math.max(0, pos.amount));
  if (adjustedAmount > 0) {
    const deltaPnl = (adjustedAmount * (price - pos.avgPrice)) / COLLATERAL_SCALE;
    pos.realizedPnl += deltaPnl;
    pos.amount -= adjustedAmount;
  }
}

// Helper to batch fetch resolutions
async function batchFetchResolutions(conditionIds: string[]): Promise<Map<string, number[]>> {
  const resolutions = new Map<string, number[]>();
  if (conditionIds.length === 0) return resolutions;

  for (let i = 0; i < conditionIds.length; i += BATCH_SIZE) {
    const batch = conditionIds.slice(i, i + BATCH_SIZE);
    const idList = batch.map(id => `'${id}'`).join(',');
    const resResult = await clickhouse.query({
      query: `SELECT lower(condition_id) as condition_id, norm_prices FROM pm_condition_resolutions_norm WHERE lower(condition_id) IN (${idList})`,
      format: 'JSONEachRow',
    });
    const resRows = await resResult.json() as any[];
    for (const row of resRows) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }
  return resolutions;
}

// Helper to batch fetch mark prices
async function batchFetchMarkPrices(conditionIds: string[]): Promise<Map<string, number>> {
  const markPrices = new Map<string, number>();
  if (conditionIds.length === 0) return markPrices;

  for (let i = 0; i < conditionIds.length; i += BATCH_SIZE) {
    const batch = conditionIds.slice(i, i + BATCH_SIZE);
    const idList = batch.map(id => `'${id}'`).join(',');
    const markResult = await clickhouse.query({
      query: `SELECT lower(condition_id) as condition_id, outcome_index, mark_price FROM pm_latest_mark_price_v1 WHERE lower(condition_id) IN (${idList})`,
      format: 'JSONEachRow',
    });
    const markRows = await markResult.json() as any[];
    for (const row of markRows) {
      markPrices.set(`${row.condition_id}_${row.outcome_index}`, row.mark_price * COLLATERAL_SCALE);
    }
  }
  return markPrices;
}

async function getEvents(wallet: string): Promise<Event[]> {
  const events: Event[] = [];

  // 1. Get CLOB trades
  const clobResult = await clickhouse.query({
    query: `
      SELECT
        toUnixTimestamp(t.trade_time) as ts,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        max(t.token_amount) as tokens,
        max(t.usdc_amount) as usdc
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND m.condition_id IS NOT NULL
      GROUP BY t.trade_time, m.condition_id, m.outcome_index, t.side
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow',
  });

  const clobRows = await clobResult.json() as any[];
  for (const row of clobRows) {
    const price = Math.round((row.usdc * COLLATERAL_SCALE) / row.tokens);
    events.push({
      timestamp: row.ts,
      type: row.side.toLowerCase() === 'buy' ? 'buy' : 'sell',
      conditionId: row.condition_id,
      outcomeIndex: row.outcome_index,
      amount: row.tokens / 1e6,
      price,
    });
  }

  // 2. Get CTF Split events
  const splitResult = await clickhouse.query({
    query: `
      SELECT
        toUnixTimestamp(event_timestamp) as ts,
        lower(condition_id) as condition_id,
        toFloat64OrZero(amount_or_payout) as amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND event_type = 'PositionSplit'
        AND is_deleted = 0
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow',
  });

  const splitRows = await splitResult.json() as any[];
  for (const row of splitRows) {
    // Split creates both outcomes at $0.50 each
    events.push({
      timestamp: row.ts,
      type: 'split',
      conditionId: row.condition_id,
      outcomeIndex: 0,
      amount: row.amount / 1e6,
      price: FIFTY_CENTS,
    });
    events.push({
      timestamp: row.ts,
      type: 'split',
      conditionId: row.condition_id,
      outcomeIndex: 1,
      amount: row.amount / 1e6,
      price: FIFTY_CENTS,
    });
  }

  // 3. Get CTF Merge events
  const mergeResult = await clickhouse.query({
    query: `
      SELECT
        toUnixTimestamp(event_timestamp) as ts,
        lower(condition_id) as condition_id,
        toFloat64OrZero(amount_or_payout) as amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND event_type = 'PositionsMerge'
        AND is_deleted = 0
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow',
  });

  const mergeRows = await mergeResult.json() as any[];
  for (const row of mergeRows) {
    // Merge sells both outcomes at $0.50 each
    events.push({
      timestamp: row.ts,
      type: 'merge',
      conditionId: row.condition_id,
      outcomeIndex: 0,
      amount: row.amount / 1e6,
      price: FIFTY_CENTS,
    });
    events.push({
      timestamp: row.ts,
      type: 'merge',
      conditionId: row.condition_id,
      outcomeIndex: 1,
      amount: row.amount / 1e6,
      price: FIFTY_CENTS,
    });
  }

  // 4. Get Redemption events (fetch resolutions in batch)
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        toUnixTimestamp(event_timestamp) as ts,
        lower(condition_id) as condition_id,
        toFloat64OrZero(amount_or_payout) as amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow',
  });

  const redemptionRows = await redemptionResult.json() as any[];
  const redemptionConditionIds = [...new Set(redemptionRows.map((r: any) => r.condition_id))];
  const resolutions = await batchFetchResolutions(redemptionConditionIds);

  for (const row of redemptionRows) {
    const prices = resolutions.get(row.condition_id) ?? [0.5, 0.5];
    // For binary markets, redemption closes the winning outcome at $1.00
    const winningOutcome = prices[0] > prices[1] ? 0 : 1;
    events.push({
      timestamp: row.ts,
      type: 'redemption',
      conditionId: row.condition_id,
      outcomeIndex: winningOutcome,
      amount: row.amount / 1e6,
      price: COLLATERAL_SCALE, // $1.00
    });
  }

  // 5. Get Neg Risk Conversion events
  const conversionResult = await clickhouse.query({
    query: `
      SELECT
        toUnixTimestamp(event_timestamp) as ts,
        lower(market_id) as market_id,
        toInt32(index_set) as index_set,
        toFloat64(amount) as amount
      FROM pm_neg_risk_conversions_v1
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow',
  });

  const conversionRows = await conversionResult.json() as any[];
  for (const row of conversionRows) {
    events.push({
      timestamp: row.ts,
      type: 'conversion',
      conditionId: row.market_id,
      outcomeIndex: -1, // Will be processed specially
      amount: row.amount / 1e6,
      price: 0, // Will be calculated
      conversionData: {
        indexSet: row.index_set,
        questionCount: 2, // TODO: Get actual question count from market data
      },
    });
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);

  return events;
}

async function calculatePnL(wallet: string): Promise<{ totalPnl: number; positions: Map<string, Position> }> {
  const events = await getEvents(wallet);
  const positions = new Map<string, Position>();

  const getPosition = (conditionId: string, outcomeIndex: number): Position => {
    const key = `${conditionId}_${outcomeIndex}`;
    if (!positions.has(key)) {
      positions.set(key, { amount: 0, avgPrice: 0, realizedPnl: 0 });
    }
    return positions.get(key)!;
  };

  for (const event of events) {
    if (event.type === 'buy' || event.type === 'split') {
      const pos = getPosition(event.conditionId, event.outcomeIndex);
      updatePositionWithBuy(pos, event.amount, event.price);
    } else if (event.type === 'sell' || event.type === 'merge' || event.type === 'redemption') {
      const pos = getPosition(event.conditionId, event.outcomeIndex);
      updatePositionWithSell(pos, event.amount, event.price);
    } else if (event.type === 'conversion' && event.conversionData) {
      // Handle Neg Risk conversion
      const { indexSet, questionCount } = event.conversionData;

      // Find which outcomes are being converted (NO positions)
      const noOutcomes: number[] = [];
      const yesOutcomes: number[] = [];

      for (let i = 0; i < questionCount; i++) {
        if ((indexSet & (1 << i)) !== 0) {
          noOutcomes.push(i);
        } else {
          yesOutcomes.push(i);
        }
      }

      if (noOutcomes.length > 0 && yesOutcomes.length > 0) {
        // Calculate average NO price from positions being converted
        let noPriceSum = 0;
        for (const outcome of noOutcomes) {
          const pos = getPosition(event.conditionId, outcome);
          noPriceSum += pos.avgPrice;
          // Sell NO at cost basis (PnL = 0)
          updatePositionWithSell(pos, event.amount, pos.avgPrice);
        }
        const noPrice = noPriceSum / noOutcomes.length;

        // Calculate synthetic YES price
        const yesPrice = Math.round(
          (noPrice * noOutcomes.length - COLLATERAL_SCALE * (noOutcomes.length - 1)) / yesOutcomes.length
        );

        // Buy YES outcomes at synthetic price
        for (const outcome of yesOutcomes) {
          const pos = getPosition(event.conditionId, outcome);
          updatePositionWithBuy(pos, event.amount, yesPrice);
        }
      }
    }
  }

  // Calculate total realized PnL
  let totalRealizedPnl = 0;
  for (const pos of positions.values()) {
    totalRealizedPnl += pos.realizedPnl;
  }

  // Get mark prices for unrealized PnL
  const conditionIds = [...new Set(Array.from(positions.keys()).map(k => k.split('_')[0]))];

  let totalUnrealizedPnl = 0;
  if (conditionIds.length > 0) {
    // Batch fetch resolutions and mark prices
    const resolutions = await batchFetchResolutions(conditionIds);
    const markPrices = await batchFetchMarkPrices(conditionIds);

    for (const [key, pos] of positions) {
      if (pos.amount > 0.001) {
        const [conditionId, outcomeIndexStr] = key.split('_');
        const outcomeIndex = parseInt(outcomeIndexStr);

        const res = resolutions.get(conditionId);
        let currentPrice: number;

        if (res && res.length > outcomeIndex) {
          currentPrice = res[outcomeIndex] * COLLATERAL_SCALE;
        } else {
          currentPrice = markPrices.get(key) ?? FIFTY_CENTS;
        }

        totalUnrealizedPnl += (pos.amount * (currentPrice - pos.avgPrice)) / COLLATERAL_SCALE;
      }
    }
  }

  return {
    totalPnl: totalRealizedPnl + totalUnrealizedPnl,
    positions,
  };
}

async function main() {
  const wallet = process.argv[2] || '0xb7d54bf1d0a362beb916d9cb58a04c41d67e0789'; // Wallet with conversions

  console.log(`\n=== PNL V30 - COMPLETE IMPLEMENTATION ===\n`);
  console.log(`Wallet: ${wallet}`);

  const [result, apiPnl] = await Promise.all([
    calculatePnL(wallet),
    fetchApiPnl(wallet),
  ]);

  console.log(`\nV30 PnL: $${result.totalPnl.toFixed(2)}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  if (apiPnl !== null) {
    const diff = result.totalPnl - apiPnl;
    const pctDiff = (diff / Math.abs(apiPnl)) * 100;
    console.log(`Difference: $${diff.toFixed(2)} (${pctDiff.toFixed(2)}%)`);

    if (Math.abs(pctDiff) < 5) {
      console.log(`\n✓ MATCH (within 5%)`);
    } else {
      console.log(`\n✗ MISMATCH`);
    }
  }

  // Show position stats
  console.log(`\nPositions tracked: ${result.positions.size}`);
  let totalRealized = 0;
  for (const pos of result.positions.values()) {
    totalRealized += pos.realizedPnl;
  }
  console.log(`Total realized: $${totalRealized.toFixed(2)}`);

  process.exit(0);
}

main().catch(console.error);
