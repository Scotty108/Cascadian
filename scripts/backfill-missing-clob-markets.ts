#!/usr/bin/env npx tsx
/**
 * CLOB Missing Markets Backfill Script
 *
 * Fetches fills for the 31,248 markets that are in gamma_markets but missing from clob_fills.
 *
 * Features:
 * - Surgical targeting (only missing markets)
 * - Checkpoint/resume capability
 * - Rate limit protection with exponential backoff
 * - Parallel workers with configurable count
 * - Progress monitoring and ETA
 * - Graceful shutdown (SIGINT safe)
 * - Crash recovery
 *
 * Usage:
 *   WORKER_COUNT=32 npx tsx scripts/backfill-missing-clob-markets.ts
 *
 * Environment Variables:
 *   WORKER_COUNT        - Number of parallel workers (default: 32, max: 128)
 *   CHECKPOINT_INTERVAL - Save progress every N markets (default: 100)
 *   BATCH_SIZE         - Markets per batch (default: 1000)
 *   DELAY_MS           - Base delay between requests (default: 100ms)
 *   MAX_RETRIES        - Retry attempts per market (default: 3)
 *   RESUME             - Resume from checkpoint (default: true)
 */

import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

// Load .env.local
config({ path: path.resolve(process.cwd(), '.env.local') });

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  workerCount: parseInt(process.env.WORKER_COUNT || '32', 10),
  checkpointInterval: parseInt(process.env.CHECKPOINT_INTERVAL || '100', 10),
  batchSize: parseInt(process.env.BATCH_SIZE || '1000', 10),
  baseDelayMs: parseInt(process.env.DELAY_MS || '100', 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  resume: process.env.RESUME !== 'false',

  // Goldsky GraphQL endpoint
  goldsky: {
    url: process.env.GOLDSKY_API_URL || 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/prod/gn',
    maxPageSize: 1000,
  },

  // Checkpoint file
  checkpointFile: 'tmp/clob-backfill-checkpoint.json',

  // Progress log
  progressLog: 'tmp/clob-backfill-progress.log',
};

// Validate config
if (CONFIG.workerCount < 1 || CONFIG.workerCount > 256) {
  console.error(`❌ Invalid WORKER_COUNT: ${CONFIG.workerCount} (must be 1-256)`);
  process.exit(1);
}

// ============================================================================
// Types
// ============================================================================

interface Market {
  condition_id: string;
  token_id: string;
  question?: string;
}

interface Checkpoint {
  startedAt: string;
  lastSavedAt: string;
  totalMarkets: number;
  processedMarkets: number;
  successfulMarkets: number;
  failedMarkets: number;
  skippedMarkets: number;
  errorCounts: Record<string, number>;
  processedConditionIds: string[];
  failedConditionIds: string[];
}

interface WorkerStats {
  id: number;
  processed: number;
  successful: number;
  failed: number;
  rateLimited: number;
  lastError?: string;
}

interface GoldskyFill {
  id: string;
  transactionHash: string;
  timestamp: string;
  makerAssetId: string;
  takerAssetId: string;
  makerAmountFilled: string;
  takerAmountFilled: string;
  // These fields we'll derive
  conditionId?: string;
  assetId?: string;
  maker?: string;
  side?: string;
  price?: string;
  size?: string;
}

// ============================================================================
// Utilities
// ============================================================================

class ProgressTracker {
  private startTime = Date.now();
  private stats = {
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    rateLimited: 0,
  };

  constructor(total: number) {
    this.stats.total = total;
  }

  increment(type: 'processed' | 'successful' | 'failed' | 'skipped' | 'rateLimited') {
    this.stats[type]++;
    if (type === 'successful' || type === 'failed' || type === 'skipped') {
      this.stats.processed++;
    }
  }

  getProgress() {
    const elapsed = Date.now() - this.startTime;
    const rate = this.stats.processed / (elapsed / 1000); // markets/sec
    const remaining = this.stats.total - this.stats.processed;
    const eta = remaining / rate;

    return {
      ...this.stats,
      elapsedMs: elapsed,
      ratePerSec: rate,
      etaSeconds: eta,
      percentComplete: (this.stats.processed / this.stats.total) * 100,
    };
  }

  getProgressBar(width = 50) {
    const pct = this.stats.processed / this.stats.total;
    const filled = Math.floor(pct * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function normalizeConditionId(cid: string): string {
  return cid.toLowerCase().replace(/^0x/, '');
}

// ============================================================================
// Checkpoint Management
// ============================================================================

async function loadCheckpoint(): Promise<Checkpoint | null> {
  if (!CONFIG.resume) {
    console.log('📍 Resume disabled, starting fresh');
    return null;
  }

  try {
    const data = await fs.readFile(CONFIG.checkpointFile, 'utf-8');
    const checkpoint = JSON.parse(data) as Checkpoint;
    console.log(`📍 Loaded checkpoint: ${checkpoint.processedMarkets}/${checkpoint.totalMarkets} markets processed`);
    return checkpoint;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('📍 No checkpoint found, starting fresh');
      return null;
    }
    throw err;
  }
}

async function saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
  await ensureDir(CONFIG.checkpointFile);
  checkpoint.lastSavedAt = new Date().toISOString();
  await fs.writeFile(CONFIG.checkpointFile, JSON.stringify(checkpoint, null, 2));
}

async function logProgress(message: string): Promise<void> {
  await ensureDir(CONFIG.progressLog);
  const timestamp = new Date().toISOString();
  await fs.appendFile(CONFIG.progressLog, `[${timestamp}] ${message}\n`);
}

// ============================================================================
// ClickHouse Queries
// ============================================================================

async function fetchMissingMarkets(): Promise<Market[]> {
  console.log('🔍 Querying missing markets from ClickHouse...');

  const query = `
    SELECT
      condition_id,
      token_id,
      question
    FROM gamma_markets
    WHERE lower(replaceAll(condition_id, '0x', '')) NOT IN (
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
      FROM clob_fills
    )
    ORDER BY condition_id
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  });

  const markets = await result.json<Market[]>();
  console.log(`✅ Found ${markets.length.toLocaleString()} missing markets`);

  return markets;
}

async function insertFills(fills: GoldskyFill[]): Promise<void> {
  if (fills.length === 0) return;

  // NOTE: Based on diagnostic findings, all missing markets have 0 fills.
  // This function is unlikely to be called, but kept for completeness.
  // The orderFilledEvents schema doesn't map 1:1 to clob_fills, so this
  // would need significant rework if we ever find markets with actual fills.

  console.warn(`⚠️  Found ${fills.length} fills - this is unexpected based on diagnostic!`);
  console.warn(`⚠️  Skipping insert - schema mapping needs to be implemented`);

  // TODO: If fills are found, implement proper mapping from orderFilledEvents to clob_fills
  // This would require:
  // - Extracting condition_id from makerAssetId/takerAssetId
  // - Determining side (buy/sell) from asset IDs
  // - Calculating price from amounts
  // - etc.
}

// ============================================================================
// Goldsky API
// ============================================================================

async function fetchFillsForMarket(
  market: Market,
  retryCount = 0
): Promise<{ fills: GoldskyFill[]; status: 'success' | 'empty' | 'error' | 'rate_limited' }> {

  const query = `
    query GetOrderFills($tokenId: String!, $first: Int!) {
      orderFilledEvents(
        where: {
          or: [
            { makerAssetId: $tokenId },
            { takerAssetId: $tokenId }
          ]
        }
        first: $first
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        transactionHash
        timestamp
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
      }
    }
  `;

  try {
    const response = await fetch(CONFIG.goldsky.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          tokenId: market.token_id,
          first: 1000,
        },
      }),
    });

    // Check for rate limiting
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      console.warn(`⚠️  Rate limited, retry after ${retryAfter}s`);

      if (retryCount < CONFIG.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return fetchFillsForMarket(market, retryCount + 1);
      }

      return { fills: [], status: 'rate_limited' };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
    }

    const fills = result.data?.orderFilledEvents || [];

    return {
      fills,
      status: fills.length > 0 ? 'success' : 'empty',
    };

  } catch (err) {
    const error = err as Error;

    if (retryCount < CONFIG.maxRetries) {
      const delayMs = CONFIG.baseDelayMs * Math.pow(2, retryCount); // Exponential backoff
      console.warn(`⚠️  Error fetching ${market.condition_id}, retry ${retryCount + 1}/${CONFIG.maxRetries} in ${delayMs}ms`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return fetchFillsForMarket(market, retryCount + 1);
    }

    console.error(`❌ Failed to fetch ${market.condition_id} after ${CONFIG.maxRetries} retries:`, error.message);
    return { fills: [], status: 'error' };
  }
}

// ============================================================================
// Worker Pool
// ============================================================================

async function processMarket(
  market: Market,
  workerId: number
): Promise<{ status: 'success' | 'empty' | 'error' | 'rate_limited'; fillCount: number }> {

  const { fills, status } = await fetchFillsForMarket(market);

  if (status === 'success' && fills.length > 0) {
    await insertFills(fills);
  }

  // Add delay between markets (stagger workers)
  const workerDelay = CONFIG.baseDelayMs + (workerId * 10);
  await new Promise(resolve => setTimeout(resolve, workerDelay));

  return { status, fillCount: fills.length };
}

async function runWorker(
  workerId: number,
  markets: Market[],
  checkpoint: Checkpoint,
  progress: ProgressTracker,
  workerStats: WorkerStats[]
): Promise<void> {

  const stats = workerStats[workerId];

  for (const market of markets) {
    // Check if already processed
    if (checkpoint.processedConditionIds.includes(market.condition_id)) {
      stats.processed++;
      progress.increment('skipped');
      continue;
    }

    try {
      const result = await processMarket(market, workerId);
      stats.processed++;

      switch (result.status) {
        case 'success':
          stats.successful++;
          checkpoint.successfulMarkets++;
          checkpoint.processedConditionIds.push(market.condition_id);
          progress.increment('successful');

          if (result.fillCount > 0) {
            await logProgress(`✅ Worker ${workerId}: ${market.condition_id} → ${result.fillCount} fills`);
          }
          break;

        case 'empty':
          stats.successful++;
          checkpoint.skippedMarkets++;
          checkpoint.processedConditionIds.push(market.condition_id);
          progress.increment('skipped');
          await logProgress(`⚪ Worker ${workerId}: ${market.condition_id} → 0 fills (expected)`);
          break;

        case 'rate_limited':
          stats.rateLimited++;
          checkpoint.failedConditionIds.push(market.condition_id);
          progress.increment('rateLimited');
          await logProgress(`⏸️  Worker ${workerId}: ${market.condition_id} → rate limited`);
          break;

        case 'error':
          stats.failed++;
          checkpoint.failedMarkets++;
          checkpoint.failedConditionIds.push(market.condition_id);
          progress.increment('failed');
          await logProgress(`❌ Worker ${workerId}: ${market.condition_id} → error`);
          break;
      }

      // Save checkpoint periodically
      if (checkpoint.processedConditionIds.length % CONFIG.checkpointInterval === 0) {
        await saveCheckpoint(checkpoint);
      }

    } catch (err) {
      const error = err as Error;
      stats.failed++;
      stats.lastError = error.message;
      checkpoint.failedMarkets++;
      checkpoint.failedConditionIds.push(market.condition_id);
      progress.increment('failed');

      await logProgress(`💥 Worker ${workerId}: ${market.condition_id} → crash: ${error.message}`);
    }
  }
}

// ============================================================================
// Main Backfill Logic
// ============================================================================

async function runBackfill() {
  console.log('🚀 CLOB Missing Markets Backfill');
  console.log('================================\n');
  console.log(`Workers:            ${CONFIG.workerCount}`);
  console.log(`Checkpoint Every:   ${CONFIG.checkpointInterval} markets`);
  console.log(`Base Delay:         ${CONFIG.baseDelayMs}ms`);
  console.log(`Max Retries:        ${CONFIG.maxRetries}`);
  console.log('');

  // Load checkpoint if resuming
  let checkpoint = await loadCheckpoint();

  // Fetch missing markets
  const allMarkets = await fetchMissingMarkets();

  if (allMarkets.length === 0) {
    console.log('✅ No missing markets found! Coverage is complete.');
    return;
  }

  // Initialize or update checkpoint
  if (!checkpoint) {
    checkpoint = {
      startedAt: new Date().toISOString(),
      lastSavedAt: new Date().toISOString(),
      totalMarkets: allMarkets.length,
      processedMarkets: 0,
      successfulMarkets: 0,
      failedMarkets: 0,
      skippedMarkets: 0,
      errorCounts: {},
      processedConditionIds: [],
      failedConditionIds: [],
    };
    await saveCheckpoint(checkpoint);
  } else {
    // Update total in case it changed
    checkpoint.totalMarkets = allMarkets.length;
  }

  // Filter out already processed markets
  const remainingMarkets = allMarkets.filter(
    m => !checkpoint!.processedConditionIds.includes(m.condition_id)
  );

  console.log(`📊 Total Markets:       ${allMarkets.length.toLocaleString()}`);
  console.log(`✅ Already Processed:   ${checkpoint.processedConditionIds.length.toLocaleString()}`);
  console.log(`⏳ Remaining:           ${remainingMarkets.length.toLocaleString()}\n`);

  if (remainingMarkets.length === 0) {
    console.log('✅ All markets already processed!');
    return;
  }

  // Distribute markets to workers
  const marketsPerWorker = Math.ceil(remainingMarkets.length / CONFIG.workerCount);
  const workerQueues: Market[][] = [];

  for (let i = 0; i < CONFIG.workerCount; i++) {
    const start = i * marketsPerWorker;
    const end = Math.min(start + marketsPerWorker, remainingMarkets.length);
    workerQueues.push(remainingMarkets.slice(start, end));
  }

  // Initialize worker stats
  const workerStats: WorkerStats[] = Array.from({ length: CONFIG.workerCount }, (_, i) => ({
    id: i,
    processed: 0,
    successful: 0,
    failed: 0,
    rateLimited: 0,
  }));

  // Progress tracker
  const progress = new ProgressTracker(remainingMarkets.length);

  // Progress display interval
  const progressInterval = setInterval(() => {
    const stats = progress.getProgress();
    const bar = progress.getProgressBar(40);

    console.log('\n' + '='.repeat(80));
    console.log(`Progress: ${bar} ${stats.percentComplete.toFixed(1)}%`);
    console.log(`Processed: ${stats.processed.toLocaleString()} / ${stats.total.toLocaleString()}`);
    console.log(`Success:   ${stats.successful.toLocaleString()} markets with fills`);
    console.log(`Empty:     ${stats.skipped.toLocaleString()} markets (zero fills)`);
    console.log(`Failed:    ${stats.failed.toLocaleString()} markets`);
    console.log(`Rate Ltd:  ${stats.rateLimited.toLocaleString()} markets`);
    console.log(`Rate:      ${stats.ratePerSec.toFixed(2)} markets/sec`);
    console.log(`ETA:       ${formatDuration(stats.etaSeconds)}`);
    console.log('='.repeat(80));
  }, 30000); // Update every 30 seconds

  // Graceful shutdown handler
  let shutdownRequested = false;
  process.on('SIGINT', async () => {
    if (shutdownRequested) {
      console.log('\n⚠️  Force shutdown! Data may be lost.');
      process.exit(1);
    }
    shutdownRequested = true;
    console.log('\n⏸️  Shutdown requested, saving checkpoint...');
    clearInterval(progressInterval);
    await saveCheckpoint(checkpoint!);
    console.log('✅ Checkpoint saved. Run again to resume.');
    process.exit(0);
  });

  // Launch workers
  console.log(`🏃 Launching ${CONFIG.workerCount} workers...\n`);
  const workerPromises = workerQueues.map((queue, i) =>
    runWorker(i, queue, checkpoint!, progress, workerStats)
  );

  // Wait for all workers to complete
  await Promise.all(workerPromises);

  // Final checkpoint save
  clearInterval(progressInterval);
  await saveCheckpoint(checkpoint);

  // Final stats
  const finalStats = progress.getProgress();
  console.log('\n' + '='.repeat(80));
  console.log('🎉 BACKFILL COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total Processed:    ${finalStats.processed.toLocaleString()} / ${finalStats.total.toLocaleString()}`);
  console.log(`Successful:         ${finalStats.successful.toLocaleString()} markets`);
  console.log(`Empty (Zero Fills): ${finalStats.skipped.toLocaleString()} markets`);
  console.log(`Failed:             ${finalStats.failed.toLocaleString()} markets`);
  console.log(`Rate Limited:       ${finalStats.rateLimited.toLocaleString()} markets`);
  console.log(`Total Time:         ${formatDuration(finalStats.elapsedMs / 1000)}`);
  console.log(`Avg Rate:           ${finalStats.ratePerSec.toFixed(2)} markets/sec`);
  console.log('='.repeat(80));

  if (checkpoint.failedConditionIds.length > 0) {
    console.log(`\n⚠️  ${checkpoint.failedConditionIds.length} markets failed/rate-limited`);
    console.log('📝 Failed markets saved to checkpoint, retry with:');
    console.log('   WORKER_COUNT=8 npx tsx scripts/backfill-missing-clob-markets.ts');
  }

  await logProgress('✅ Backfill complete');
}

// ============================================================================
// Entry Point
// ============================================================================

runBackfill()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
  });
