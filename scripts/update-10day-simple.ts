#!/usr/bin/env npx tsx
/**
 * Simple Update for 10day Table
 *
 * Just INSERT new positions from the last 37 hours.
 * No complex JOINs, no deduplication needed (they're new positions).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const TABLE_10DAY = 'pm_trade_fifo_roi_v3_mat_unified_10day';
const TABLE_SOURCE = 'pm_trade_fifo_roi_v3';
const SNAPSHOT_DATE = '2026-01-28 07:34:33'; // Latest resolution in 10day table

async function addNewPositions() {
  console.log('\n📊 Checking for New Positions...\n');

  // Step 1: Count new positions in source that don't exist in 10day
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as new_positions
      FROM ${TABLE_SOURCE}
      WHERE entry_time >= now() - INTERVAL 10 DAY
        AND resolved_at > '${SNAPSHOT_DATE}'
        AND resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const { new_positions } = (await countResult.json())[0];

  console.log(`   Found ${new_positions.toLocaleString()} new resolved positions since snapshot\n`);

  if (new_positions === 0) {
    console.log('   ✅ Table is already current!\n');
    return 0;
  }

  // Step 2: Insert new positions directly (no JOIN, no dedup needed - they're new!)
  console.log('   Inserting new positions...\n');

  const startTime = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO ${TABLE_10DAY}
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        resolved_at,
        cost_usd,
        tokens,
        tokens_sold_early,
        tokens_held,
        exit_value,
        pnl_usd,
        roi,
        pct_sold_early,
        is_maker,
        is_short,
        CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed
      FROM ${TABLE_SOURCE}
      WHERE entry_time >= now() - INTERVAL 10 DAY
        AND resolved_at > '${SNAPSHOT_DATE}'
        AND resolved_at IS NOT NULL
    `,
    clickhouse_settings: {
      max_execution_time: 300,
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`   ✅ Inserted ${new_positions.toLocaleString()} positions in ${elapsed}s\n`);

  return new_positions;
}

async function updateUnresolvedToResolved() {
  console.log('\n🔄 Updating Positions That Resolved...\n');

  // Step 1: Find unresolved positions in 10day that have now resolved
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as positions_to_update
      FROM ${TABLE_10DAY}
      WHERE resolved_at IS NULL
        AND (tx_hash, wallet, condition_id, outcome_index) IN (
          SELECT tx_hash, wallet, condition_id, outcome_index
          FROM ${TABLE_SOURCE}
          WHERE resolved_at > '${SNAPSHOT_DATE}'
            AND resolved_at IS NOT NULL
        )
    `,
    format: 'JSONEachRow',
  });
  const { positions_to_update } = (await countResult.json())[0];

  console.log(`   Found ${positions_to_update.toLocaleString()} positions that resolved\n`);

  if (positions_to_update === 0) {
    console.log('   ✅ No positions to update\n');
    return 0;
  }

  // Step 2: Delete old unresolved versions
  console.log('   Deleting old unresolved rows...');

  await clickhouse.command({
    query: `
      ALTER TABLE ${TABLE_10DAY}
      DELETE WHERE resolved_at IS NULL
        AND (tx_hash, wallet, condition_id, outcome_index) IN (
          SELECT tx_hash, wallet, condition_id, outcome_index
          FROM ${TABLE_SOURCE}
          WHERE resolved_at > '${SNAPSHOT_DATE}'
            AND resolved_at IS NOT NULL
        )
    `,
  });

  console.log('   ✅ Deleted\n');

  // Step 3: Insert resolved versions
  console.log('   Inserting resolved rows...');

  await clickhouse.command({
    query: `
      INSERT INTO ${TABLE_10DAY}
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
      FROM ${TABLE_SOURCE} v
      WHERE v.resolved_at > '${SNAPSHOT_DATE}'
        AND v.resolved_at IS NOT NULL
        AND (v.tx_hash, v.wallet, v.condition_id, v.outcome_index) IN (
          SELECT tx_hash, wallet, condition_id, outcome_index
          FROM ${TABLE_10DAY}
          WHERE resolved_at IS NULL
          LIMIT ${positions_to_update}
        )
    `,
  });

  console.log(`   ✅ Updated ${positions_to_update.toLocaleString()} positions\n`);

  return positions_to_update;
}

async function verifyUpdate() {
  console.log('\n✅ Verifying Update...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_positions,
        max(resolved_at) as latest_resolution,
        dateDiff('minute', max(resolved_at), now()) as minutes_stale,
        countIf(resolved_at >= now() - INTERVAL 24 HOUR) as resolutions_last_24h
      FROM ${TABLE_10DAY}
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('   Updated Table:');
  console.log(`     Total positions: ${stats.total_positions}`);
  console.log(`     Latest resolution: ${stats.latest_resolution}`);
  console.log(`     Staleness: ${stats.minutes_stale} minutes`);
  console.log(`     Resolutions (last 24h): ${stats.resolutions_last_24h}`);
  console.log('');

  return stats;
}

async function main() {
  console.log('🔄 UPDATE 10-DAY TABLE (Simple Approach)');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log(`📋 Table: ${TABLE_10DAY}`);
  console.log('═'.repeat(70));

  try {
    // Step 1: Add brand new positions (entered after snapshot)
    const added = await addNewPositions();

    // Step 2: Update positions that transitioned from unresolved → resolved
    const updated = await updateUnresolvedToResolved();

    // Verify
    const stats = await verifyUpdate();

    console.log('═'.repeat(70));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n✅ Added ${added.toLocaleString()} new positions`);
    console.log(`✅ Updated ${updated.toLocaleString()} resolved positions`);
    console.log(`\n📊 Table Status:`);
    console.log(`   Latest resolution: ${stats.latest_resolution}`);
    console.log(`   Staleness: ${stats.minutes_stale} minutes`);
    console.log('\n💡 Table is now current and ready for leaderboard queries!');
    console.log('   Use GROUP BY deduplication in all queries (see HOW_TO_USE_10DAY_TABLE.md)\n');

    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Update error:', error);
    process.exit(1);
  }
}

main();
