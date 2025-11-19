#!/usr/bin/env tsx
/**
 * Phase 7.3: Crash-Protected Batch Ingestion for Global Ghost Wallets (Enhanced)
 *
 * Purpose: Process all 12,717 wallets from ghost_market_wallets_all in batches
 *          with crash protection, resumability, progress tracking, and performance tuning.
 *
 * Strategy:
 * 1. Create checkpoint table to track progress
 * 2. Process wallets in configurable batches (default: 500)
 * 3. For each batch:
 *    - Query Data-API concurrently for wallets (configurable concurrency)
 *    - Insert into external_trades_raw
 *    - Update checkpoint
 *    - Log batch metrics
 *    - Update status markdown
 * 4. Handle errors gracefully with retry logic
 * 5. Detect and handle stalls/timeouts
 *
 * Performance Tuning:
 * - --max-concurrency <number>   : Concurrent wallet requests (default: 4, fast: 16)
 * - --batch-size <number>         : Wallets per batch (default: 500, fast: 1000)
 * - --wallet-delay-ms <number>    : Delay between wallet requests (default: 50, fast: 0)
 * - --batch-delay-ms <number>     : Delay between batches (default: 2000, fast: 1000)
 * - --mode <safe|fast>            : Preset modes
 *
 * Examples:
 * - Safe mode (default):  npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts
 * - Fast mode:            npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --mode fast
 * - Custom:               npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 12 --batch-size 800
 *
 * C2 - External Data Ingestion Agent
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

// Import backoff constants from the Data API connector
const BASE_RATE_LIMIT_BACKOFF_MS = 30000;  // 30 seconds
const MAX_RATE_LIMIT_BACKOFF_MS = 300000;  // 5 minutes
const MAX_RATE_LIMIT_RETRIES = 5;

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Default performance settings (SAFE MODE)
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_WALLET_DELAY_MS = 50;
const DEFAULT_BATCH_DELAY_MS = 2000;
const DEFAULT_WALLET_TIMEOUT_MS = 30000;

// Fast mode presets
const FAST_BATCH_SIZE = 1000;
const FAST_MAX_CONCURRENCY = 16;
const FAST_WALLET_DELAY_MS = 0;
const FAST_BATCH_DELAY_MS = 1000;

// Polymarket Data-API endpoints
const DATA_API_BASE = 'https://data-api.polymarket.com';
const ACTIVITY_ENDPOINT = `${DATA_API_BASE}/activity`;

interface PerformanceConfig {
  batchSize: number;
  maxConcurrency: number;
  walletDelayMs: number;
  batchDelayMs: number;
  walletTimeoutMs: number;
  mode: 'safe' | 'fast' | 'custom';
}

interface DataAPIActivity {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: string;
  size?: number;
  usdcSize?: number;
  transactionHash?: string;
  price?: number;
  asset?: string;
  side?: string;
  outcomeIndex?: number;
  title?: string;
  outcome?: string;
}

interface BatchProgress {
  batch_number: number;
  wallets_processed: number;
  markets_covered: number;
  trades_inserted: number;
  shares_ingested: number;
  value_ingested: number;
  started_at: Date;
  completed_at?: Date;
  status: 'running' | 'completed' | 'failed';
  error_message?: string;
}

/**
 * Parse CLI arguments for performance tuning
 */
function parsePerformanceConfig(): PerformanceConfig {
  const args = process.argv.slice(2);

  let config: PerformanceConfig = {
    batchSize: DEFAULT_BATCH_SIZE,
    maxConcurrency: DEFAULT_MAX_CONCURRENCY,
    walletDelayMs: DEFAULT_WALLET_DELAY_MS,
    batchDelayMs: DEFAULT_BATCH_DELAY_MS,
    walletTimeoutMs: DEFAULT_WALLET_TIMEOUT_MS,
    mode: 'safe'
  };

  // Check for mode preset
  const modeIndex = args.indexOf('--mode');
  if (modeIndex !== -1 && args[modeIndex + 1]) {
    const mode = args[modeIndex + 1].toLowerCase();
    if (mode === 'fast') {
      config = {
        batchSize: FAST_BATCH_SIZE,
        maxConcurrency: FAST_MAX_CONCURRENCY,
        walletDelayMs: FAST_WALLET_DELAY_MS,
        batchDelayMs: FAST_BATCH_DELAY_MS,
        walletTimeoutMs: DEFAULT_WALLET_TIMEOUT_MS,
        mode: 'fast'
      };
    }
  }

  // Override with explicit flags (takes precedence over mode)
  const batchSizeIndex = args.indexOf('--batch-size');
  if (batchSizeIndex !== -1 && args[batchSizeIndex + 1]) {
    config.batchSize = parseInt(args[batchSizeIndex + 1]);
    config.mode = 'custom';
  }

  const maxConcurrencyIndex = args.indexOf('--max-concurrency');
  if (maxConcurrencyIndex !== -1 && args[maxConcurrencyIndex + 1]) {
    config.maxConcurrency = parseInt(args[maxConcurrencyIndex + 1]);
    config.mode = 'custom';
  }

  const walletDelayIndex = args.indexOf('--wallet-delay-ms');
  if (walletDelayIndex !== -1 && args[walletDelayIndex + 1]) {
    config.walletDelayMs = parseInt(args[walletDelayIndex + 1]);
    config.mode = 'custom';
  }

  const batchDelayIndex = args.indexOf('--batch-delay-ms');
  if (batchDelayIndex !== -1 && args[batchDelayIndex + 1]) {
    config.batchDelayMs = parseInt(args[batchDelayIndex + 1]);
    config.mode = 'custom';
  }

  return config;
}

/**
 * Create checkpoint table for resumability
 */
async function createCheckpointTable() {
  console.log('Creating batch ingestion checkpoint table...');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS global_ghost_ingestion_checkpoints (
        batch_number UInt32,
        wallets_processed UInt32,
        markets_covered UInt32,
        trades_inserted UInt32,
        shares_ingested Float64,
        value_ingested Float64,
        started_at DateTime,
        completed_at DateTime,
        status String,
        error_message String DEFAULT ''
      ) ENGINE = MergeTree()
      ORDER BY batch_number
      PRIMARY KEY batch_number
    `
  });

  console.log('✅ Checkpoint table ready');
  console.log('');
}

/**
 * Get last completed batch number
 */
async function getLastCompletedBatch(): Promise<number> {
  const result = await clickhouse.query({
    query: `
      SELECT MAX(batch_number) as last_batch
      FROM global_ghost_ingestion_checkpoints
      WHERE status = 'completed'
    `,
    format: 'JSONEachRow'
  });

  const rows: any[] = await result.json();
  return rows[0]?.last_batch || 0;
}

/**
 * Insert batch checkpoint
 */
async function insertCheckpoint(progress: BatchProgress) {
  await clickhouse.insert({
    table: 'global_ghost_ingestion_checkpoints',
    values: [{
      batch_number: progress.batch_number,
      wallets_processed: progress.wallets_processed,
      markets_covered: progress.markets_covered,
      trades_inserted: progress.trades_inserted,
      shares_ingested: progress.shares_ingested,
      value_ingested: progress.value_ingested,
      started_at: progress.started_at,
      completed_at: progress.completed_at || new Date(),
      status: progress.status,
      error_message: progress.error_message || ''
    }],
    format: 'JSONEachRow'
  });
}

/**
 * Generate stable external_trade_id
 */
function generateExternalTradeId(activity: DataAPIActivity): string {
  const txHash = activity.transactionHash || 'no_tx';
  const conditionId = (activity.conditionId || '').substring(0, 16);
  const user = (activity.proxyWallet || '').substring(0, 16);
  const timestamp = activity.timestamp;
  const side = activity.side || 'unknown';
  const size = (activity.size || 0).toFixed(6);

  return `data_api_${txHash}_${conditionId}_${user}_${timestamp}_${side}_${size}`;
}

/**
 * Fetch activities for a single wallet with exponential backoff on 429 errors
 */
async function fetchActivitiesForWallet(
  wallet: string,
  conditionIds: string[],
  timeoutMs: number,
  walletDelayMs: number = 0
): Promise<DataAPIActivity[]> {
  const params = new URLSearchParams({
    user: wallet,
    type: 'TRADE',
    limit: '1000'
  });

  if (conditionIds.length > 0) {
    params.append('market', conditionIds.join(','));
  }

  const url = `${ACTIVITY_ENDPOINT}?${params}`;

  // Respect wallet delay before making request
  if (walletDelayMs > 0) {
    await sleep(walletDelayMs);
  }

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < MAX_RATE_LIMIT_RETRIES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });

      // Success case
      if (response.ok) {
        const data = await response.json();
        return Array.isArray(data) ? data : (data.data || []);
      }

      // Rate limit case - exponential backoff
      if (response.status === 429) {
        attempt++;

        if (attempt >= MAX_RATE_LIMIT_RETRIES) {
          console.log(`    ✗ GAVE UP on wallet ${wallet.substring(0, 16)}... after ${attempt} 429 retries`);
          throw new Error(`HTTP 429: Too Many Requests (exhausted ${MAX_RATE_LIMIT_RETRIES} retries)`);
        }

        // Calculate exponential backoff with jitter
        const baseBackoff = BASE_RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt - 1);
        const cappedBackoff = Math.min(baseBackoff, MAX_RATE_LIMIT_BACKOFF_MS);
        const jitter = Math.random() * 1000;  // 0-1000ms random jitter
        const backoffMs = cappedBackoff + jitter;

        console.log(`    ⏳ Rate limited for wallet ${wallet.substring(0, 16)}..., backing off for ${Math.round(backoffMs / 1000)}s (attempt ${attempt}/${MAX_RATE_LIMIT_RETRIES})`);

        clearTimeout(timeout);
        await sleep(backoffMs);
        continue;
      }

      // Other HTTP errors - retry with smaller backoff
      if (attempt < 2) {
        attempt++;
        const backoffMs = 5000 + Math.random() * 2000;  // 5-7 seconds
        console.log(`    ⏳ HTTP ${response.status} for wallet ${wallet.substring(0, 16)}..., retrying in ${Math.round(backoffMs / 1000)}s`);
        clearTimeout(timeout);
        await sleep(backoffMs);
        continue;
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    } catch (error: any) {
      clearTimeout(timeout);
      lastError = error;

      // Timeout handling
      if (error.name === 'AbortError') {
        console.log(`    ⏱️  Timeout after ${timeoutMs}ms - skipping wallet ${wallet.substring(0, 16)}...`);
        return [];
      }

      // Network errors - retry with small backoff
      if (attempt < 2 && (error.message.includes('fetch') || error.message.includes('network'))) {
        attempt++;
        const backoffMs = 5000;
        console.log(`    ⏳ Network error for wallet ${wallet.substring(0, 16)}..., retrying in ${backoffMs / 1000}s`);
        await sleep(backoffMs);
        continue;
      }

      console.error(`    ✗ Failed to fetch wallet ${wallet.substring(0, 16)}...: ${error.message}`);
      throw error;
    }
  }

  // Should not reach here, but handle it anyway
  throw lastError || new Error('Max retries exceeded');
}

/**
 * Process wallets concurrently with controlled concurrency
 */
async function processConcurrently<T, R>(
  items: T[],
  maxConcurrency: number,
  delayMs: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = processor(item).then(result => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= maxConcurrency) {
      await Promise.race(executing);
      executing.splice(executing.findIndex(p => p === promise), 1);

      // Add delay after each batch of concurrent requests
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Transform activities to external trades schema
 */
function transformToExternalTrades(activities: DataAPIActivity[]) {
  return activities
    .filter(a => a.type === 'TRADE' && a.size && a.price)
    .map(activity => ({
      source: 'polymarket_data_api',
      ingested_at: new Date(),
      external_trade_id: generateExternalTradeId(activity),
      wallet_address: (activity.proxyWallet || '').toLowerCase().replace(/^0x/, ''),
      condition_id: (activity.conditionId || '').toLowerCase().replace(/^0x/, ''),
      market_question: activity.title || '',
      side: activity.side || 'UNKNOWN',
      outcome_index: activity.outcomeIndex ?? -1,
      shares: activity.size || 0,
      price: activity.price || 0,
      cash_value: activity.usdcSize || (activity.size || 0) * (activity.price || 0),
      fees: 0.0,
      trade_timestamp: new Date(activity.timestamp * 1000),
      tx_hash: activity.transactionHash || ''
    }));
}

/**
 * Process a single batch of wallets with concurrent fetching
 */
async function processBatch(
  batchNumber: number,
  wallets: string[],
  allConditionIds: string[],
  perfConfig: PerformanceConfig
): Promise<BatchProgress> {
  const progress: BatchProgress = {
    batch_number: batchNumber,
    wallets_processed: 0,
    markets_covered: 0,
    trades_inserted: 0,
    shares_ingested: 0,
    value_ingested: 0,
    started_at: new Date(),
    status: 'running'
  };

  console.log(`Processing ${wallets.length} wallets (concurrency: ${perfConfig.maxConcurrency})...`);

  let successfulWallets = 0;
  let failedWallets = 0;
  const allActivities: DataAPIActivity[] = [];

  // Process wallets concurrently
  const results = await processConcurrently(
    wallets,
    perfConfig.maxConcurrency,
    perfConfig.walletDelayMs,
    async (wallet: string) => {
      try {
        const activities = await fetchActivitiesForWallet(
          wallet,
          allConditionIds,
          perfConfig.walletTimeoutMs,
          perfConfig.walletDelayMs
        );

        if (activities.length > 0) {
          console.log(`  ✓ ${wallet.substring(0, 16)}... → ${activities.length} activities`);
        }

        return { success: true, wallet, activities };
      } catch (error: any) {
        console.log(`  ✗ ${wallet.substring(0, 16)}... → ${error.message}`);
        return { success: false, wallet, activities: [], error: error.message };
      }
    }
  );

  // Collect results
  for (const result of results) {
    if (result.success) {
      successfulWallets++;
      progress.wallets_processed++;
      allActivities.push(...result.activities);
    } else {
      failedWallets++;
    }
  }

  console.log('');
  console.log(`Batch fetch complete: ${successfulWallets} succeeded, ${failedWallets} failed`);
  console.log(`Total activities fetched: ${allActivities.length}`);
  console.log('');

  // Filter to trades only
  const tradeActivities = allActivities.filter(a => a.type === 'TRADE');
  console.log(`Trades (type=TRADE): ${tradeActivities.length}`);
  console.log('');

  if (tradeActivities.length === 0) {
    progress.status = 'completed';
    progress.completed_at = new Date();
    return progress;
  }

  // Transform to external_trades_raw schema
  const externalTrades = transformToExternalTrades(tradeActivities);
  console.log(`Transformed ${externalTrades.length} trade rows`);
  console.log('');

  // Deduplication check
  const existingIdsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT external_trade_id
      FROM external_trades_raw
      WHERE source = 'polymarket_data_api'
    `,
    format: 'JSONEachRow'
  });

  const existingIds = new Set(
    (await existingIdsResult.json()).map((row: any) => row.external_trade_id)
  );

  const newTrades = externalTrades.filter(
    trade => !existingIds.has(trade.external_trade_id)
  );

  console.log(`${newTrades.length} new trades to insert (${externalTrades.length - newTrades.length} duplicates skipped)`);
  console.log('');

  if (newTrades.length > 0) {
    // Insert into ClickHouse
    await clickhouse.insert({
      table: 'external_trades_raw',
      values: newTrades,
      format: 'JSONEachRow'
    });

    console.log('✅ Inserted successfully');
    console.log('');

    // Calculate metrics
    progress.trades_inserted = newTrades.length;
    progress.shares_ingested = newTrades.reduce((sum, t) => sum + t.shares, 0);
    progress.value_ingested = newTrades.reduce((sum, t) => sum + t.cash_value, 0);
    progress.markets_covered = new Set(newTrades.map(t => t.condition_id)).size;
  }

  progress.status = 'completed';
  progress.completed_at = new Date();
  return progress;
}

/**
 * Update status markdown with performance settings
 */
function updateStatusMarkdown(
  batchProgress: BatchProgress[],
  totalWallets: number,
  totalMarkets: number,
  startTime: Date,
  perfConfig: PerformanceConfig
) {
  const completedBatches = batchProgress.filter(p => p.status === 'completed');
  const totalWalletsProcessed = completedBatches.reduce((sum, p) => sum + p.wallets_processed, 0);
  const totalTradesInserted = completedBatches.reduce((sum, p) => sum + p.trades_inserted, 0);
  const totalSharesIngested = completedBatches.reduce((sum, p) => sum + p.shares_ingested, 0);
  const totalValueIngested = completedBatches.reduce((sum, p) => sum + p.value_ingested, 0);

  const percentComplete = ((totalWalletsProcessed / totalWallets) * 100).toFixed(1);
  const elapsed = (Date.now() - startTime.getTime()) / 1000 / 60; // minutes
  const estimatedTotal = totalWallets > 0 ? (elapsed / totalWalletsProcessed) * totalWallets : 0;
  const estimatedRemaining = estimatedTotal - elapsed;

  const report = `# Global Ghost Market External Ingestion - Status

**Date:** ${new Date().toISOString()}
**Agent:** C2 - External Data Ingestion
**Status:** ${totalWalletsProcessed >= totalWallets ? '✅ **COMPLETE**' : '⏳ **IN PROGRESS**'}

---

## Progress Summary

**Wallets Processed:** ${totalWalletsProcessed.toLocaleString()} / ${totalWallets.toLocaleString()} (${percentComplete}%)
**Batches Completed:** ${completedBatches.length} / ${batchProgress.length}
**Markets Covered:** ${totalMarkets}

**Trades Inserted:** ${totalTradesInserted.toLocaleString()}
**Shares Ingested:** ${totalSharesIngested.toLocaleString('en-US', { maximumFractionDigits: 2 })}
**Total Value:** $${totalValueIngested.toLocaleString('en-US', { maximumFractionDigits: 2 })}

**Elapsed Time:** ${elapsed.toFixed(1)} minutes
**Estimated Total:** ${estimatedTotal.toFixed(1)} minutes
**Estimated Remaining:** ${estimatedRemaining > 0 ? estimatedRemaining.toFixed(1) : '0'} minutes

---

## Performance Configuration

**Mode:** \`${perfConfig.mode.toUpperCase()}\`
**Batch Size:** ${perfConfig.batchSize} wallets per batch
**Max Concurrency:** ${perfConfig.maxConcurrency} concurrent requests
**Wallet Delay:** ${perfConfig.walletDelayMs}ms
**Batch Delay:** ${perfConfig.batchDelayMs}ms
**Wallet Timeout:** ${perfConfig.walletTimeoutMs}ms

---

## Batch Details

${batchProgress.map(p => `
### Batch ${p.batch_number} - ${p.status.toUpperCase()}

- **Wallets processed:** ${p.wallets_processed}
- **Markets covered:** ${p.markets_covered}
- **Trades inserted:** ${p.trades_inserted}
- **Shares ingested:** ${p.shares_ingested.toFixed(2)}
- **Value ingested:** $${p.value_ingested.toFixed(2)}
- **Started:** ${p.started_at.toISOString()}
- **Completed:** ${p.completed_at ? p.completed_at.toISOString() : 'In progress...'}
${p.error_message ? `- **Error:** ${p.error_message}` : ''}
`).join('\n')}

---

## Database Configuration

**Source Table:** \`ghost_market_wallets_all\`
**Destination Table:** \`external_trades_raw\`
**Checkpoint Table:** \`global_ghost_ingestion_checkpoints\`

---

## Resumability

This ingestion is **crash-protected** and **resumable**:
- Progress is checkpointed after each batch
- Can be safely stopped and restarted
- Will automatically resume from last completed batch
- Performance settings can be changed on resume

**To resume with same settings:**
\`\`\`bash
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --mode ${perfConfig.mode}
\`\`\`

**To resume with different settings:**
\`\`\`bash
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 16 --batch-size 1000
\`\`\`

---

**— C2 (External Data Ingestion Agent)**

_Last updated: ${new Date().toISOString()}_
`;

  writeFileSync('C2_GLOBAL_EXTERNAL_INGESTION_STATUS.md', report);
}

async function main() {
  // Parse performance configuration
  const perfConfig = parsePerformanceConfig();

  console.log('═'.repeat(80));
  console.log('Phase 7.3: Crash-Protected Global Ghost Wallet Ingestion (Enhanced)');
  console.log('═'.repeat(80));
  console.log('');

  console.log('Performance Configuration:');
  console.log(`  Mode:              ${perfConfig.mode.toUpperCase()}`);
  console.log(`  Batch size:        ${perfConfig.batchSize} wallets`);
  console.log(`  Max concurrency:   ${perfConfig.maxConcurrency} concurrent requests`);
  console.log(`  Wallet delay:      ${perfConfig.walletDelayMs}ms`);
  console.log(`  Batch delay:       ${perfConfig.batchDelayMs}ms`);
  console.log(`  Wallet timeout:    ${perfConfig.walletTimeoutMs}ms`);
  console.log('');
  console.log('Rate Limit Backoff Settings:');
  console.log(`  Base backoff:      ${BASE_RATE_LIMIT_BACKOFF_MS}ms (${BASE_RATE_LIMIT_BACKOFF_MS / 1000}s)`);
  console.log(`  Max backoff:       ${MAX_RATE_LIMIT_BACKOFF_MS}ms (${MAX_RATE_LIMIT_BACKOFF_MS / 1000}s)`);
  console.log(`  Max retries:       ${MAX_RATE_LIMIT_RETRIES} attempts`);
  console.log(`  Backoff strategy:  Exponential with jitter`);
  console.log('');

  const startTime = new Date();

  // Step 1: Create checkpoint table
  await createCheckpointTable();

  // Step 2: Load all wallets from global table
  console.log('Loading wallets from ghost_market_wallets_all...');

  const walletsResult = await clickhouse.query({
    query: `SELECT DISTINCT wallet FROM ghost_market_wallets_all ORDER BY wallet`,
    format: 'JSONEachRow'
  });
  const walletRows: any[] = await walletsResult.json();
  const allWallets = walletRows.map(row => row.wallet);

  console.log(`✅ Loaded ${allWallets.length} unique wallets`);
  console.log('');

  // Step 3: Load all condition_ids
  console.log('Loading markets from ghost_market_wallets_all...');

  const conditionsResult = await clickhouse.query({
    query: `SELECT DISTINCT condition_id FROM ghost_market_wallets_all ORDER BY condition_id`,
    format: 'JSONEachRow'
  });
  const conditionRows: any[] = await conditionsResult.json();
  const allConditionIds = conditionRows.map(row => row.condition_id);

  console.log(`✅ Loaded ${allConditionIds.length} unique markets`);
  console.log('');

  // Step 4: Check for previous progress
  const lastCompletedBatch = await getLastCompletedBatch();

  if (lastCompletedBatch > 0) {
    console.log(`📋 Resuming from batch ${lastCompletedBatch + 1} (${lastCompletedBatch} batches already completed)`);
    console.log('');
  }

  // Step 5: Calculate batches
  const totalBatches = Math.ceil(allWallets.length / perfConfig.batchSize);
  const startBatch = lastCompletedBatch + 1;

  console.log('Batch Configuration:');
  console.log(`  Total wallets:     ${allWallets.length}`);
  console.log(`  Batch size:        ${perfConfig.batchSize}`);
  console.log(`  Total batches:     ${totalBatches}`);
  console.log(`  Starting batch:    ${startBatch}`);
  console.log(`  Batches remaining: ${totalBatches - lastCompletedBatch}`);
  console.log('');

  // Step 6: Process batches
  const batchProgress: BatchProgress[] = [];

  for (let i = startBatch - 1; i < totalBatches; i++) {
    const batchNumber = i + 1;
    const start = i * perfConfig.batchSize;
    const end = Math.min(start + perfConfig.batchSize, allWallets.length);
    const batchWallets = allWallets.slice(start, end);

    console.log('─'.repeat(80));
    console.log(`Batch ${batchNumber}/${totalBatches} (wallets ${start + 1}-${end})`);
    console.log('─'.repeat(80));
    console.log('');

    try {
      const progress = await processBatch(batchNumber, batchWallets, allConditionIds, perfConfig);
      batchProgress.push(progress);

      // Save checkpoint
      await insertCheckpoint(progress);

      // Update status markdown
      updateStatusMarkdown(batchProgress, allWallets.length, allConditionIds.length, startTime, perfConfig);

      console.log('Batch Summary:');
      console.log(`  Wallets processed:  ${progress.wallets_processed}`);
      console.log(`  Markets covered:    ${progress.markets_covered}`);
      console.log(`  Trades inserted:    ${progress.trades_inserted}`);
      console.log(`  Shares ingested:    ${progress.shares_ingested.toFixed(2)}`);
      console.log(`  Value ingested:     $${progress.value_ingested.toFixed(2)}`);
      console.log(`  Status:             ${progress.status}`);
      console.log('');

      // Brief pause between batches
      if (i < totalBatches - 1 && perfConfig.batchDelayMs > 0) {
        console.log(`⏳ Waiting ${perfConfig.batchDelayMs}ms before next batch...`);
        console.log('');
        await new Promise(resolve => setTimeout(resolve, perfConfig.batchDelayMs));
      }

    } catch (error: any) {
      console.error(`❌ Batch ${batchNumber} failed:`, error.message);
      console.log('');

      // Record failure in checkpoint
      const failedProgress: BatchProgress = {
        batch_number: batchNumber,
        wallets_processed: 0,
        markets_covered: 0,
        trades_inserted: 0,
        shares_ingested: 0,
        value_ingested: 0,
        started_at: new Date(),
        completed_at: new Date(),
        status: 'failed',
        error_message: error.message
      };

      await insertCheckpoint(failedProgress);
      batchProgress.push(failedProgress);

      console.log('⚠️  Batch failed but progress saved. You can resume from next batch.');
      console.log('');

      // Continue with next batch instead of stopping
      continue;
    }
  }

  // Final summary
  console.log('═'.repeat(80));
  console.log('INGESTION COMPLETE');
  console.log('═'.repeat(80));
  console.log('');

  const totalWalletsProcessed = batchProgress.reduce((sum, p) => sum + p.wallets_processed, 0);
  const totalTradesInserted = batchProgress.reduce((sum, p) => sum + p.trades_inserted, 0);
  const totalSharesIngested = batchProgress.reduce((sum, p) => sum + p.shares_ingested, 0);
  const totalValueIngested = batchProgress.reduce((sum, p) => sum + p.value_ingested, 0);

  console.log('Final Statistics:');
  console.log(`  Mode:                ${perfConfig.mode.toUpperCase()}`);
  console.log(`  Batches completed:   ${batchProgress.filter(p => p.status === 'completed').length}/${totalBatches}`);
  console.log(`  Wallets processed:   ${totalWalletsProcessed}/${allWallets.length}`);
  console.log(`  Trades inserted:     ${totalTradesInserted.toLocaleString()}`);
  console.log(`  Shares ingested:     ${totalSharesIngested.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  console.log(`  Value ingested:      $${totalValueIngested.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  console.log(`  Total elapsed:       ${((Date.now() - startTime.getTime()) / 1000 / 60).toFixed(1)} minutes`);
  console.log('');

  console.log('✅ Status report: C2_GLOBAL_EXTERNAL_INGESTION_STATUS.md');
  console.log('');

  console.log('─'.repeat(80));
  console.log('C2 - External Data Ingestion Agent');
  console.log('─'.repeat(80));
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
