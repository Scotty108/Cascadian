#!/usr/bin/env npx tsx
/**
 * Direct Unified Table Refresh
 *
 * Copies NEW resolved positions directly from pm_trade_fifo_roi_v3 to unified.
 * Bypasses deduped table (which may be stale).
 * Uses LEFT JOIN to avoid inserting duplicates.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const LOOKBACK_HOURS = 72; // Look back 3 days to catch all new resolutions

async function refreshDirect() {
  console.log('🔄 Direct Unified Table Refresh\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log('');

  const startTime = Date.now();

  // Step 1: Get current state
  console.log('1️⃣ Checking current state...\n');

  const beforeResult = await clickhouse.query({
    query: `
      SELECT
        max(resolved_at) as latest_resolution,
        formatReadableQuantity(count()) as total_rows
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const before = (await beforeResult.json())[0];

  console.log(`   Latest resolution: ${before.latest_resolution}`);
  console.log(`   Total rows: ${before.total_rows}`);
  console.log('');

  // Step 2: Get source table state
  console.log('2️⃣ Checking source table (pm_trade_fifo_roi_v3)...\n');

  const sourceResult = await clickhouse.query({
    query: `
      SELECT
        max(resolved_at) as latest_resolution,
        formatReadableQuantity(count()) as total_rows,
        countIf(resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR) as recent_count
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const source = (await sourceResult.json())[0];

  console.log(`   Latest resolution: ${source.latest_resolution}`);
  console.log(`   Total rows: ${source.total_rows}`);
  console.log(`   Recent rows (last ${LOOKBACK_HOURS}h): ${source.recent_count.toLocaleString()}`);
  console.log('');

  // Step 3: Copy NEW resolved positions from v3 → unified
  console.log('3️⃣ Copying new resolved positions...\n');
  console.log(`   Using LEFT JOIN to exclude duplicates`);
  console.log(`   Lookback window: ${LOOKBACK_HOURS} hours`);
  console.log('');

  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT
        v.tx_hash,
        v.wallet,
        v.condition_id,
        v.outcome_index,
        v.entry_time,
        v.resolved_at,
        v.cost_usd,
        v.tokens,
        v.tokens_sold_early,
        v.tokens_held,
        v.exit_value,
        v.pnl_usd,
        v.roi,
        v.pct_sold_early,
        v.is_maker,
        v.is_short,
        CASE WHEN v.tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed
      FROM pm_trade_fifo_roi_v3 v
      LEFT JOIN (
        SELECT DISTINCT tx_hash, wallet, condition_id, outcome_index
        FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
      ) u ON v.tx_hash = u.tx_hash
        AND v.wallet = u.wallet
        AND v.condition_id = u.condition_id
        AND v.outcome_index = u.outcome_index
      WHERE v.resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND v.resolved_at IS NOT NULL
        AND u.tx_hash IS NULL
    `,
    clickhouse_settings: {
      max_execution_time: 600 as any,
      max_memory_usage: 15000000000 as any,
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Copy complete in ${elapsed} minutes\n`);

  // Step 4: Get final state
  console.log('4️⃣ Verifying results...\n');

  const afterResult = await clickhouse.query({
    query: `
      SELECT
        max(resolved_at) as latest_resolution,
        formatReadableQuantity(count()) as total_rows,
        dateDiff('minute', max(resolved_at), now()) as minutes_stale
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const after = (await afterResult.json())[0];

  console.log(`   Latest resolution: ${after.latest_resolution}`);
  console.log(`   Total rows: ${after.total_rows}`);
  console.log(`   Staleness: ${after.minutes_stale} minutes`);
  console.log('');

  // Summary
  console.log('═'.repeat(60));
  console.log('✅ Direct Refresh Complete\n');
  console.log(`📊 Summary:`);
  console.log(`   - Before: ${before.total_rows} rows, latest ${before.latest_resolution}`);
  console.log(`   - After: ${after.total_rows} rows, latest ${after.latest_resolution}`);
  console.log(`   - Duration: ${elapsed} minutes`);
  console.log(`   - Staleness: ${after.minutes_stale} minutes (should be <30 min)`);
  console.log('═'.repeat(60));
  console.log('\n📌 Note: This bypassed the deduped table and copied directly from v3.');
  console.log('   The daily cron will continue to work once deduped rebuild completes.\n');
}

refreshDirect()
  .then(() => {
    console.log('🎉 Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
