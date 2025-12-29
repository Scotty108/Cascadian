/**
 * Backfill PnL from Polymarket Data API
 *
 * This script fetches position data from Polymarket's Data API and stores it
 * in ClickHouse for accurate PnL calculations that match the UI.
 *
 * Features:
 * - Parallel workers (8 by default)
 * - Rate limiting with exponential backoff
 * - Checkpoint/crash recovery
 * - Stall protection
 * - Progress reporting
 *
 * Usage:
 *   npx tsx scripts/pnl/backfill-api-positions.ts
 *   npx tsx scripts/pnl/backfill-api-positions.ts --resume
 *   npx tsx scripts/pnl/backfill-api-positions.ts --workers=4
 *   npx tsx scripts/pnl/backfill-api-positions.ts --test
 *
 * Author: Claude 1
 * Date: 2025-11-26
 */

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const CONFIG = {
  workers: parseInt(process.env.WORKERS || '8'),
  batchSize: 100,
  requestsPerSecond: 3,  // Conservative to avoid rate limits
  maxRetries: 3,
  retryBaseDelay: 2000,  // 2 seconds
  checkpointInterval: 100,  // Save every N wallets
  staleTimeout: 60000,  // 60 seconds without progress = stall
  testMode: process.argv.includes('--test'),
  resume: process.argv.includes('--resume'),
};

// Parse --workers=N argument
const workersArg = process.argv.find(a => a.startsWith('--workers='));
if (workersArg) {
  CONFIG.workers = parseInt(workersArg.split('=')[1]);
}

// Paths
const CHECKPOINT_FILE = path.join(__dirname, '.backfill-checkpoint.json');
const PROGRESS_FILE = path.join(__dirname, '.backfill-progress.json');

// Types
interface ApiPosition {
  conditionId: string;
  outcome: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  realizedPnl?: number;
  marketSlug?: string;
  question?: string;
}

interface CheckpointState {
  lastProcessedIndex: number;
  processedCount: number;
  errorCount: number;
  lastCheckpoint: string;
  failedWallets: string[];
  startTime: string;
}

interface WorkerStats {
  processed: number;
  errors: number;
  rateLimitHits: number;
  lastActivity: number;
}

// ClickHouse client
const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 60000,
});

// Rate limiter
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(requestsPerSecond: number) {
    this.maxTokens = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.refillRate = requestsPerSecond;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    while (this.tokens < 1) {
      await this.sleep(100);
      this.refill();
    }
    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const rateLimiter = new RateLimiter(CONFIG.requestsPerSecond);

// API functions
async function fetchWithRetry(url: string, retries = CONFIG.maxRetries): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await rateLimiter.acquire();

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Cascadian-Backfill/1.0',
        },
      });

      if (response.status === 429) {
        // Rate limited
        const delay = CONFIG.retryBaseDelay * Math.pow(2, attempt);
        console.log(`Rate limited, waiting ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === retries) throw error;
      const delay = CONFIG.retryBaseDelay * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function fetchPositions(wallet: string): Promise<ApiPosition[]> {
  const url = `https://data-api.polymarket.com/positions?user=${wallet}`;
  try {
    const data = await fetchWithRetry(url);
    if (!Array.isArray(data)) return [];

    return data.map((p: any) => ({
      conditionId: p.conditionId || '',
      outcome: p.outcome || '',
      size: parseFloat(p.size) || 0,
      avgPrice: parseFloat(p.avgPrice) || 0,
      initialValue: parseFloat(p.initialValue) || 0,
      currentValue: parseFloat(p.currentValue) || 0,
      cashPnl: parseFloat(p.cashPnl) || 0,
      marketSlug: p.marketSlug || '',
      question: p.question || '',
    }));
  } catch (error) {
    console.error(`Error fetching positions for ${wallet}:`, error);
    return [];
  }
}

async function fetchClosedPositions(wallet: string): Promise<ApiPosition[]> {
  const url = `https://data-api.polymarket.com/closed-positions?user=${wallet}`;
  try {
    const data = await fetchWithRetry(url);
    if (!Array.isArray(data)) return [];

    return data.map((p: any) => ({
      conditionId: p.conditionId || '',
      outcome: p.outcome || '',
      size: parseFloat(p.size) || 0,
      avgPrice: parseFloat(p.avgPrice) || 0,
      initialValue: parseFloat(p.initialValue) || 0,
      currentValue: 0,
      cashPnl: 0,
      realizedPnl: parseFloat(p.realizedPnl) || 0,
      marketSlug: p.marketSlug || '',
      question: p.question || '',
    }));
  } catch (error) {
    console.error(`Error fetching closed positions for ${wallet}:`, error);
    return [];
  }
}

// Database functions
async function ensureTableExists(): Promise<void> {
  const createTable = `
    CREATE TABLE IF NOT EXISTS pm_api_positions (
      wallet String,
      condition_id String,
      outcome String,
      size Float64,
      avg_price Float64,
      initial_value Float64,
      current_value Float64,
      cash_pnl Float64,
      realized_pnl Float64,
      is_closed UInt8,
      market_slug String,
      question String,
      fetched_at DateTime,
      insert_time DateTime DEFAULT now(),
      is_deleted UInt8 DEFAULT 0
    )
    ENGINE = ReplacingMergeTree(insert_time)
    ORDER BY (wallet, condition_id, outcome)
  `;

  await client.command({ query: createTable });
  console.log('Table pm_api_positions exists/created');
}

async function insertPositions(wallet: string, openPositions: ApiPosition[], closedPositions: ApiPosition[]): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const rows: any[] = [];

  // Open positions
  for (const p of openPositions) {
    rows.push({
      wallet,
      condition_id: p.conditionId,
      outcome: p.outcome,
      size: p.size,
      avg_price: p.avgPrice,
      initial_value: p.initialValue,
      current_value: p.currentValue,
      cash_pnl: p.cashPnl,
      realized_pnl: 0,
      is_closed: 0,
      market_slug: p.marketSlug || '',
      question: p.question || '',
      fetched_at: now,
    });
  }

  // Closed positions
  for (const p of closedPositions) {
    rows.push({
      wallet,
      condition_id: p.conditionId,
      outcome: p.outcome,
      size: p.size,
      avg_price: p.avgPrice,
      initial_value: p.initialValue,
      current_value: 0,
      cash_pnl: 0,
      realized_pnl: p.realizedPnl || 0,
      is_closed: 1,
      market_slug: p.marketSlug || '',
      question: p.question || '',
      fetched_at: now,
    });
  }

  if (rows.length > 0) {
    await client.insert({
      table: 'pm_api_positions',
      values: rows,
      format: 'JSONEachRow',
    });
  }
}

async function getWalletList(): Promise<string[]> {
  console.log('Fetching wallet list from database...');

  if (CONFIG.testMode) {
    // Test with known wallets
    return [
      '0x9d36c904930a7d06c5403f9e16996e919f586486',  // W1
      '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838',  // W2
      '0x418db17eaa8f25eaf2085657d0becd82462c6786',  // W3
      '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb',  // W4
      '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2',  // W5
      '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d',  // W6
    ];
  }

  const result = await client.query({
    query: `
      SELECT DISTINCT trader_wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      ORDER BY trader_wallet
    `,
    format: 'JSONEachRow',
  });

  const wallets = (await result.json() as { trader_wallet: string }[]).map(r => r.trader_wallet);
  console.log(`Found ${wallets.length.toLocaleString()} unique wallets`);
  return wallets;
}

// Checkpoint functions
function loadCheckpoint(): CheckpointState | null {
  if (!CONFIG.resume) return null;
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading checkpoint:', error);
  }
  return null;
}

function saveCheckpoint(state: CheckpointState): void {
  try {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Error saving checkpoint:', error);
  }
}

function saveProgress(stats: { processed: number; errors: number; elapsed: number; rate: number }): void {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
      ...stats,
      timestamp: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    // Ignore
  }
}

// Worker function
async function processWallet(wallet: string, workerStats: WorkerStats): Promise<boolean> {
  try {
    const [openPositions, closedPositions] = await Promise.all([
      fetchPositions(wallet),
      fetchClosedPositions(wallet),
    ]);

    await insertPositions(wallet, openPositions, closedPositions);

    workerStats.processed++;
    workerStats.lastActivity = Date.now();
    return true;
  } catch (error) {
    workerStats.errors++;
    workerStats.lastActivity = Date.now();
    console.error(`Error processing ${wallet}:`, error);
    return false;
  }
}

// Main backfill function
async function runBackfill(): Promise<void> {
  console.log('=== POLYMARKET API POSITIONS BACKFILL ===');
  console.log(`Workers: ${CONFIG.workers}`);
  console.log(`Test mode: ${CONFIG.testMode}`);
  console.log(`Resume: ${CONFIG.resume}`);
  console.log('');

  // Ensure table exists
  await ensureTableExists();

  // Get wallet list
  const wallets = await getWalletList();
  if (wallets.length === 0) {
    console.log('No wallets to process');
    return;
  }

  // Load checkpoint
  let checkpoint = loadCheckpoint();
  let startIndex = checkpoint?.lastProcessedIndex || 0;

  console.log(`Total wallets: ${wallets.length.toLocaleString()}`);
  console.log(`Starting from index: ${startIndex}`);
  console.log('');

  // Stats
  const startTime = Date.now();
  let processedCount = checkpoint?.processedCount || 0;
  let errorCount = checkpoint?.errorCount || 0;
  const failedWallets: string[] = checkpoint?.failedWallets || [];

  // Worker stats
  const workerStats: WorkerStats[] = [];
  for (let i = 0; i < CONFIG.workers; i++) {
    workerStats.push({ processed: 0, errors: 0, rateLimitHits: 0, lastActivity: Date.now() });
  }

  // Process wallets
  let currentIndex = startIndex;

  // Stall detection
  let lastProgressCheck = Date.now();
  let lastProcessedCount = processedCount;

  const stallChecker = setInterval(() => {
    const now = Date.now();
    if (processedCount === lastProcessedCount && now - lastProgressCheck > CONFIG.staleTimeout) {
      console.error('STALL DETECTED - No progress for 60 seconds');
      console.error('Consider restarting with --resume');
      // Don't exit, just warn
    }
    lastProgressCheck = now;
    lastProcessedCount = processedCount;
  }, 10000);

  // Process in batches
  while (currentIndex < wallets.length) {
    const batchEnd = Math.min(currentIndex + CONFIG.batchSize, wallets.length);
    const batch = wallets.slice(currentIndex, batchEnd);

    // Process batch with workers
    const promises: Promise<void>[] = [];
    for (let i = 0; i < batch.length; i++) {
      const wallet = batch[i];
      const workerIdx = i % CONFIG.workers;

      const promise = (async () => {
        const success = await processWallet(wallet, workerStats[workerIdx]);
        if (success) {
          processedCount++;
        } else {
          errorCount++;
          failedWallets.push(wallet);
        }
      })();

      promises.push(promise);

      // Stagger requests slightly
      if (promises.length % CONFIG.workers === 0) {
        await Promise.all(promises);
        promises.length = 0;
      }
    }

    // Wait for remaining
    if (promises.length > 0) {
      await Promise.all(promises);
    }

    currentIndex = batchEnd;

    // Checkpoint
    if (processedCount % CONFIG.checkpointInterval === 0) {
      saveCheckpoint({
        lastProcessedIndex: currentIndex,
        processedCount,
        errorCount,
        lastCheckpoint: new Date().toISOString(),
        failedWallets,
        startTime: checkpoint?.startTime || new Date().toISOString(),
      });

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processedCount / elapsed;
      const remaining = wallets.length - currentIndex;
      const eta = remaining / rate;

      console.log(
        `Progress: ${processedCount.toLocaleString()}/${wallets.length.toLocaleString()} ` +
        `(${((processedCount / wallets.length) * 100).toFixed(1)}%) | ` +
        `Rate: ${rate.toFixed(1)}/sec | ` +
        `ETA: ${(eta / 60).toFixed(0)} min | ` +
        `Errors: ${errorCount}`
      );

      saveProgress({ processed: processedCount, errors: errorCount, elapsed, rate });
    }
  }

  clearInterval(stallChecker);

  // Summary
  const totalTime = (Date.now() - startTime) / 1000;
  console.log('');
  console.log('=== BACKFILL COMPLETE ===');
  console.log(`Processed: ${processedCount.toLocaleString()}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Time: ${(totalTime / 60).toFixed(1)} minutes`);
  console.log(`Rate: ${(processedCount / totalTime).toFixed(1)} wallets/sec`);

  // Cleanup checkpoint on success
  if (errorCount === 0) {
    try {
      fs.unlinkSync(CHECKPOINT_FILE);
    } catch {}
  }

  await client.close();
}

// Run
runBackfill().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
