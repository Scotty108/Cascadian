/**
 * PnL V31 - Realized PnL Only (Matching Polymarket API)
 *
 * Key insight: Polymarket API returns REALIZED PnL only.
 * Unredeemed winning positions are NOT counted until redeemed.
 *
 * Formula:
 * 1. Track positions using weighted average cost basis
 * 2. Calculate realized PnL on sells: (sellPrice - avgPrice) * amount
 * 3. Do NOT include unrealized PnL (even for resolved markets)
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const COLLATERAL_SCALE = 1000000;  // $1.00
const BATCH_SIZE = 1000;

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
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

async function calculatePnL(wallet: string): Promise<number> {
  const positions = new Map<string, Position>();

  const getPosition = (conditionId: string, outcomeIndex: number): Position => {
    const key = `${conditionId}_${outcomeIndex}`;
    if (!positions.has(key)) {
      positions.set(key, { amount: 0, avgPrice: 0, realizedPnl: 0 });
    }
    return positions.get(key)!;
  };

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
    const pos = getPosition(row.condition_id, row.outcome_index);
    const amount = row.tokens / 1e6;

    if (row.side.toLowerCase() === 'buy') {
      updatePositionWithBuy(pos, amount, price);
    } else {
      updatePositionWithSell(pos, amount, price);
    }
  }

  // 2. Get redemptions and process them as sells at $1.00
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
    const winningOutcome = prices[0] > prices[1] ? 0 : 1;
    const pos = getPosition(row.condition_id, winningOutcome);
    updatePositionWithSell(pos, row.amount / 1e6, COLLATERAL_SCALE);
  }

  // Calculate total realized PnL
  let totalRealizedPnl = 0;
  for (const pos of positions.values()) {
    totalRealizedPnl += pos.realizedPnl;
  }

  // Get all condition IDs for mark price lookup
  const conditionIds = [...new Set(Array.from(positions.keys()).map(k => k.split('_')[0]))];

  // Get resolutions and mark prices for unrealized calculation
  const allResolutions = await batchFetchResolutions(conditionIds);

  // Get mark prices for unresolved markets
  const markPrices = new Map<string, number>();
  if (conditionIds.length > 0) {
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
  }

  // Calculate unrealized PnL for all positions
  let totalUnrealizedPnl = 0;
  for (const [key, pos] of positions) {
    if (Math.abs(pos.amount) > 0.001) {
      const [conditionId, outcomeIndexStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeIndexStr);
      const res = allResolutions.get(conditionId);

      let currentPrice: number;
      if (res && res.length > outcomeIndex) {
        // Resolved market - use resolution price
        currentPrice = res[outcomeIndex] * COLLATERAL_SCALE;
      } else {
        // Unresolved - use mark price
        currentPrice = markPrices.get(key) ?? 500000; // Default 50c
      }

      const unrealized = (pos.amount * (currentPrice - pos.avgPrice)) / COLLATERAL_SCALE;
      totalUnrealizedPnl += unrealized;
    }
  }

  return totalRealizedPnl + totalUnrealizedPnl;
}

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== PNL V31 - REALIZED ONLY ===\n`);
  console.log(`Wallet: ${wallet}`);

  const [pnl, apiPnl] = await Promise.all([
    calculatePnL(wallet),
    fetchApiPnl(wallet),
  ]);

  console.log(`\nV31 PnL: $${pnl.toFixed(2)}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  if (apiPnl !== null) {
    const diff = pnl - apiPnl;
    const pctDiff = apiPnl !== 0 ? (diff / Math.abs(apiPnl)) * 100 : 0;
    console.log(`Difference: $${diff.toFixed(2)} (${pctDiff.toFixed(2)}%)`);

    if (Math.abs(pctDiff) < 1) {
      console.log(`\n✓ MATCH (within 1%)`);
    } else if (Math.abs(pctDiff) < 5) {
      console.log(`\n~ CLOSE (within 5%)`);
    } else {
      console.log(`\n✗ MISMATCH`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
