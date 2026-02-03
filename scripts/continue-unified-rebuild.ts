/**
 * Continue Unified Table Rebuild
 *
 * The initial rebuild timed out at ~177M rows of expected 245M.
 * This script continues inserting the remaining rows in time-based chunks.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function continueRebuild() {
  const client = getClickHouseClient();
  const startTime = Date.now();

  console.log('=== Continue Unified Table Rebuild ===\n');

  // Step 1: Check current state
  console.log('Step 1: Checking current progress...');
  const currentState = await client.query({
    query: `
      SELECT
        count() as total,
        max(entry_time) as max_entry_time
      FROM pm_trade_fifo_roi_v3_mat_unified_new
    `,
    format: 'JSONEachRow',
  });
  const current = (await currentState.json() as any[])[0];
  console.log(`  Current rows: ${current.total.toLocaleString()}`);
  console.log(`  Max entry_time: ${current.max_entry_time}`);

  // Step 2: Find what's missing - get entry_time ranges from v3 that aren't in new table
  console.log('\nStep 2: Finding missing data ranges...');

  // Get the count of what we should have vs what we have by month
  const monthlyComparison = await client.query({
    query: `
      WITH
        source AS (
          SELECT
            toStartOfMonth(entry_time) as month,
            count() as source_count
          FROM pm_trade_fifo_roi_v3
          WHERE resolved_at IS NOT NULL
            AND resolved_at != '1970-01-01'
            AND cost_usd > 0
            AND tokens > 0
            AND condition_id != ''
            AND condition_id IN (
              SELECT condition_id FROM pm_condition_resolutions
              WHERE is_deleted = 0
            )
          GROUP BY month
        ),
        target AS (
          SELECT
            toStartOfMonth(entry_time) as month,
            count() as target_count
          FROM pm_trade_fifo_roi_v3_mat_unified_new
          GROUP BY month
        )
      SELECT
        source.month,
        source.source_count,
        coalesce(target.target_count, 0) as target_count,
        source.source_count - coalesce(target.target_count, 0) as missing
      FROM source
      LEFT JOIN target ON source.month = target.month
      WHERE source.source_count - coalesce(target.target_count, 0) > 0
      ORDER BY source.month
    `,
    format: 'JSONEachRow',
  });
  const missingMonths = await monthlyComparison.json() as any[];
  console.log(`  Found ${missingMonths.length} months with missing data`);

  // Step 3: Insert missing data month by month
  let totalInserted = 0;
  for (const month of missingMonths) {
    const monthStr = month.month.substring(0, 7);
    const monthStart = `${monthStr}-01`;
    const nextMonth = new Date(month.month);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const monthEnd = nextMonth.toISOString().substring(0, 10);

    console.log(`\n  Processing ${monthStr} (missing ~${month.missing.toLocaleString()} rows)...`);

    try {
      await client.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unified_new
          SELECT
            tx_hash,
            wallet,
            condition_id,
            outcome_index,
            entry_time,
            resolved_at,
            tokens,
            cost_usd,
            tokens_sold_early,
            tokens_held,
            exit_value,
            pnl_usd,
            roi,
            pct_sold_early,
            is_maker,
            CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed,
            is_short
          FROM pm_trade_fifo_roi_v3
          WHERE resolved_at IS NOT NULL
            AND resolved_at != '1970-01-01'
            AND cost_usd > 0
            AND tokens > 0
            AND condition_id != ''
            AND condition_id IN (
              SELECT condition_id FROM pm_condition_resolutions
              WHERE is_deleted = 0
            )
            AND entry_time >= '${monthStart}'
            AND entry_time < '${monthEnd}'
            AND (tx_hash, wallet, condition_id, outcome_index) NOT IN (
              SELECT tx_hash, wallet, condition_id, outcome_index
              FROM pm_trade_fifo_roi_v3_mat_unified_new
              WHERE entry_time >= '${monthStart}'
              AND entry_time < '${monthEnd}'
            )
        `,
        clickhouse_settings: { max_execution_time: 300 },
      });

      totalInserted += month.missing;
      console.log(`    ✓ Inserted`);
    } catch (error: any) {
      console.log(`    ✗ Error: ${error.message.substring(0, 100)}...`);
    }
  }

  // Step 4: Verify final count
  console.log('\n\nStep 4: Final verification...');
  const finalState = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(cost_usd = 0) as zero_cost,
        countIf(resolved_at IS NOT NULL) as resolved
      FROM pm_trade_fifo_roi_v3_mat_unified_new
    `,
    format: 'JSONEachRow',
  });
  const final = (await finalState.json() as any[])[0];

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log('RESULTS:');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Before: ${current.total.toLocaleString()}`);
  console.log(`  After: ${final.total.toLocaleString()}`);
  console.log(`  Inserted: ~${totalInserted.toLocaleString()}`);
  console.log(`  Zero cost: ${final.zero_cost.toLocaleString()}`);
  console.log(`  Duration: ${duration} minutes`);
}

continueRebuild().catch(console.error);
