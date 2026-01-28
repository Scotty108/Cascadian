#!/usr/bin/env npx tsx
/**
 * Build pm_trade_fifo_roi_v3 - WITH CLOSED POSITIONS (v5)
 *
 * CRITICAL FIX (Jan 27, 2026): v4 only tracked RESOLVED markets.
 * This version adds CLOSED positions (net_tokens ≈ 0, market not resolved yet).
 *
 * This fixes the $7k PnL gap for wallets like FuelHydrantBoss.
 *
 * Changes from v4:
 * 1. Adds is_closed column (0 = normal, 1 = closed but unresolved)
 * 2. Processes closed positions separately with aggregate PnL = sum(usdc_delta)
 * 3. Uses synthetic tx_hash: 'closed_' + wallet + condition_id + outcome
 *
 * Position types:
 * - LONG (is_short=0, is_closed=0): Buy tokens, resolved
 * - SHORT (is_short=1, is_closed=0): Sell tokens you don't own, resolved
 * - CLOSED (is_short=0, is_closed=1): Fully exited, NOT resolved yet
 *
 * Run: npx tsx scripts/build-trade-fifo-v5-with-closed.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const START_MONTH = process.argv.find(a => a.startsWith('--start='))?.split('=')[1] || '2022-11';
const END_MONTH = process.argv.find(a => a.startsWith('--end='))?.split('=')[1] || '2026-02';
const BATCH_SIZE = 500;

function generateMonths(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  let [year, month] = startMonth.split('-').map(Number);
  const [endYear, endMonthNum] = endMonth.split('-').map(Number);

  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    months.push(`${year}${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return months;
}

// Process CLOSED positions (fully exited, unresolved markets)
async function processConditionBatchClosed(conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  const query = `
    INSERT INTO pm_trade_fifo_roi_v3
    SELECT
      concat('closed_', wallet, '_', condition_id, '_', toString(outcome_index)) as tx_hash,
      wallet,
      condition_id,
      outcome_index,
      first_trade as entry_time,
      0 as tokens, -- Fully exited
      total_buy_cost as cost_usd,
      total_tokens_bought as tokens_sold_early, -- All tokens were sold
      0 as tokens_held, -- None held
      total_sell_proceeds as exit_value,
      total_sell_proceeds - total_buy_cost as pnl_usd,
      CASE
        WHEN total_buy_cost > 0 THEN (total_sell_proceeds - total_buy_cost) / total_buy_cost
        ELSE 0
      END as roi,
      100 as pct_sold_early, -- 100% sold
      any(is_maker) as is_maker,
      last_trade as resolved_at, -- Use last trade time as placeholder
      0 as is_short,
      1 as is_closed -- CLOSED position marker
    FROM (
      SELECT
        wallet,
        condition_id,
        outcome_index,
        sum(tokens_delta) as net_tokens,
        sumIf(tokens_delta, tokens_delta > 0) as total_tokens_bought,
        sumIf(tokens_delta, tokens_delta < 0) as total_tokens_sold,
        abs(sumIf(usdc_delta, usdc_delta < 0)) as total_buy_cost,
        sumIf(usdc_delta, usdc_delta > 0) as total_sell_proceeds,
        min(event_time) as first_trade,
        max(event_time) as last_trade,
        any(is_maker) as is_maker
      FROM pm_canonical_fills_v4_deduped
      WHERE condition_id IN (${conditionList})
        AND source = 'clob'
      GROUP BY wallet, condition_id, outcome_index
      HAVING abs(net_tokens) < 0.01 -- Effectively zero (closed)
        AND total_tokens_bought > 0 -- Must have bought
        AND abs(total_tokens_sold) > 0 -- Must have sold
    )
  `;

  await clickhouse.command({
    query,
    clickhouse_settings: {
      max_execution_time: 300,
      max_memory_usage: 5000000000,
      max_threads: 6,
    },
  });

  // Count inserted rows
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_trade_fifo_roi_v3
      WHERE condition_id IN (${conditionList})
        AND is_closed = 1
    `,
    format: 'JSONEachRow',
  });
  const rows = await countResult.json() as any[];
  return rows[0]?.cnt || 0;
}

// Get unresolved conditions for closed position processing
async function getUnresolvedConditions(partition: string): Promise<string[]> {
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT f.condition_id
      FROM pm_canonical_fills_v4_deduped f
      LEFT JOIN pm_condition_resolutions r
        ON f.condition_id = r.condition_id AND r.is_deleted = 0
      WHERE toYYYYMM(f.event_time) = ${partition}
        AND f.source = 'clob'
        AND (r.payout_numerators IS NULL OR r.payout_numerators = '') -- NOT resolved
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as { condition_id: string }[];
  return rows.map((r) => r.condition_id);
}

async function processMonthClosed(partition: string): Promise<{ closed: number; batches: number }> {
  const conditionIds = await getUnresolvedConditions(partition);

  if (conditionIds.length === 0) {
    return { closed: 0, batches: 0 };
  }

  let totalClosed = 0;
  let batches = 0;

  for (let i = 0; i < conditionIds.length; i += BATCH_SIZE) {
    const batch = conditionIds.slice(i, i + BATCH_SIZE);
    const count = await processConditionBatchClosed(batch);
    totalClosed += count;
    batches++;
  }

  return { closed: totalClosed, batches };
}

async function main() {
  console.log('🔨 Building FIFO ROI V5 (with CLOSED positions)\n');
  console.log(`Range: ${START_MONTH} to ${END_MONTH}`);
  console.log(`Batch size: ${BATCH_SIZE} conditions per batch\n`);

  const months = generateMonths(START_MONTH, END_MONTH);
  console.log(`Processing ${months.length} months for CLOSED positions...\n`);

  // First, add is_closed column if it doesn't exist
  try {
    await clickhouse.command({
      query: `
        ALTER TABLE pm_trade_fifo_roi_v3
        ADD COLUMN IF NOT EXISTS is_closed UInt8 DEFAULT 0
      `,
    });
    console.log('✓ Added is_closed column to table\n');
  } catch (error: any) {
    if (!error.message.includes('already exists')) {
      throw error;
    }
  }

  let totalClosed = 0;
  let totalBatches = 0;

  for (let i = 0; i < months.length; i++) {
    const partition = months[i];
    const monthStart = Date.now();

    process.stdout.write(`[${i + 1}/${months.length}] ${partition}... `);

    try {
      const result = await processMonthClosed(partition);
      totalClosed += result.closed;
      totalBatches += result.batches;

      const duration = ((Date.now() - monthStart) / 1000).toFixed(1);
      console.log(`✓ ${result.closed.toLocaleString()} closed (${result.batches} batches, ${duration}s)`);
    } catch (error: any) {
      console.error(`✗ Failed: ${error.message}`);
    }
  }

  console.log('\n════════════════════════════════════════════════════');
  console.log('✅ FIFO V5 Build Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Total closed positions: ${totalClosed.toLocaleString()}`);
  console.log(`Total batches: ${totalBatches}`);
  console.log('\nNext: Run verification script to test results\n');
}

main().catch(console.error);
