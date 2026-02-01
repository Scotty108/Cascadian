#!/usr/bin/env npx tsx
/**
 * Deduplicate Main Unified Table
 *
 * Uses 60-bucket parallel deduplication to stay under memory limits.
 * Processes in 4 waves of 15 buckets each.
 *
 * Current state:
 * - Table: pm_trade_fifo_roi_v3_mat_unified
 * - ~281M rows with ~1.25M duplicates (0.45% dup rate)
 *
 * Expected after dedup: ~280M unique rows
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const SOURCE_TABLE = 'pm_trade_fifo_roi_v3_mat_unified';
const CLEAN_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_clean';
const BACKUP_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_old';
const NUM_BUCKETS = 120;  // More buckets = smaller chunks
const WAVE_SIZE = 1;      // Sequential processing

async function createEmptyTable() {
  console.log('\n📋 Creating Empty Destination Table...\n');

  // Drop if exists (cleanup from previous failed run)
  try {
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${CLEAN_TABLE}` });
  } catch (e) {
    // Ignore
  }

  // Create empty table with same schema
  await clickhouse.command({
    query: `
      CREATE TABLE ${CLEAN_TABLE}
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
      AS
      SELECT *
      FROM ${SOURCE_TABLE}
      WHERE 1 = 0
    `,
  });

  console.log('   ✅ Empty table created\n');
}

async function processBucket(bucketId: number): Promise<{ bucketId: number; rows: number; elapsed: string }> {
  const startTime = Date.now();

  // Insert deduplicated data for this bucket
  await clickhouse.command({
    query: `
      INSERT INTO ${CLEAN_TABLE}
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        any(entry_time) as entry_time,
        any(resolved_at) as resolved_at,
        any(tokens) as tokens,
        any(cost_usd) as cost_usd,
        any(tokens_sold_early) as tokens_sold_early,
        any(tokens_held) as tokens_held,
        any(exit_value) as exit_value,
        any(pnl_usd) as pnl_usd,
        any(roi) as roi,
        any(pct_sold_early) as pct_sold_early,
        any(is_maker) as is_maker,
        any(is_closed) as is_closed,
        any(is_short) as is_short
      FROM ${SOURCE_TABLE}
      WHERE cityHash64(wallet) % ${NUM_BUCKETS} = ${bucketId}
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    `,
    clickhouse_settings: {
      max_execution_time: 600,
      max_memory_usage: 6000000000, // 6GB per bucket
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  return { bucketId, rows: 0, elapsed }; // rows counted separately
}

async function processWave(waveNum: number, bucketIds: number[]) {
  // For sequential processing (WAVE_SIZE=1), just process one at a time
  const results = [];
  for (const id of bucketIds) {
    if (waveNum % 10 === 1 || waveNum === NUM_BUCKETS) {
      console.log(`   Processing bucket ${id}/${NUM_BUCKETS}...`);
    }
    const result = await processBucket(id);
    results.push(result);
  }
  return results;
}

async function verifyCleanTable(): Promise<boolean> {
  console.log('\n🔍 Verifying Clean Table...\n');

  // Get counts
  const oldResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM ${SOURCE_TABLE}`,
    format: 'JSONEachRow',
  });
  const oldCount = ((await oldResult.json()) as any)[0].cnt;

  const newResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM ${CLEAN_TABLE}`,
    format: 'JSONEachRow',
  });
  const newCount = ((await newResult.json()) as any)[0].cnt;

  console.log(`   Source table: ${Number(oldCount).toLocaleString()} rows`);
  console.log(`   Clean table: ${Number(newCount).toLocaleString()} rows`);
  console.log(`   Removed: ${(oldCount - newCount).toLocaleString()} duplicates`);

  // Sample duplicate check
  const dupCheck = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        count() - uniq(tx_hash, wallet, condition_id, outcome_index) as approx_dups
      FROM ${CLEAN_TABLE}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const dup = ((await dupCheck.json()) as any)[0];
  console.log(`   Duplicate check (7-day sample): ${Number(dup.approx_dups).toLocaleString()} approx dups`);

  if (newCount > 0 && dup.approx_dups === 0) {
    console.log('\n   ✅ Clean table is GOOD!\n');
    return true;
  }

  console.log('\n   ⚠️  Issues detected\n');
  return false;
}

async function swapTables() {
  console.log('\n🔄 Swapping Tables (Atomic)...\n');

  // Drop old backup if exists
  try {
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${BACKUP_TABLE}` });
  } catch (e) {
    // Ignore
  }

  await clickhouse.command({
    query: `
      RENAME TABLE
        ${SOURCE_TABLE} TO ${BACKUP_TABLE},
        ${CLEAN_TABLE} TO ${SOURCE_TABLE}
    `,
  });

  console.log('   ✅ Tables swapped!\n');
  console.log(`     ${SOURCE_TABLE} → ${BACKUP_TABLE} (backup)`);
  console.log(`     ${CLEAN_TABLE} → ${SOURCE_TABLE} (now active)`);
}

async function main() {
  console.log('🧹 DEDUPLICATE MAIN UNIFIED TABLE');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log(`📋 Table: ${SOURCE_TABLE}`);
  console.log(`🔢 Strategy: ${NUM_BUCKETS} buckets in ${NUM_BUCKETS / WAVE_SIZE} waves of ${WAVE_SIZE}`);
  console.log('═'.repeat(70));

  const totalStartTime = Date.now();

  try {
    // Skip initial stats to avoid memory pressure
    console.log(`\n📊 Processing ~281M rows in ${NUM_BUCKETS} sequential buckets...\n`);

    // Step 1: Create empty destination
    await createEmptyTable();

    // Step 2: Process in waves
    for (let wave = 1; wave <= NUM_BUCKETS / WAVE_SIZE; wave++) {
      const startBucket = (wave - 1) * WAVE_SIZE;
      const endBucket = wave * WAVE_SIZE;
      const bucketIds = Array.from({ length: WAVE_SIZE }, (_, i) => startBucket + i);
      await processWave(wave, bucketIds);
    }

    // Step 3: Verify
    const verified = await verifyCleanTable();
    if (!verified) {
      console.log('⚠️  Verification failed - NOT swapping tables');
      console.log(`   Clean table available at: ${CLEAN_TABLE}`);
      process.exit(1);
    }

    // Step 4: Swap
    await swapTables();

    const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log('═'.repeat(70));
    console.log('📊 COMPLETE');
    console.log('═'.repeat(70));
    console.log(`   Total time: ${totalElapsed} minutes`);
    console.log(`   Backup kept at: ${BACKUP_TABLE}`);
    console.log('\n🎯 Next: Clean up backup after verification');
    console.log(`   DROP TABLE ${BACKUP_TABLE}`);
    console.log('═'.repeat(70) + '\n');
  } catch (error) {
    console.error('\n❌ Error:', error);
    console.log(`\n   Original table unchanged: ${SOURCE_TABLE}`);
    process.exit(1);
  }
}

main();
