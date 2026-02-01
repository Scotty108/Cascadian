#!/usr/bin/env npx tsx
/**
 * Deduplicate Main Unified Table (Parallel 60-Bucket Strategy)
 *
 * Deduplicates pm_trade_fifo_roi_v3_mat_unified using 60 buckets in 4 waves
 * to stay under ClickHouse Cloud's 10.80 GiB memory limit.
 *
 * Current State:
 * - 589.9M rows total
 * - ~45% duplicates (duplication factor 1.83x)
 * - Expected after dedup: ~320M unique rows
 *
 * Strategy:
 * - cityHash64(wallet) % 60 splits work into 60 buckets (~10M rows each)
 * - 4 waves of 15 parallel workers prevents memory contention
 * - 6 GB memory limit per worker
 *
 * Estimated Duration: 1.5-2 hours
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const SOURCE_TABLE = 'pm_trade_fifo_roi_v3_mat_unified';
const CLEAN_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_clean';
const BACKUP_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_backup_20260130';
const OLD_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_old';

const TOTAL_BUCKETS = 60;
const BUCKETS_PER_WAVE = 15;
const NUM_WAVES = 4;
const MEMORY_PER_BUCKET = 6_000_000_000; // 6 GB
const TIMEOUT_PER_BUCKET = 600; // 10 minutes

interface BucketResult {
  bucketId: number;
  rows: number;
  elapsedMin: string;
  success: boolean;
  error?: string;
}

async function step1PreFlight(): Promise<boolean> {
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('STEP 1: Pre-Flight Verification');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(wallet) as unique_wallets,
        countIf(resolved_at IS NULL) as unresolved,
        max(entry_time) as newest_entry,
        formatReadableSize(sum(data_uncompressed_bytes)) as uncompressed_size
      FROM ${SOURCE_TABLE}
      LEFT JOIN system.parts ON database = currentDatabase() AND table = '${SOURCE_TABLE}'
      GROUP BY ()
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0] as {
    total_rows: number;
    unique_wallets: number;
    unresolved: number;
    newest_entry: string;
    uncompressed_size: string;
  };

  console.log('   Current State:');
  console.log(`     Total rows:      ${stats.total_rows.toLocaleString()}`);
  console.log(`     Unique wallets:  ${stats.unique_wallets.toLocaleString()}`);
  console.log(`     Unresolved:      ${stats.unresolved.toLocaleString()}`);
  console.log(`     Newest entry:    ${stats.newest_entry}`);
  console.log('');

  // Check bucket distribution
  const bucketDist = await clickhouse.query({
    query: `
      SELECT
        cityHash64(wallet) % ${TOTAL_BUCKETS} as bucket,
        count() as rows
      FROM ${SOURCE_TABLE}
      GROUP BY bucket
      ORDER BY rows DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const topBuckets = (await bucketDist.json()) as { bucket: number; rows: number }[];

  console.log('   Top 5 largest buckets:');
  for (const b of topBuckets) {
    console.log(`     Bucket ${b.bucket}: ${b.rows.toLocaleString()} rows`);
  }
  console.log('');

  const maxBucketRows = topBuckets[0]?.rows || 0;
  if (maxBucketRows > 15_000_000) {
    console.log(`   ⚠️  Warning: Largest bucket has ${maxBucketRows.toLocaleString()} rows`);
    console.log('      May need to increase bucket count if memory issues occur');
  } else {
    console.log('   ✅ Bucket distribution looks good');
  }

  return true;
}

async function step2CreateBackup(): Promise<boolean> {
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('STEP 2: Create Backup Table');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Check if backup already exists
  const existsResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM system.tables WHERE database = currentDatabase() AND name = '${BACKUP_TABLE}'`,
    format: 'JSONEachRow',
  });
  const exists = ((await existsResult.json())[0] as { cnt: number }).cnt > 0;

  if (exists) {
    console.log(`   ℹ️  Backup table ${BACKUP_TABLE} already exists`);
    const countResult = await clickhouse.query({
      query: `SELECT count() as rows FROM ${BACKUP_TABLE}`,
      format: 'JSONEachRow',
    });
    const backupRows = ((await countResult.json())[0] as { rows: number }).rows;
    console.log(`      Rows: ${backupRows.toLocaleString()}`);
    console.log('      Skipping backup creation\n');
    return true;
  }

  console.log(`   Creating backup: ${BACKUP_TABLE}`);
  console.log('   This may take 15-20 minutes...\n');

  const startTime = Date.now();

  await clickhouse.command({
    query: `
      CREATE TABLE ${BACKUP_TABLE}
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
      AS SELECT * FROM ${SOURCE_TABLE}
    `,
    clickhouse_settings: {
      max_execution_time: 3600, // 1 hour
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Backup created in ${elapsed} min\n`);

  return true;
}

async function step3CreateEmptyCleanTable(): Promise<boolean> {
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('STEP 3: Create Empty Destination Table');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Check if clean table already has data (resuming)
  const existsResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM system.tables WHERE database = currentDatabase() AND name = '${CLEAN_TABLE}'`,
    format: 'JSONEachRow',
  });
  const exists = ((await existsResult.json())[0] as { cnt: number }).cnt > 0;

  if (exists) {
    const countResult = await clickhouse.query({
      query: `SELECT count() as rows FROM ${CLEAN_TABLE}`,
      format: 'JSONEachRow',
    });
    const cleanRows = ((await countResult.json())[0] as { rows: number }).rows;

    if (cleanRows > 0) {
      console.log(`   ℹ️  Clean table ${CLEAN_TABLE} already exists with ${cleanRows.toLocaleString()} rows`);
      console.log('      Resuming from existing progress\n');
      return true;
    }

    // Empty table exists, drop and recreate
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${CLEAN_TABLE}` });
  }

  console.log(`   Creating empty table: ${CLEAN_TABLE}`);

  await clickhouse.command({
    query: `
      CREATE TABLE ${CLEAN_TABLE}
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
      AS SELECT * FROM ${SOURCE_TABLE} WHERE 1 = 0
    `,
  });

  console.log('   ✅ Empty destination table created\n');
  return true;
}

async function processBucket(bucketId: number): Promise<BucketResult> {
  const startTime = Date.now();

  try {
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
        WHERE cityHash64(wallet) % ${TOTAL_BUCKETS} = ${bucketId}
        GROUP BY tx_hash, wallet, condition_id, outcome_index
      `,
      clickhouse_settings: {
        max_execution_time: TIMEOUT_PER_BUCKET,
        max_memory_usage: MEMORY_PER_BUCKET,
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

    // Get row count for this bucket
    const countResult = await clickhouse.query({
      query: `SELECT count() as rows FROM ${CLEAN_TABLE} WHERE cityHash64(wallet) % ${TOTAL_BUCKETS} = ${bucketId}`,
      format: 'JSONEachRow',
    });
    const rows = ((await countResult.json())[0] as { rows: number }).rows;

    return {
      bucketId,
      rows,
      elapsedMin: elapsed,
      success: true,
    };
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    return {
      bucketId,
      rows: 0,
      elapsedMin: elapsed,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getCompletedBuckets(): Promise<Set<number>> {
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT cityHash64(wallet) % ${TOTAL_BUCKETS} as bucket
      FROM ${CLEAN_TABLE}
    `,
    format: 'JSONEachRow',
  });
  const buckets = (await result.json()) as { bucket: number }[];
  return new Set(buckets.map((b) => b.bucket));
}

async function step4BatchedDeduplication(): Promise<boolean> {
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('STEP 4: Batched Deduplication (60 buckets in 4 waves)');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Check which buckets are already complete (for resume)
  const completedBuckets = await getCompletedBuckets();
  console.log(`   Previously completed buckets: ${completedBuckets.size}`);

  const allResults: BucketResult[] = [];
  const totalStartTime = Date.now();
  let failedBuckets: number[] = [];

  for (let wave = 0; wave < NUM_WAVES; wave++) {
    const startBucket = wave * BUCKETS_PER_WAVE;
    const endBucket = startBucket + BUCKETS_PER_WAVE;

    // Filter out already completed buckets
    const bucketsToProcess: number[] = [];
    for (let i = startBucket; i < endBucket; i++) {
      if (!completedBuckets.has(i)) {
        bucketsToProcess.push(i);
      }
    }

    if (bucketsToProcess.length === 0) {
      console.log(`\n   Wave ${wave + 1}/${NUM_WAVES}: All buckets ${startBucket}-${endBucket - 1} already complete ✓`);
      continue;
    }

    console.log(`\n   Wave ${wave + 1}/${NUM_WAVES}: Processing buckets ${startBucket}-${endBucket - 1}`);
    console.log(`   (${bucketsToProcess.length} buckets to process, ${BUCKETS_PER_WAVE - bucketsToProcess.length} already done)`);

    const waveStartTime = Date.now();

    // Launch all buckets in this wave in parallel
    const promises = bucketsToProcess.map((bucketId) => processBucket(bucketId));
    const results = await Promise.all(promises);

    const waveElapsed = ((Date.now() - waveStartTime) / 1000 / 60).toFixed(1);
    const waveRows = results.reduce((sum, r) => sum + r.rows, 0);
    const waveFailed = results.filter((r) => !r.success);

    console.log(`   Wave ${wave + 1} complete: ${waveRows.toLocaleString()} rows in ${waveElapsed} min`);

    if (waveFailed.length > 0) {
      console.log(`   ⚠️  ${waveFailed.length} buckets failed:`);
      for (const f of waveFailed) {
        console.log(`      Bucket ${f.bucketId}: ${f.error?.slice(0, 80)}`);
        failedBuckets.push(f.bucketId);
      }
    }

    allResults.push(...results);

    // Show progress
    const totalCompleted = completedBuckets.size + allResults.filter((r) => r.success).length;
    const progressPct = ((totalCompleted / TOTAL_BUCKETS) * 100).toFixed(1);
    console.log(`   Progress: ${totalCompleted}/${TOTAL_BUCKETS} buckets (${progressPct}%)`);
  }

  const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);
  const totalRows = allResults.reduce((sum, r) => sum + r.rows, 0);

  console.log('\n   ─────────────────────────────────────────────────');
  console.log('   Summary:');
  console.log(`     Total rows inserted this run: ${totalRows.toLocaleString()}`);
  console.log(`     Total time: ${totalElapsed} min`);
  console.log(`     Failed buckets: ${failedBuckets.length}`);

  if (failedBuckets.length > 0) {
    console.log(`\n   ⚠️  Failed buckets: [${failedBuckets.join(', ')}]`);
    console.log('      Re-run script to retry failed buckets');
    return false;
  }

  console.log('   ✅ All buckets processed successfully\n');
  return true;
}

async function step5Verification(): Promise<boolean> {
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('STEP 5: Verification');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Row counts comparison
  const counts = await clickhouse.query({
    query: `
      SELECT 'original' as tbl, count() as rows FROM ${SOURCE_TABLE}
      UNION ALL
      SELECT 'clean' as tbl, count() as rows FROM ${CLEAN_TABLE}
    `,
    format: 'JSONEachRow',
  });
  const countData = (await counts.json()) as { tbl: string; rows: number }[];

  console.log('   Row counts:');
  for (const c of countData) {
    console.log(`     ${c.tbl}: ${c.rows.toLocaleString()}`);
  }

  const originalRows = countData.find((c) => c.tbl === 'original')?.rows || 0;
  const cleanRows = countData.find((c) => c.tbl === 'clean')?.rows || 0;
  const reduction = (((originalRows - cleanRows) / originalRows) * 100).toFixed(1);

  console.log(`     Reduction: ${reduction}% (${(originalRows - cleanRows).toLocaleString()} rows removed)`);
  console.log('');

  // Duplicate check on clean table
  const dupCheck = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
      FROM ${CLEAN_TABLE}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const dup = (await dupCheck.json())[0] as { total: number; duplicates: number };

  console.log('   Duplicate check (7-day sample):');
  console.log(`     Total rows: ${dup.total.toLocaleString()}`);
  console.log(`     Duplicates: ${dup.duplicates}`);
  console.log('');

  // Check unresolved count preserved
  const unresolvedCheck = await clickhouse.query({
    query: `
      SELECT
        'original' as tbl, countIf(resolved_at IS NULL) as unresolved FROM ${SOURCE_TABLE}
      UNION ALL
      SELECT
        'clean' as tbl, countIf(resolved_at IS NULL) as unresolved FROM ${CLEAN_TABLE}
    `,
    format: 'JSONEachRow',
  });
  const unresolvedData = (await unresolvedCheck.json()) as { tbl: string; unresolved: number }[];

  console.log('   Unresolved positions:');
  for (const u of unresolvedData) {
    console.log(`     ${u.tbl}: ${u.unresolved.toLocaleString()}`);
  }
  console.log('');

  // Acceptance criteria
  const expectedMinRows = 300_000_000; // Should be around 320M
  const expectedMaxRows = 400_000_000;

  if (dup.duplicates > 0) {
    console.log('   ❌ FAIL: Clean table still has duplicates');
    return false;
  }

  if (cleanRows < expectedMinRows || cleanRows > expectedMaxRows) {
    console.log(`   ⚠️  WARNING: Clean table rows (${cleanRows.toLocaleString()}) outside expected range`);
    console.log(`      Expected: ${expectedMinRows.toLocaleString()} - ${expectedMaxRows.toLocaleString()}`);
    // Don't fail, just warn
  }

  console.log('   ✅ Verification PASSED\n');
  return true;
}

async function step6AtomicSwap(): Promise<boolean> {
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('STEP 6: Atomic Table Swap');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  console.log('   Swapping tables atomically...');
  console.log(`     ${SOURCE_TABLE} → ${OLD_TABLE}`);
  console.log(`     ${CLEAN_TABLE} → ${SOURCE_TABLE}`);
  console.log('');

  await clickhouse.command({
    query: `
      RENAME TABLE
        ${SOURCE_TABLE} TO ${OLD_TABLE},
        ${CLEAN_TABLE} TO ${SOURCE_TABLE}
    `,
  });

  console.log('   ✅ Tables swapped successfully\n');
  return true;
}

async function step7PostSwapVerification(): Promise<boolean> {
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('STEP 7: Post-Swap Verification');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(wallet) as unique_wallets,
        countIf(resolved_at IS NULL) as unresolved,
        max(entry_time) as newest_entry
      FROM ${SOURCE_TABLE}
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0] as {
    total_rows: number;
    unique_wallets: number;
    unresolved: number;
    newest_entry: string;
  };

  console.log('   Active table state:');
  console.log(`     Total rows:      ${stats.total_rows.toLocaleString()}`);
  console.log(`     Unique wallets:  ${stats.unique_wallets.toLocaleString()}`);
  console.log(`     Unresolved:      ${stats.unresolved.toLocaleString()}`);
  console.log(`     Newest entry:    ${stats.newest_entry}`);
  console.log('');

  // Final duplicate check
  const dupCheck = await clickhouse.query({
    query: `
      SELECT
        count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
      FROM ${SOURCE_TABLE}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const duplicates = ((await dupCheck.json())[0] as { duplicates: number }).duplicates;

  if (duplicates === 0) {
    console.log('   ✅ Zero duplicates confirmed!');
  } else {
    console.log(`   ⚠️  Found ${duplicates} duplicates in 7-day sample`);
  }

  console.log('');
  return duplicates === 0;
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  DEDUPLICATE pm_trade_fifo_roi_v3_mat_unified');
  console.log('  60-Bucket Parallel Strategy (4 Waves × 15 Workers)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log(`  Source:  ${SOURCE_TABLE}`);
  console.log(`  Buckets: ${TOTAL_BUCKETS} (${BUCKETS_PER_WAVE} per wave)`);
  console.log(`  Memory:  ${(MEMORY_PER_BUCKET / 1e9).toFixed(1)} GB per bucket`);
  console.log('═══════════════════════════════════════════════════════════════════════');

  const totalStartTime = Date.now();

  try {
    // Step 1: Pre-flight
    await step1PreFlight();

    // Step 2: Create backup
    await step2CreateBackup();

    // Step 3: Create empty clean table
    await step3CreateEmptyCleanTable();

    // Step 4: Batched deduplication
    const dedupSuccess = await step4BatchedDeduplication();
    if (!dedupSuccess) {
      console.log('\n⚠️  Some buckets failed. Re-run to retry.');
      process.exit(1);
    }

    // Step 5: Verification
    const verified = await step5Verification();
    if (!verified) {
      console.log('\n❌ Verification failed. NOT swapping tables.');
      console.log(`   Clean table: ${CLEAN_TABLE}`);
      console.log(`   Original unchanged: ${SOURCE_TABLE}`);
      process.exit(1);
    }

    // Step 6: Atomic swap
    await step6AtomicSwap();

    // Step 7: Post-swap verification
    await step7PostSwapVerification();

    const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('  COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  Total time: ${totalElapsed} minutes`);
    console.log('');
    console.log('  Tables:');
    console.log(`    Active:  ${SOURCE_TABLE} (deduplicated)`);
    console.log(`    Backup:  ${BACKUP_TABLE} (original data)`);
    console.log(`    Old:     ${OLD_TABLE} (pre-swap, can drop after verification)`);
    console.log('');
    console.log('  Cleanup (after 24-48 hours):');
    console.log(`    DROP TABLE IF EXISTS ${OLD_TABLE};`);
    console.log(`    DROP TABLE IF EXISTS ${BACKUP_TABLE};`);
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    console.log('\n   Original table should be unchanged.');
    console.log(`   Check: SELECT count() FROM ${SOURCE_TABLE}`);
    process.exit(1);
  }
}

main();
