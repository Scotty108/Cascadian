/**
 * Working Incremental Unified Table Refresh
 *
 * Updates pm_trade_fifo_roi_v3_mat_unified with newly resolved positions.
 * Uses LEFT JOIN anti-pattern to avoid ClickHouse Cloud limitations.
 * Handles schema differences correctly (adds is_closed column).
 *
 * Runtime: ~2-3 minutes for 48-hour delta
 */

import dotenv from 'dotenv';
import { join } from 'path';
import { getClickHouseClient } from '../lib/clickhouse/client';

dotenv.config({ path: join(process.cwd(), '.env.local') });

const LOOKBACK_HOURS = 48;

async function main() {
  console.log('🔄 INCREMENTAL UNIFIED TABLE REFRESH (Working Version)');
  console.log('='.repeat(70));

  const startTime = Date.now();
  const client = getClickHouseClient();

  try {
    // Step 1: Check current state
    console.log('\n📊 Current table state:');
    const beforeResult = await client.query({
      query: `
        SELECT
          toString(max(entry_time)) as latest_entry,
          toString(max(resolved_at)) as latest_resolution,
          dateDiff('hour', max(entry_time), now()) as hours_stale_entry,
          dateDiff('hour', max(resolved_at), now()) as hours_stale_resolution,
          formatReadableQuantity(count()) as total_rows
        FROM pm_trade_fifo_roi_v3_mat_unified
      `,
      format: 'JSONEachRow',
    });
    const before = await beforeResult.json<any>();
    console.log(`   Latest entry: ${before[0].latest_entry} (${before[0].hours_stale_entry}h stale)`);
    console.log(`   Latest resolution: ${before[0].latest_resolution} (${before[0].hours_stale_resolution}h stale)`);
    console.log(`   Total rows: ${before[0].total_rows}`);

    // Step 2: Insert ONLY NEW resolved positions (LEFT JOIN anti-pattern)
    console.log(`\n🔄 Inserting new resolved positions (last ${LOOKBACK_HOURS} hours)...`);

    const insertQuery = `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT
        d.tx_hash,
        d.wallet,
        d.condition_id,
        d.outcome_index,
        d.entry_time,
        d.resolved_at,
        d.cost_usd,
        d.tokens,
        d.tokens_sold_early,
        d.tokens_held,
        d.exit_value,
        d.pnl_usd,
        d.roi,
        d.pct_sold_early,
        d.is_maker,
        d.is_short,
        1 as is_closed
      FROM pm_trade_fifo_roi_v3_mat_deduped d
      LEFT JOIN (
        SELECT DISTINCT tx_hash, wallet, condition_id, outcome_index
        FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
      ) u ON d.tx_hash = u.tx_hash
        AND d.wallet = u.wallet
        AND d.condition_id = u.condition_id
        AND d.outcome_index = u.outcome_index
      WHERE d.resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND u.tx_hash IS NULL
    `;

    await client.command({
      query: insertQuery,
      clickhouse_settings: { max_execution_time: 300 },
    });

    console.log('   ✅ Resolved positions inserted');

    // Step 3: Optimize table (forces deduplication)
    console.log('\n🧹 Optimizing table (deduplication)...');
    await client.command({
      query: `OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL`,
      clickhouse_settings: { max_execution_time: 600 },
    });
    console.log('   ✅ Optimization complete');

    // Step 4: Check final state
    console.log('\n📊 Updated table state:');
    const afterResult = await client.query({
      query: `
        SELECT
          toString(max(entry_time)) as latest_entry,
          toString(max(resolved_at)) as latest_resolution,
          dateDiff('hour', max(entry_time), now()) as hours_stale_entry,
          dateDiff('hour', max(resolved_at), now()) as hours_stale_resolution,
          formatReadableQuantity(count()) as total_rows
        FROM pm_trade_fifo_roi_v3_mat_unified
      `,
      format: 'JSONEachRow',
    });
    const after = await afterResult.json<any>();
    console.log(`   Latest entry: ${after[0].latest_entry} (${after[0].hours_stale_entry}h stale)`);
    console.log(`   Latest resolution: ${after[0].latest_resolution} (${after[0].hours_stale_resolution}h stale)`);
    console.log(`   Total rows: ${after[0].total_rows}`);

    // Step 5: Verify duplicates are minimal
    console.log('\n🔍 Checking for duplicates (sample)...');
    const dupResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique_keys,
          count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
        FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE entry_time >= now() - INTERVAL 7 DAY
      `,
      format: 'JSONEachRow',
    });
    const dup = await dupResult.json<any>();
    const dupPct = dup[0].total_rows > 0
      ? ((dup[0].duplicates / dup[0].total_rows) * 100).toFixed(4)
      : '0';
    console.log(`   Last 7 days: ${dup[0].duplicates} duplicates out of ${dup[0].total_rows} rows (${dupPct}%)`);

    const duration = (Date.now() - startTime) / 1000;
    console.log('\n' + '='.repeat(70));
    console.log(`✅ REFRESH COMPLETE in ${duration.toFixed(1)}s`);
    console.log('='.repeat(70));
  } catch (error) {
    console.error('\n❌ Error:', error);
    throw error;
  }
}

main();
