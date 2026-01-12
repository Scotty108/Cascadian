/**
 * PnL V37 - Robust Universal Engine
 *
 * Key improvements over V36:
 * 1. Null-safe throughout - all joins and data access are guarded
 * 2. Uses INNER JOIN for CLOB trades to exclude unmapped tokens
 * 3. Proper error handling for API calls
 * 4. Detailed logging for debugging
 *
 * Formula: realized_pnl + unrealized_on_unresolved_only
 * This matches Polymarket's API for simple wallets.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const COLLATERAL_SCALE = 1000000;
const FIFTY_CENTS = 500000;

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

interface PnlResult {
  realized: number;
  unrealizedAll: number;
  unrealizedExclResolved: number;
  totalExclResolved: number;
  api: number | null;
  tradeCount: number;
  positionCount: number;
  unmappedTradeCount: number;
}

function updatePositionWithBuy(pos: Position, amount: number, price: number): void {
  if (!isFinite(amount) || !isFinite(price) || amount <= 0) return;

  const newAmount = pos.amount + amount;
  if (newAmount > 0) {
    pos.avgPrice = Math.round((pos.avgPrice * pos.amount + price * amount) / newAmount);
  }
  pos.amount = newAmount;
}

function updatePositionWithSell(pos: Position, amount: number, price: number): void {
  if (!isFinite(amount) || !isFinite(price) || amount <= 0) return;

  const adjustedAmount = Math.min(amount, Math.max(0, pos.amount));
  if (adjustedAmount > 0) {
    const deltaPnl = (adjustedAmount * (price - pos.avgPrice)) / COLLATERAL_SCALE;
    pos.realizedPnl += deltaPnl;
    pos.amount -= adjustedAmount;
  }
}

export async function calculatePnlV37(wallet: string): Promise<PnlResult> {
  if (!wallet || typeof wallet !== 'string') {
    throw new Error('Invalid wallet address');
  }

  const walletLower = wallet.toLowerCase();
  const positions = new Map<string, Position>();

  const getPosition = (conditionId: string, outcomeIndex: number): Position => {
    const key = `${conditionId}_${outcomeIndex}`;
    if (!positions.has(key)) {
      positions.set(key, { amount: 0, avgPrice: 0, realizedPnl: 0 });
    }
    return positions.get(key)!;
  };

  // Step 1: Get CLOB trades with proper null handling
  // Use INNER JOIN to only include mapped tokens
  const clobResult = await clickhouse.query({
    query: `
      SELECT
        max(toUnixTimestamp(t.trade_time)) as ts,
        lower(m.condition_id) as condition_id,
        toInt64(m.outcome_index) as outcome_index,
        t.side,
        sum(t.token_amount) as tokens,
        sum(t.usdc_amount) as usdc
      FROM pm_trader_events_v3 t
      INNER JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${walletLower}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
      GROUP BY substring(t.event_id, 1, 66), m.condition_id, m.outcome_index, t.side
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow',
  });

  const clobRows = await clobResult.json() as any[];
  let tradeCount = 0;

  for (const row of clobRows) {
    // Null checks for every field
    if (!row) continue;
    if (!row.condition_id || row.condition_id === '') continue;
    if (row.outcome_index === null || row.outcome_index === undefined) continue;
    if (!row.tokens || row.tokens <= 0) continue;
    if (!row.usdc || row.usdc <= 0) continue;
    if (!row.side) continue;

    const price = Math.round((row.usdc * COLLATERAL_SCALE) / row.tokens);
    const pos = getPosition(row.condition_id, Number(row.outcome_index));
    const amount = row.tokens / 1e6;

    if (row.side.toLowerCase() === 'buy') {
      updatePositionWithBuy(pos, amount, price);
    } else {
      updatePositionWithSell(pos, amount, price);
    }
    tradeCount++;
  }

  // Step 2: Count unmapped trades for reporting
  const unmappedResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${walletLower}'
        AND (m.condition_id IS NULL OR m.condition_id = '')
    `,
    format: 'JSONEachRow',
  });
  const unmappedRows = await unmappedResult.json() as any[];
  const unmappedTradeCount = Number(unmappedRows[0]?.cnt || 0);

  // Step 3: Get redemptions
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        toUnixTimestamp(event_timestamp) as ts,
        lower(condition_id) as condition_id,
        toFloat64OrZero(amount_or_payout) as amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${walletLower}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
        AND condition_id IS NOT NULL
        AND condition_id != ''
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow',
  });

  const redemptionRows = await redemptionResult.json() as any[];

  // Step 4: Get all resolutions for conditions we have positions in
  const conditionIds = [...new Set(Array.from(positions.keys()).map(k => k.split('_')[0]))];
  const resolutions = new Map<string, number[]>();

  if (conditionIds.length > 0) {
    const idList = conditionIds.map(id => `'${id}'`).join(',');
    const resResult = await clickhouse.query({
      query: `
        SELECT lower(condition_id) as condition_id, norm_prices
        FROM pm_condition_resolutions_norm
        WHERE lower(condition_id) IN (${idList})
      `,
      format: 'JSONEachRow',
    });
    const resRows = await resResult.json() as any[];
    for (const row of resRows) {
      if (row && row.condition_id && Array.isArray(row.norm_prices)) {
        resolutions.set(row.condition_id, row.norm_prices);
      }
    }
  }

  // Step 5: Process redemptions
  for (const row of redemptionRows) {
    if (!row || !row.condition_id || !row.amount) continue;

    const prices = resolutions.get(row.condition_id) ?? [0.5, 0.5];
    const winningOutcome = prices[0] > prices[1] ? 0 : 1;
    const pos = getPosition(row.condition_id, winningOutcome);
    updatePositionWithSell(pos, row.amount / 1e6, COLLATERAL_SCALE);
  }

  // Step 6: Calculate totals
  let totalRealized = 0;
  for (const pos of positions.values()) {
    totalRealized += pos.realizedPnl;
  }

  let unrealizedAll = 0;
  let unrealizedExclResolved = 0;
  let positionCount = 0;

  for (const [key, pos] of positions) {
    if (Math.abs(pos.amount) > 0.001) {
      positionCount++;
      const [conditionId, outcomeIndexStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeIndexStr);
      const res = resolutions.get(conditionId);

      let currentPrice = FIFTY_CENTS;
      let isResolved = false;

      if (res && res.length > outcomeIndex) {
        currentPrice = res[outcomeIndex] * COLLATERAL_SCALE;
        isResolved = true;
      }

      const unrealized = (pos.amount * (currentPrice - pos.avgPrice)) / COLLATERAL_SCALE;
      unrealizedAll += unrealized;

      if (!isResolved) {
        unrealizedExclResolved += unrealized;
      }
    }
  }

  // Step 7: Fetch API for comparison
  let apiPnl: number | null = null;
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${walletLower}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && Array.isArray(data) && data.length > 0) {
        const lastEntry = data[data.length - 1];
        if (lastEntry && typeof lastEntry.p === 'number') {
          apiPnl = lastEntry.p;
        }
      }
    }
  } catch {
    // Silently fail - API might be unavailable
  }

  return {
    realized: totalRealized,
    unrealizedAll,
    unrealizedExclResolved,
    totalExclResolved: totalRealized + unrealizedExclResolved,
    api: apiPnl,
    tradeCount,
    positionCount,
    unmappedTradeCount,
  };
}

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n${'='.repeat(70)}`);
  console.log(`PnL V37 - ${wallet}`);
  console.log('='.repeat(70));

  try {
    const result = await calculatePnlV37(wallet);

    console.log('\nResults:');
    console.log(`  Trades processed: ${result.tradeCount}`);
    console.log(`  Unmapped trades: ${result.unmappedTradeCount}`);
    console.log(`  Open positions: ${result.positionCount}`);
    console.log('');
    console.log(`  Realized PnL:             $${result.realized.toFixed(2)}`);
    console.log(`  Unrealized (all):         $${result.unrealizedAll.toFixed(2)}`);
    console.log(`  Unrealized (excl resolved): $${result.unrealizedExclResolved.toFixed(2)}`);
    console.log('');
    console.log(`  Total (excl resolved):    $${result.totalExclResolved.toFixed(2)}`);

    if (result.api !== null) {
      const diff = result.totalExclResolved - result.api;
      const pctDiff = (diff / Math.abs(result.api || 1)) * 100;
      console.log(`  API PnL:                  $${result.api.toFixed(2)}`);
      console.log(`  Difference:               $${diff.toFixed(2)} (${pctDiff.toFixed(1)}%)`);

      if (Math.abs(pctDiff) < 5) {
        console.log('\n  ✅ Within 5% of API');
      } else if (Math.abs(pctDiff) < 20) {
        console.log('\n  ⚠️ Within 20% of API');
      } else {
        console.log('\n  ❌ More than 20% off from API');
      }
    }

    if (result.unmappedTradeCount > 0) {
      console.log(`\n  ⚠️ Warning: ${result.unmappedTradeCount} trades excluded due to unmapped tokens`);
    }
  } catch (error) {
    console.error('Error calculating PnL:', error);
  }

  process.exit(0);
}

main().catch(console.error);
