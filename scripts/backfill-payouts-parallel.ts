/**
 * Parallel Payout Vector Backfill
 *
 * Fetches 170,448 missing payout vectors from Goldsky API
 * Supports multi-worker parallel execution with checkpointing
 *
 * USAGE:
 *   npx tsx backfill-payouts-parallel.ts --worker=1 --of=4
 *   npx tsx backfill-payouts-parallel.ts --worker=2 --of=4
 *   npx tsx backfill-payouts-parallel.ts --worker=3 --of=4
 *   npx tsx backfill-payouts-parallel.ts --worker=4 --of=4
 *
 * FEATURES:
 * - Parallel worker support (split 170k IDs across N workers)
 * - Checkpoint/resume capability
 * - Batch processing (1,000 IDs per GraphQL query)
 * - Concurrent requests (5-10 per worker)
 * - Progress logging to JSONL
 * - Graceful shutdown on Ctrl+C
 *
 * @module backfill-payouts-parallel
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import * as fs from 'fs';
import { clickhouse } from '@/lib/clickhouse/client';
import { fetchPayoutsBatch, PayoutVector } from '@/lib/polymarket/goldsky-payouts';

// ============================================================================
// Configuration
// ============================================================================

const CONDITION_IDS_FILE = resolve(process.cwd(), 'reports/condition_ids_missing_api.txt');
const BATCH_SIZE = 1000; // IDs per GraphQL query (Goldsky limit)
const CONCURRENT_REQUESTS = 8; // Concurrent GraphQL requests per worker
const CLICKHOUSE_BATCH_SIZE = 1000; // Rows per ClickHouse insert
const CHECKPOINT_INTERVAL = 10; // Save checkpoint every N batches

// Parse CLI args
function getArg(flag: string): string | null {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`));
  return arg ? arg.split('=')[1] : null;
}

const WORKER_NUM = parseInt(getArg('worker') || '1');
const TOTAL_WORKERS = parseInt(getArg('of') || '1');

const CHECKPOINT_FILE = resolve(
  process.cwd(),
  `runtime/payout-backfill-worker${WORKER_NUM}.checkpoint.json`
);
const PROGRESS_LOG = resolve(
  process.cwd(),
  `runtime/payout-backfill-worker${WORKER_NUM}.progress.jsonl`
);

// ============================================================================
// Types
// ============================================================================

interface Checkpoint {
  workerNum: number;
  batchesProcessed: number;
  lastBatchIndex: number;
  totalIdsProcessed: number;
  totalPayoutsFound: number;
  totalErrors: number;
  startTime: string;
  lastSaveTime: string;
}

interface WorkerStats {
  idsProcessed: number;
  payoutsFound: number;
  payoutsInserted: number;
  errors: number;
  skipped: number;
}

// ============================================================================
// Global State
// ============================================================================

let globalCheckpoint: Checkpoint = {
  workerNum: WORKER_NUM,
  batchesProcessed: 0,
  lastBatchIndex: -1,
  totalIdsProcessed: 0,
  totalPayoutsFound: 0,
  totalErrors: 0,
  startTime: new Date().toISOString(),
  lastSaveTime: new Date().toISOString(),
};

let globalStats: WorkerStats = {
  idsProcessed: 0,
  payoutsFound: 0,
  payoutsInserted: 0,
  errors: 0,
  skipped: 0,
};

let shouldShutdown = false;

// ============================================================================
// Checkpoint & Logging
// ============================================================================

function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('⚠️  Failed to load checkpoint:', error);
  }
  return null;
}

function saveCheckpoint() {
  try {
    globalCheckpoint.lastSaveTime = new Date().toISOString();
    globalCheckpoint.totalIdsProcessed = globalStats.idsProcessed;
    globalCheckpoint.totalPayoutsFound = globalStats.payoutsFound;
    globalCheckpoint.totalErrors = globalStats.errors;

    fs.mkdirSync(resolve(process.cwd(), 'runtime'), { recursive: true });
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(globalCheckpoint, null, 2));
  } catch (error) {
    console.error('⚠️  Failed to save checkpoint:', error);
  }
}

function logProgress(batchIndex: number, idsInBatch: number, payoutsFound: number, duration: number) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    worker: WORKER_NUM,
    batch_index: batchIndex,
    ids_in_batch: idsInBatch,
    payouts_found: payoutsFound,
    duration_ms: duration,
    total_processed: globalStats.idsProcessed,
    total_found: globalStats.payoutsFound,
    total_inserted: globalStats.payoutsInserted,
  };

  try {
    fs.mkdirSync(resolve(process.cwd(), 'runtime'), { recursive: true });
    fs.appendFileSync(PROGRESS_LOG, JSON.stringify(logEntry) + '\n');
  } catch (error) {
    // Non-critical
  }
}

function printProgress() {
  const startTime = new Date(globalCheckpoint.startTime).getTime();
  const elapsed = (Date.now() - startTime) / 1000 / 60; // minutes
  const rate = globalStats.idsProcessed / elapsed;
  const foundRate = (globalStats.payoutsFound / globalStats.idsProcessed) * 100;

  console.log(`\n📊 WORKER ${WORKER_NUM} PROGRESS`);
  console.log(`   IDs processed: ${globalStats.idsProcessed.toLocaleString()}`);
  console.log(`   Payouts found: ${globalStats.payoutsFound.toLocaleString()} (${foundRate.toFixed(1)}%)`);
  console.log(`   Payouts inserted: ${globalStats.payoutsInserted.toLocaleString()}`);
  console.log(`   Rate: ${rate.toFixed(0)} IDs/min`);
  console.log(`   Errors: ${globalStats.errors}, Skipped: ${globalStats.skipped}`);
  console.log(`   Elapsed: ${elapsed.toFixed(1)} min`);
}

// ============================================================================
// Data Loading
// ============================================================================

/**
 * Load condition IDs from file and split for this worker
 */
function loadConditionIds(): string[] {
  console.log(`📋 Loading condition IDs from ${CONDITION_IDS_FILE}...`);

  const content = fs.readFileSync(CONDITION_IDS_FILE, 'utf8');
  const allIds = content.trim().split('\n');

  console.log(`   Total IDs in file: ${allIds.length.toLocaleString()}`);

  // Split into worker chunks
  const idsPerWorker = Math.ceil(allIds.length / TOTAL_WORKERS);
  const startIdx = (WORKER_NUM - 1) * idsPerWorker;
  const endIdx = Math.min(WORKER_NUM * idsPerWorker, allIds.length);

  const workerIds = allIds.slice(startIdx, endIdx);

  console.log(`✅ Worker ${WORKER_NUM}/${TOTAL_WORKERS}: ${workerIds.length.toLocaleString()} IDs (indices ${startIdx}-${endIdx})`);

  return workerIds;
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Process a single batch of condition IDs
 */
async function processBatch(
  conditionIds: string[],
  batchIndex: number
): Promise<{ payouts: PayoutVector[]; errors: number }> {
  const startTime = Date.now();

  try {
    const payouts = await fetchPayoutsBatch(conditionIds);

    const duration = Date.now() - startTime;
    logProgress(batchIndex, conditionIds.length, payouts.length, duration);

    return { payouts, errors: 0 };

  } catch (error) {
    console.error(`❌ Batch ${batchIndex} failed:`, error instanceof Error ? error.message : String(error));
    return { payouts: [], errors: 1 };
  }
}

/**
 * Insert payouts into ClickHouse
 */
async function insertPayouts(payouts: PayoutVector[]): Promise<number> {
  if (payouts.length === 0) {
    return 0;
  }

  let totalInserted = 0;

  // Insert in batches
  for (let i = 0; i < payouts.length; i += CLICKHOUSE_BATCH_SIZE) {
    const batch = payouts.slice(i, i + CLICKHOUSE_BATCH_SIZE);

    try {
      // Convert to ClickHouse format
      const rows = batch.map(p => ({
        condition_id: p.condition_id,
        payout_numerators: p.payout_numerators,
        payout_denominator: p.payout_denominator,
        winning_index: p.winning_index,
        resolved_at: Math.floor(p.resolved_at.getTime() / 1000), // Unix timestamp
        source: p.source,
      }));

      await clickhouse.insert({
        table: 'default.resolutions_external_ingest',
        values: rows,
        format: 'JSONEachRow',
      });

      totalInserted += batch.length;

    } catch (error) {
      console.error(`⚠️  ClickHouse insert failed for ${batch.length} rows:`, error);
      globalStats.errors++;
    }
  }

  return totalInserted;
}

/**
 * Process batches concurrently with concurrency limit
 */
async function processBatchesConcurrent(
  allConditionIds: string[],
  startBatchIndex: number
): Promise<void> {
  // Split into batches of BATCH_SIZE
  const batches: string[][] = [];
  for (let i = 0; i < allConditionIds.length; i += BATCH_SIZE) {
    batches.push(allConditionIds.slice(i, i + BATCH_SIZE));
  }

  console.log(`\n🚀 Processing ${batches.length} batches with concurrency ${CONCURRENT_REQUESTS}...\n`);

  // Process with concurrency limit
  for (let i = startBatchIndex; i < batches.length && !shouldShutdown; i += CONCURRENT_REQUESTS) {
    const batchGroup = batches.slice(i, i + CONCURRENT_REQUESTS);
    const batchPromises = batchGroup.map((batch, idx) =>
      processBatch(batch, i + idx)
    );

    const results = await Promise.all(batchPromises);

    // Aggregate results and insert
    const allPayouts = results.flatMap(r => r.payouts);
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

    globalStats.idsProcessed += batchGroup.reduce((sum, batch) => sum + batch.length, 0);
    globalStats.payoutsFound += allPayouts.length;
    globalStats.errors += totalErrors;

    // Insert into ClickHouse
    const inserted = await insertPayouts(allPayouts);
    globalStats.payoutsInserted += inserted;

    // Update checkpoint
    globalCheckpoint.batchesProcessed += batchGroup.length;
    globalCheckpoint.lastBatchIndex = i + batchGroup.length - 1;

    // Save checkpoint periodically
    if (globalCheckpoint.batchesProcessed % CHECKPOINT_INTERVAL === 0) {
      saveCheckpoint();
      printProgress();
    }
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

function setupShutdownHandler() {
  process.on('SIGINT', () => {
    console.log('\n\n⚠️  Shutdown signal received (Ctrl+C)');
    console.log('   Saving checkpoint and exiting gracefully...\n');
    shouldShutdown = true;
    saveCheckpoint();
    printProgress();
    process.exit(0);
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═'.repeat(80));
  console.log(`🚀 PAYOUT BACKFILL - WORKER ${WORKER_NUM}/${TOTAL_WORKERS}`);
  console.log('═'.repeat(80));
  console.log(`\n⚙️  Configuration:`);
  console.log(`   Batch size: ${BATCH_SIZE} IDs/query`);
  console.log(`   Concurrent requests: ${CONCURRENT_REQUESTS}`);
  console.log(`   ClickHouse batch size: ${CLICKHOUSE_BATCH_SIZE}`);
  console.log(`   Checkpoint file: ${CHECKPOINT_FILE}`);
  console.log(`   Progress log: ${PROGRESS_LOG}\n`);

  setupShutdownHandler();

  try {
    // Load checkpoint if exists
    const checkpoint = loadCheckpoint();
    let startBatchIndex = 0;

    if (checkpoint) {
      console.log('📂 Resuming from checkpoint:');
      console.log(`   Batches processed: ${checkpoint.batchesProcessed}`);
      console.log(`   Last batch index: ${checkpoint.lastBatchIndex}`);
      console.log(`   IDs processed: ${checkpoint.totalIdsProcessed.toLocaleString()}`);
      console.log(`   Payouts found: ${checkpoint.totalPayoutsFound.toLocaleString()}\n`);

      globalCheckpoint = checkpoint;
      globalStats.idsProcessed = checkpoint.totalIdsProcessed;
      globalStats.payoutsFound = checkpoint.totalPayoutsFound;
      startBatchIndex = checkpoint.lastBatchIndex + 1;
    }

    // Load condition IDs for this worker
    const conditionIds = loadConditionIds();

    if (conditionIds.length === 0) {
      console.log('✅ No IDs to process!');
      return;
    }

    // Skip already processed IDs
    const remainingIds = conditionIds.slice(startBatchIndex * BATCH_SIZE);

    if (remainingIds.length === 0) {
      console.log('✅ All IDs already processed!');
      printProgress();
      return;
    }

    console.log(`\n📊 Starting backfill...`);
    console.log(`   Remaining IDs: ${remainingIds.length.toLocaleString()}\n`);

    // Process batches
    await processBatchesConcurrent(remainingIds, 0);

    // Final save
    saveCheckpoint();

    console.log('\n' + '═'.repeat(80));
    console.log(`✅ WORKER ${WORKER_NUM} COMPLETE!`);
    console.log('═'.repeat(80));
    printProgress();

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    saveCheckpoint();
    process.exit(1);
  }
}

main().catch(console.error);
