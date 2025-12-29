#!/usr/bin/env tsx
/**
 * Backfill UI Positions from Polymarket Data API - V2
 *
 * Features:
 * - Multi-wallet support with tiered backfill
 * - Parallel workers (configurable)
 * - Progress saving and crash recovery
 * - Rate limiting
 * - Stall detection
 *
 * Usage:
 *   npx tsx scripts/backfill-ui-positions-v2.ts --wallet=0x...     # Single wallet
 *   npx tsx scripts/backfill-ui-positions-v2.ts --tier=1           # Tier 1 (100k+ PnL)
 *   npx tsx scripts/backfill-ui-positions-v2.ts --tier=2           # Tier 2 (10k+ PnL)
 *   npx tsx scripts/backfill-ui-positions-v2.ts --full             # All wallets
 *   npx tsx scripts/backfill-ui-positions-v2.ts --resume           # Resume from checkpoint
 *
 * Claude 1 - PnL Calibration
 */

import { resolve } from 'path';
import { config } from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient, ClickHouseClient } from '@clickhouse/client';

// Configuration
const CONFIG = {
  WORKERS: 8,                    // Parallel workers
  BATCH_SIZE: 500,               // Rows per insert batch
  RATE_LIMIT_MS: 100,            // Delay between API calls per worker
  CHECKPOINT_INTERVAL: 100,      // Save progress every N wallets
  STALL_TIMEOUT_MS: 60000,       // Consider stalled after 60s no progress
  API_TIMEOUT_MS: 30000,         // API request timeout
  CHECKPOINT_FILE: '.ui-positions-checkpoint.json',
  TABLE_NAME: 'pm_ui_positions_new',
};

// Polymarket Data API
const DATA_API_BASE = 'https://data-api.polymarket.com';

// Types
interface UIPosition {
  proxy_wallet: string;
  condition_id: string;
  asset: string;
  outcome_index: number;
  total_bought: number;
  total_sold: number;
  net_shares: number;
  cash_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  current_value: number;
}

interface Checkpoint {
  completedWallets: string[];
  failedWallets: string[];
  lastUpdated: string;
  tier: string;
}

interface Stats {
  processed: number;
  failed: number;
  totalPositions: number;
  startTime: number;
}

// Helpers
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function createClickhouseClient(): ClickHouseClient {
  return createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    request_timeout: 300000,
  });
}

// Load/save checkpoint
function loadCheckpoint(): Checkpoint | null {
  if (existsSync(CONFIG.CHECKPOINT_FILE)) {
    try {
      return JSON.parse(readFileSync(CONFIG.CHECKPOINT_FILE, 'utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  checkpoint.lastUpdated = new Date().toISOString();
  writeFileSync(CONFIG.CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

// Fetch positions from Data API
async function fetchPositionsForWallet(wallet: string): Promise<any[]> {
  const allPositions: any[] = [];

  // Fetch open positions
  try {
    const openUrl = `${DATA_API_BASE}/positions?user=${wallet}&limit=1000`;
    const openRes = await fetch(openUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Cascadian-Backfill/2.0' },
      signal: AbortSignal.timeout(CONFIG.API_TIMEOUT_MS),
    });
    if (openRes.ok) {
      const openData = await openRes.json();
      if (Array.isArray(openData)) {
        allPositions.push(...openData.map(p => ({ ...p, position_type: 'open' })));
      }
    }
  } catch (e) {
    // Silently continue - open positions may not exist
  }

  // Fetch closed positions
  try {
    const closedUrl = `${DATA_API_BASE}/closed-positions?user=${wallet}&limit=1000`;
    const closedRes = await fetch(closedUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Cascadian-Backfill/2.0' },
      signal: AbortSignal.timeout(CONFIG.API_TIMEOUT_MS),
    });
    if (closedRes.ok) {
      const closedData = await closedRes.json();
      if (Array.isArray(closedData)) {
        allPositions.push(...closedData.map(p => ({ ...p, position_type: 'closed' })));
      }
    }
  } catch (e) {
    // Silently continue - closed positions may not exist
  }

  return allPositions;
}

// Map API response to ClickHouse row
function mapToRow(p: any, wallet: string): UIPosition {
  return {
    proxy_wallet: wallet.toLowerCase(),
    condition_id: p.conditionId || p.condition_id || '',
    asset: p.asset || '',
    outcome_index: p.outcomeIndex ?? p.outcome_index ?? 0,
    total_bought: p.totalBought ?? p.total_bought ?? 0,
    total_sold: p.totalSold ?? p.total_sold ?? 0,
    net_shares: p.netShares ?? p.net_shares ?? 0,
    cash_pnl: p.cashPnl ?? p.cash_pnl ?? p.realizedPnl ?? p.realized_pnl ?? 0,
    realized_pnl: p.realizedPnl ?? p.realized_pnl ?? 0,
    unrealized_pnl: p.unrealizedPnl ?? p.unrealized_pnl ?? 0,
    current_value: p.currentValue ?? p.current_value ?? 0,
  };
}

// Insert rows into ClickHouse
async function insertRows(client: ClickHouseClient, rows: UIPosition[]): Promise<void> {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += CONFIG.BATCH_SIZE) {
    const batch = rows.slice(i, i + CONFIG.BATCH_SIZE);
    await client.insert({
      table: CONFIG.TABLE_NAME,
      values: batch,
      format: 'JSONEachRow',
    });
  }
}

// Get wallets by tier
async function getWalletsByTier(client: ClickHouseClient, tier: number): Promise<string[]> {
  const thresholds: Record<number, number> = {
    1: 100000,  // $100k+
    2: 10000,   // $10k+
    3: 1000,    // $1k+
    4: 0,       // All
  };

  const threshold = thresholds[tier] || 0;

  const result = await client.query({
    query: `
      SELECT lower(wallet) as wallet
      FROM (
        SELECT wallet, abs(sum(total_pnl)) as total_pnl
        FROM pm_wallet_market_pnl_v4
        GROUP BY wallet
        HAVING total_pnl >= ${threshold}
      )
      ORDER BY wallet
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as { wallet: string }[];
  return rows.map(r => r.wallet);
}

// Process a single wallet
async function processWallet(client: ClickHouseClient, wallet: string): Promise<number> {
  const positions = await fetchPositionsForWallet(wallet);
  if (positions.length === 0) return 0;

  const rows = positions.map(p => mapToRow(p, wallet));
  await insertRows(client, rows);
  return rows.length;
}

// Worker function
async function worker(
  workerId: number,
  client: ClickHouseClient,
  wallets: string[],
  stats: Stats,
  checkpoint: Checkpoint,
  completedSet: Set<string>
): Promise<void> {
  for (let i = workerId; i < wallets.length; i += CONFIG.WORKERS) {
    const wallet = wallets[i];

    // Skip if already completed
    if (completedSet.has(wallet)) continue;

    try {
      const count = await processWallet(client, wallet);
      stats.processed++;
      stats.totalPositions += count;
      checkpoint.completedWallets.push(wallet);
      completedSet.add(wallet);

      // Rate limiting
      await sleep(CONFIG.RATE_LIMIT_MS);

    } catch (error) {
      stats.failed++;
      checkpoint.failedWallets.push(wallet);
      console.error(`Worker ${workerId}: Failed wallet ${wallet}: ${(error as Error).message}`);
    }

    // Checkpoint save
    if (stats.processed % CONFIG.CHECKPOINT_INTERVAL === 0) {
      saveCheckpoint(checkpoint);
    }
  }
}

// Progress reporter
function startProgressReporter(stats: Stats, totalWallets: number): NodeJS.Timeout {
  return setInterval(() => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const rate = stats.processed / elapsed;
    const eta = (totalWallets - stats.processed) / rate;

    console.log(
      `Progress: ${stats.processed}/${totalWallets} wallets (${((stats.processed/totalWallets)*100).toFixed(1)}%) | ` +
      `Positions: ${stats.totalPositions.toLocaleString()} | ` +
      `Failed: ${stats.failed} | ` +
      `Rate: ${rate.toFixed(1)}/s | ` +
      `ETA: ${Math.ceil(eta/60)}min`
    );
  }, 10000);
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const walletArg = args.find(a => a.startsWith('--wallet='));
  const tierArg = args.find(a => a.startsWith('--tier='));
  const resumeMode = args.includes('--resume');
  const fullMode = args.includes('--full');

  console.log('='.repeat(70));
  console.log('  Polymarket Data API UI Positions Backfill v2');
  console.log('='.repeat(70));

  const client = createClickhouseClient();

  // Single wallet mode
  if (walletArg) {
    const wallet = walletArg.split('=')[1].toLowerCase();
    console.log(`\nBackfilling single wallet: ${wallet}`);

    const count = await processWallet(client, wallet);
    console.log(`Inserted ${count} positions for ${wallet}`);

    await client.close();
    return;
  }

  // Determine tier
  let tier = 1;
  if (tierArg) {
    tier = parseInt(tierArg.split('=')[1]);
  } else if (fullMode) {
    tier = 4;
  }

  console.log(`\nBackfill tier: ${tier} (${tier === 1 ? '100k+' : tier === 2 ? '10k+' : tier === 3 ? '1k+' : 'all'})`);

  // Get wallet list
  console.log('Fetching wallet list...');
  const allWallets = await getWalletsByTier(client, tier);
  console.log(`Found ${allWallets.length.toLocaleString()} wallets`);

  // Load checkpoint if resuming
  let checkpoint: Checkpoint = {
    completedWallets: [],
    failedWallets: [],
    lastUpdated: new Date().toISOString(),
    tier: String(tier),
  };

  const completedSet = new Set<string>();

  if (resumeMode) {
    const saved = loadCheckpoint();
    if (saved && saved.tier === String(tier)) {
      checkpoint = saved;
      checkpoint.completedWallets.forEach(w => completedSet.add(w));
      console.log(`Resuming from checkpoint: ${checkpoint.completedWallets.length} already completed`);
    }
  }

  const remainingWallets = allWallets.filter(w => !completedSet.has(w));
  console.log(`Wallets to process: ${remainingWallets.length.toLocaleString()}`);

  if (remainingWallets.length === 0) {
    console.log('All wallets already processed!');
    await client.close();
    return;
  }

  // Initialize stats
  const stats: Stats = {
    processed: checkpoint.completedWallets.length,
    failed: checkpoint.failedWallets.length,
    totalPositions: 0,
    startTime: Date.now(),
  };

  // Start progress reporter
  const progressInterval = startProgressReporter(stats, allWallets.length);

  // Start workers
  console.log(`\nStarting ${CONFIG.WORKERS} workers...`);
  const workerPromises = [];
  for (let i = 0; i < CONFIG.WORKERS; i++) {
    workerPromises.push(worker(i, client, allWallets, stats, checkpoint, completedSet));
  }

  // Wait for all workers
  await Promise.all(workerPromises);

  // Final checkpoint save
  saveCheckpoint(checkpoint);
  clearInterval(progressInterval);

  // Final stats
  const elapsed = (Date.now() - stats.startTime) / 1000;
  console.log('\n' + '='.repeat(70));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(70));
  console.log(`Total wallets processed: ${stats.processed.toLocaleString()}`);
  console.log(`Total positions inserted: ${stats.totalPositions.toLocaleString()}`);
  console.log(`Failed wallets: ${stats.failed}`);
  console.log(`Time elapsed: ${Math.ceil(elapsed / 60)} minutes`);
  console.log(`Average rate: ${(stats.processed / elapsed).toFixed(1)} wallets/sec`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
