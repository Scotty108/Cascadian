#!/usr/bin/env npx tsx
/**
 * Update 10day Table with New Resolutions
 *
 * Updates positions that have resolved since the table snapshot.
 * Uses DELETE-then-INSERT pattern to avoid duplicates.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const TABLE_10DAY = 'pm_trade_fifo_roi_v3_mat_unified_10day';
const TABLE_SOURCE = 'pm_trade_fifo_roi_v3';
const SNAPSHOT_DATE = '2026-01-28 07:34:00'; // When 10day snapshot was taken

async function checkStaleness() {
  console.log('\n📊 Checking Current Status...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_positions,
        max(resolved_at) as latest_resolution,
        dateDiff('hour', max(resolved_at), now()) as hours_stale,
        countIf(resolved_at >= now() - INTERVAL 24 HOUR) as resolutions_last_24h
      FROM ${TABLE_10DAY}
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('   10day Table:');
  console.log(`     Total positions: ${stats.total_positions}`);
  console.log(`     Latest resolution: ${stats.latest_resolution}`);
  console.log(`     Staleness: ${stats.hours_stale} hours`);
  console.log(`     Resolutions (last 24h): ${stats.resolutions_last_24h}`);
  console.log('');

  return stats;
}

async function updateResolvedPositions() {
  console.log('\n🔄 Updating with New Resolutions...\n');

  const startTime = Date.now();

  // Step 1: Count positions to update
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as positions_to_update
      FROM ${TABLE_SOURCE} v
      INNER JOIN ${TABLE_10DAY} u
        ON v.tx_hash = u.tx_hash
        AND v.wallet = u.wallet
        AND v.condition_id = u.condition_id
        AND v.outcome_index = u.outcome_index
      WHERE v.resolved_at >= '${SNAPSHOT_DATE}'
        AND v.resolved_at IS NOT NULL
        AND u.resolved_at IS NULL
    `,
    format: 'JSONEachRow',
  });
  const { positions_to_update } = (await countResult.json())[0];

  console.log(`   Found ${positions_to_update.toLocaleString()} positions to update\n`);

  if (positions_to_update === 0) {
    console.log('   ✅ Table is already current!\n');
    return 0;
  }

  // Step 2: Delete old unresolved rows
  console.log('   Step 1/2: Deleting old unresolved rows...');

  await clickhouse.command({
    query: `
      ALTER TABLE ${TABLE_10DAY}
      DELETE WHERE (tx_hash, wallet, condition_id, outcome_index) IN (
        SELECT v.tx_hash, v.wallet, v.condition_id, v.outcome_index
        FROM ${TABLE_SOURCE} v
        INNER JOIN ${TABLE_10DAY} u
          ON v.tx_hash = u.tx_hash
          AND v.wallet = u.wallet
          AND v.condition_id = u.condition_id
          AND v.outcome_index = u.outcome_index
        WHERE v.resolved_at >= '${SNAPSHOT_DATE}'
          AND v.resolved_at IS NOT NULL
          AND u.resolved_at IS NULL
      )
    `,
  });

  console.log('   ✅ Deleted\n');

  // Step 3: Insert new resolved rows
  console.log('   Step 2/2: Inserting updated resolved rows...');

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
      WHERE v.resolved_at >= '${SNAPSHOT_DATE}'
        AND v.resolved_at IS NOT NULL
        AND (v.tx_hash, v.wallet, v.condition_id, v.outcome_index) IN (
          SELECT v2.tx_hash, v2.wallet, v2.condition_id, v2.outcome_index
          FROM ${TABLE_SOURCE} v2
          LEFT JOIN ${TABLE_10DAY} u
            ON v2.tx_hash = u.tx_hash
            AND v2.wallet = u.wallet
            AND v2.condition_id = u.condition_id
            AND v2.outcome_index = u.outcome_index
          WHERE v2.resolved_at >= '${SNAPSHOT_DATE}'
            AND v2.resolved_at IS NOT NULL
            AND (u.resolved_at IS NULL OR u.tx_hash IS NULL)
        )
    `,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`   ✅ Inserted ${positions_to_update.toLocaleString()} positions in ${elapsed}s\n`);

  return positions_to_update;
}

async function verifyUpdate() {
  console.log('\n✅ Verifying Update...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
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
  console.log(`     Latest resolution: ${stats.latest_resolution}`);
  console.log(`     Staleness: ${stats.minutes_stale} minutes`);
  console.log(`     Resolutions (last 24h): ${stats.resolutions_last_24h}`);
  console.log('');

  return stats;
}

async function main() {
  console.log('🔄 UPDATE 10-DAY TABLE');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log(`📋 Table: ${TABLE_10DAY}`);
  console.log('═'.repeat(70));

  try {
    // Check before
    const before = await checkStaleness();

    // Update
    const updated = await updateResolvedPositions();

    // Verify after
    if (updated > 0) {
      const after = await verifyUpdate();

      console.log('═'.repeat(70));
      console.log('📊 SUMMARY');
      console.log('═'.repeat(70));
      console.log(`\n✅ Updated ${updated.toLocaleString()} positions`);
      console.log(`   Before: ${before.hours_stale} hours stale`);
      console.log(`   After: ${after.minutes_stale} minutes stale`);
      console.log('\n💡 Table is now current and ready for leaderboard queries!');
      console.log('   See HOW_TO_USE_10DAY_TABLE.md for query examples\n');
    }

    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Update error:', error);
    process.exit(1);
  }
}

main();
