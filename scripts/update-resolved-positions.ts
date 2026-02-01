#!/usr/bin/env npx tsx
/**
 * Update Resolved Positions in Unified Table
 *
 * Problem: Positions exist in unified as UNRESOLVED (resolved_at = NULL),
 * but v3 now has them as RESOLVED (resolved_at set).
 *
 * Solution:
 * 1. Delete unresolved positions that now have resolutions in v3
 * 2. Insert the resolved versions from v3
 *
 * This is the ClickHouse way to "update" rows in a MergeTree.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const LOOKBACK_HOURS = 72;

async function updateResolved() {
  console.log('🔄 Update Resolved Positions in Unified Table\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log('');

  const startTime = Date.now();

  // Step 1: Identify positions to update
  console.log('1️⃣ Identifying positions to update...\n');

  const identifyResult = await clickhouse.query({
    query: `
      SELECT count() as positions_to_update
      FROM pm_trade_fifo_roi_v3 v
      INNER JOIN pm_trade_fifo_roi_v3_mat_unified u
        ON v.tx_hash = u.tx_hash
        AND v.wallet = u.wallet
        AND v.condition_id = u.condition_id
        AND v.outcome_index = u.outcome_index
      WHERE v.resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND v.resolved_at IS NOT NULL
        AND u.resolved_at IS NULL
    `,
    format: 'JSONEachRow',
  });
  const { positions_to_update } = (await identifyResult.json())[0];

  console.log(`   Found ${positions_to_update.toLocaleString()} positions to update`);
  console.log('');

  if (positions_to_update === 0) {
    console.log('✅ No positions to update - unified table is current!\n');
    return;
  }

  // Step 2: Create temp table with positions to update
  console.log('2️⃣ Creating temp table with keys to update...\n');

  await clickhouse.command({
    query: `
      CREATE TABLE temp_resolved_keys (
        tx_hash String,
        wallet String,
        condition_id String,
        outcome_index UInt8
      ) ENGINE = Memory
    `,
  });

  await clickhouse.command({
    query: `
      INSERT INTO temp_resolved_keys
      SELECT DISTINCT v.tx_hash, v.wallet, v.condition_id, v.outcome_index
      FROM pm_trade_fifo_roi_v3 v
      INNER JOIN pm_trade_fifo_roi_v3_mat_unified u
        ON v.tx_hash = u.tx_hash
        AND v.wallet = u.wallet
        AND v.condition_id = u.condition_id
        AND v.outcome_index = u.outcome_index
      WHERE v.resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND v.resolved_at IS NOT NULL
        AND u.resolved_at IS NULL
    `,
  });

  console.log('   ✅ Temp table created\n');

  // Step 3: Delete old unresolved rows
  console.log('3️⃣ Deleting old unresolved rows...\n');

  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE (tx_hash, wallet, condition_id, outcome_index) IN (
        SELECT tx_hash, wallet, condition_id, outcome_index
        FROM temp_resolved_keys
      )
    `,
    clickhouse_settings: {
      max_execution_time: 600 as any,
    },
  });

  console.log('   ✅ Old rows deleted\n');

  // Step 4: Insert new resolved rows
  console.log('4️⃣ Inserting new resolved rows...\n');

  await clickhouse.command({
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
      INNER JOIN temp_resolved_keys t
        ON v.tx_hash = t.tx_hash
        AND v.wallet = t.wallet
        AND v.condition_id = t.condition_id
        AND v.outcome_index = t.outcome_index
    `,
    clickhouse_settings: {
      max_execution_time: 600 as any,
    },
  });

  console.log('   ✅ New rows inserted\n');

  // Step 5: Cleanup temp table
  console.log('5️⃣ Cleaning up...\n');

  await clickhouse.command({
    query: `DROP TABLE temp_resolved_keys`,
  });

  console.log('   ✅ Temp table dropped\n');

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Step 6: Verify results
  console.log('6️⃣ Verifying results...\n');

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
  console.log('✅ Update Complete\n');
  console.log(`📊 Summary:`);
  console.log(`   - Positions updated: ${positions_to_update.toLocaleString()}`);
  console.log(`   - Latest resolution: ${after.latest_resolution}`);
  console.log(`   - Staleness: ${after.minutes_stale} minutes`);
  console.log(`   - Duration: ${elapsed} minutes`);
  console.log('═'.repeat(60));
}

updateResolved()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
