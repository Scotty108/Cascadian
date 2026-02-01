#!/usr/bin/env npx tsx
/**
 * Deduplicate Main Unified Table (Sequential Strategy)
 *
 * Deduplicates pm_trade_fifo_roi_v3_mat_unified using 200 buckets
 * processed ONE AT A TIME to stay under 10.80 GiB memory limit.
 *
 * Current State:
 * - ~3B rows (5x duplicated from original 590M)
 * - Expected after dedup: ~320M unique rows
 *
 * Strategy:
 * - cityHash64(wallet) % 200 = ~15M rows per bucket
 * - Process sequentially (no parallelism)
 * - 3 GB memory limit per bucket (safe margin)
 * - Resume-capable: tracks completed buckets
 *
 * Estimated Duration: 4-6 hours
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const SOURCE_TABLE = 'pm_trade_fifo_roi_v3_mat_unified';
const CLEAN_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_clean';
const OLD_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_old';

const TOTAL_BUCKETS = 200;
const MEMORY_PER_BUCKET = 3_000_000_000; // 3 GB - safe margin
const TIMEOUT_PER_BUCKET = 1200; // 20 minutes

interface BucketResult {
  bucketId: number;
  rows: number;
  elapsedMin: string;
  success: boolean;
  error?: string;
}

async function getCompletedBuckets(): Promise<Set<number>> {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT DISTINCT cityHash64(wallet) % ${TOTAL_BUCKETS} as bucket
        FROM ${CLEAN_TABLE}
      `,
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 120,
      },
    });
    const buckets = (await result.json()) as { bucket: number }[];
    return new Set(buckets.map((b) => b.bucket));
  } catch {
    return new Set();
  }
}

async function ensureCleanTableExists(): Promise<void> {
  const existsResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM system.tables WHERE database = currentDatabase() AND name = '${CLEAN_TABLE}'`,
    format: 'JSONEachRow',
  });
  const exists = ((await existsResult.json())[0] as { cnt: number }).cnt > 0;

  if (!exists) {
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
  } else {
    console.log(`   ✅ Clean table already exists\n`);
  }
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
      clickhouse_settings: {
        max_execution_time: 120,
      },
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

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  DEDUPLICATE pm_trade_fifo_roi_v3_mat_unified');
  console.log('  Sequential Strategy (200 Buckets, One at a Time)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log(`  Source:  ${SOURCE_TABLE}`);
  console.log(`  Buckets: ${TOTAL_BUCKETS} (processed sequentially)`);
  console.log(`  Memory:  ${(MEMORY_PER_BUCKET / 1e9).toFixed(1)} GB per bucket`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Ensure clean table exists
  await ensureCleanTableExists();

  // Check completed buckets
  const completedBuckets = await getCompletedBuckets();
  console.log(`   Previously completed: ${completedBuckets.size}/${TOTAL_BUCKETS} buckets`);

  const bucketsToProcess = [];
  for (let i = 0; i < TOTAL_BUCKETS; i++) {
    if (!completedBuckets.has(i)) {
      bucketsToProcess.push(i);
    }
  }

  if (bucketsToProcess.length === 0) {
    console.log('\n   ✅ All buckets already processed!\n');
    return;
  }

  console.log(`   Remaining: ${bucketsToProcess.length} buckets\n`);

  const totalStartTime = Date.now();
  let totalRows = 0;
  let failedBuckets: number[] = [];
  let consecutiveFailures = 0;

  for (let i = 0; i < bucketsToProcess.length; i++) {
    const bucketId = bucketsToProcess[i];
    const progress = ((i + 1 + completedBuckets.size) / TOTAL_BUCKETS * 100).toFixed(1);

    process.stdout.write(`   [${progress}%] Bucket ${bucketId}... `);

    const result = await processBucket(bucketId);

    if (result.success) {
      console.log(`✅ ${result.rows.toLocaleString()} rows (${result.elapsedMin} min)`);
      totalRows += result.rows;
      consecutiveFailures = 0;
    } else {
      console.log(`❌ ${result.error?.slice(0, 60)}`);
      failedBuckets.push(bucketId);
      consecutiveFailures++;

      // Stop if too many consecutive failures
      if (consecutiveFailures >= 5) {
        console.log('\n   ⚠️  5 consecutive failures - stopping');
        break;
      }
    }

    // Progress update every 10 buckets
    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);
      const rate = (i + 1) / parseFloat(elapsed);
      const remaining = (bucketsToProcess.length - i - 1) / rate;
      console.log(`\n   --- Progress: ${i + 1}/${bucketsToProcess.length} buckets | ${elapsed} min elapsed | ~${remaining.toFixed(0)} min remaining ---\n`);
    }
  }

  const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  Total time: ${totalElapsed} minutes`);
  console.log(`  Rows inserted this run: ${totalRows.toLocaleString()}`);
  console.log(`  Failed buckets: ${failedBuckets.length}`);

  if (failedBuckets.length > 0) {
    console.log(`\n  ⚠️  Failed: [${failedBuckets.join(', ')}]`);
    console.log('  Re-run to retry failed buckets');
  } else {
    console.log('\n  ✅ All buckets processed successfully!');
    console.log('\n  Next steps:');
    console.log('  1. Verify: SELECT count() FROM ' + CLEAN_TABLE);
    console.log('  2. Swap:   RENAME TABLE ' + SOURCE_TABLE + ' TO ' + OLD_TABLE + ', ' + CLEAN_TABLE + ' TO ' + SOURCE_TABLE);
  }
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  process.exit(failedBuckets.length > 0 ? 1 : 0);
}

main();
