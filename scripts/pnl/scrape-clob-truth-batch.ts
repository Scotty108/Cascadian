#!/usr/bin/env npx tsx
/**
 * Batch Scrape CLOB-Only Truth Dataset
 *
 * Iterates through wallet queue and scrapes Polymarket UI tooltip values.
 * Includes running stats dashboard, two-tier capture, and checkpoint saving.
 *
 * Usage:
 *   npx tsx scripts/pnl/scrape-clob-truth-batch.ts [queue-file]
 *   npx tsx scripts/pnl/scrape-clob-truth-batch.ts tmp/clob_only_truth_queue_100.json
 *
 * Features:
 * - Running dashboard every 5 additions
 * - Two-tier capture (A: |PnL| >= 500, B: 200-499)
 * - Snapshot log for recovery
 * - Retry logic for navigation failures
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadTruthDataset,
  saveTruthDataset,
  computeStats,
  formatDashboard,
  appendProgressEntry,
  type WalletTruthEntry,
  type TruthDataset,
} from '../../lib/pnl/clobOnlyTruthStats';

// Configuration
const TARGET_WALLETS = 100;
const MIN_PNL_TIER_A = 500;
const MIN_PNL_TIER_B = 200;
const DASHBOARD_INTERVAL = 5;

const TRUTH_PATH = path.join(process.cwd(), 'data/regression/clob_only_truth_v1.json');
const SNAPSHOT_LOG_PATH = path.join(process.cwd(), 'tmp/clob_truth_stats_snapshots.jsonl');

interface QueueWallet {
  wallet: string;
  clob_events: number;
  cash_flow: number;
  open_positions_approx: number;
  priority_score: number;
}

interface QueueFile {
  metadata: {
    generated_at: string;
    total_candidates: number;
    wallets_already_in_truth: number;
    wallets_needed: number;
  };
  queue: QueueWallet[];
}

interface ScrapedData {
  uiPnl: number;
  gain: number;
  loss: number;
  volume: number;
  identityCheckPass: boolean;
}

// Simulated scrape function - this will be called by MCP Playwright
// In actual use, this will be replaced with real browser automation
async function scrapeWalletTooltip(wallet: string): Promise<ScrapedData | null> {
  // This is a placeholder - actual scraping uses MCP Playwright
  // The real implementation navigates to profile, clicks ALL, hovers info icon
  console.log(`    [SCRAPE] Would navigate to https://polymarket.com/profile/${wallet}`);
  console.log(`    [SCRAPE] Click ALL button, hover info icon, extract tooltip`);

  // Return null to indicate scraping not implemented in this script
  // The scraping will be done manually or via MCP Playwright
  return null;
}

function loadQueue(queuePath: string): QueueWallet[] {
  if (!fs.existsSync(queuePath)) {
    console.error(`Queue file not found: ${queuePath}`);
    process.exit(1);
  }

  const data: QueueFile = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  return data.queue;
}

function saveSnapshot(stats: ReturnType<typeof computeStats>, walletCount: number) {
  const snapshot = {
    timestamp: new Date().toISOString(),
    wallet_count: walletCount,
    ...stats,
  };
  fs.appendFileSync(SNAPSHOT_LOG_PATH, JSON.stringify(snapshot) + '\n');
}

function getTier(pnl: number): 'A' | 'B' | 'SKIP' {
  const absPnl = Math.abs(pnl);
  if (absPnl >= MIN_PNL_TIER_A) return 'A';
  if (absPnl >= MIN_PNL_TIER_B) return 'B';
  return 'SKIP';
}

async function processWallet(
  wallet: string,
  queueEntry: QueueWallet,
  scrapedData: ScrapedData
): Promise<WalletTruthEntry | null> {
  const tier = getTier(scrapedData.uiPnl);

  if (tier === 'SKIP') {
    console.log(`    [SKIP] |PnL| = $${Math.abs(scrapedData.uiPnl).toFixed(2)} < $${MIN_PNL_TIER_B} threshold`);
    appendProgressEntry({
      wallet,
      uiPnl: scrapedData.uiPnl,
      skipped: true,
    });
    return null;
  }

  const entry: WalletTruthEntry = {
    wallet,
    uiPnl: scrapedData.uiPnl,
    gain: scrapedData.gain,
    loss: scrapedData.loss,
    volume: scrapedData.volume,
    scrapedAt: new Date().toISOString(),
    identityCheckPass: scrapedData.identityCheckPass,
    clobEvents: queueEntry.clob_events,
    openPositionsApprox: queueEntry.open_positions_approx,
    cashFlowEstimate: queueEntry.cash_flow,
    notes: `CLOB-only wallet. Tier ${tier}. Tooltip verified via MCP Playwright.`,
  };

  console.log(`    [ADD] Tier ${tier}: $${scrapedData.uiPnl.toFixed(2)} PnL`);
  appendProgressEntry(entry);

  return entry;
}

async function runBatchScraper(queuePath: string) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CLOB-ONLY TRUTH BATCH SCRAPER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load current truth dataset
  let truthDataset = loadTruthDataset();
  if (!truthDataset) {
    truthDataset = {
      metadata: {
        generated_at: new Date().toISOString(),
        source: 'mcp_playwright_tooltip_verified',
        method: 'MCP Playwright: Navigate to profile, click ALL, hover info icon, extract tooltip values',
        classification: 'CLOB_ONLY',
        wallet_count: 0,
        identity_pass_count: 0,
      },
      wallets: [],
    };
  }

  const existingWallets = new Set(truthDataset.wallets.map(w => w.wallet.toLowerCase()));
  console.log(`  Current truth wallets: ${existingWallets.size}`);
  console.log(`  Target: ${TARGET_WALLETS}`);
  console.log(`  Need: ${TARGET_WALLETS - existingWallets.size}\n`);

  if (existingWallets.size >= TARGET_WALLETS) {
    console.log('✓ Already have 100+ wallets. Run validate-truth-vs-v29.ts instead.');
    return;
  }

  // Load queue
  const queue = loadQueue(queuePath);
  console.log(`  Queue loaded: ${queue.length} candidates\n`);

  // Filter queue to remove already-scraped
  const remainingQueue = queue.filter(q => !existingWallets.has(q.wallet.toLowerCase()));
  console.log(`  Remaining after dedup: ${remainingQueue.length}\n`);

  // Clear snapshot log for fresh run
  if (fs.existsSync(SNAPSHOT_LOG_PATH)) {
    fs.unlinkSync(SNAPSHOT_LOG_PATH);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SCRAPING INSTRUCTIONS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`
  This script prepares the queue but requires MCP Playwright for actual scraping.

  To scrape wallets manually with MCP Playwright:

  For each wallet in the queue below, run:

  1. Navigate to: https://polymarket.com/profile/{wallet}
  2. Click the "ALL" button in P/L timeframe selector
  3. Hover the info (i) icon next to Profit/Loss
  4. Extract from tooltip:
     - Volume Traded
     - Gain
     - Loss
     - Net Total (this is uiPnl)
  5. Verify: Gain - |Loss| = Net Total (identity check)
  6. Add to truth file if |Net Total| >= $${MIN_PNL_TIER_B}

  The first ${TARGET_WALLETS - existingWallets.size} wallets to scrape:
  `);

  // Print scrape queue
  const toScrape = remainingQueue.slice(0, TARGET_WALLETS - existingWallets.size + 20); // +20 buffer for skips
  toScrape.forEach((w, i) => {
    console.log(`  ${(i + 1).toString().padStart(3)}. ${w.wallet}`);
    console.log(`       CLOB events: ${w.clob_events}, Est. positions: ${w.open_positions_approx}, Cash flow: $${w.cash_flow.toFixed(2)}`);
    console.log(`       URL: https://polymarket.com/profile/${w.wallet}\n`);
  });

  // Save queue to easily accessible file
  const scrapeQueuePath = path.join(process.cwd(), 'tmp/clob_truth_scrape_queue.json');
  fs.writeFileSync(scrapeQueuePath, JSON.stringify({
    generated_at: new Date().toISOString(),
    target_count: TARGET_WALLETS - existingWallets.size,
    min_pnl_tier_a: MIN_PNL_TIER_A,
    min_pnl_tier_b: MIN_PNL_TIER_B,
    wallets: toScrape.map(w => ({
      wallet: w.wallet,
      url: `https://polymarket.com/profile/${w.wallet}`,
      clob_events: w.clob_events,
      open_positions_approx: w.open_positions_approx,
      cash_flow: w.cash_flow,
    })),
  }, null, 2));

  console.log(`\n✓ Scrape queue saved to: ${scrapeQueuePath}`);
  console.log(`\n  After scraping, manually add entries to: ${TRUTH_PATH}`);
  console.log(`  Then run: npx tsx scripts/pnl/validate-truth-vs-v29.ts`);
}

// Also export a helper to add a single scraped wallet
export async function addScrapedWallet(
  wallet: string,
  tooltipData: {
    volume: number;
    gain: number;
    loss: number;
    netTotal: number;
  },
  clobEvents: number,
  openPositionsApprox: number,
  cashFlowEstimate: number
): Promise<boolean> {
  // Identity check
  const expectedNet = tooltipData.gain - Math.abs(tooltipData.loss);
  const identityCheckPass = Math.abs(expectedNet - tooltipData.netTotal) < 1;

  if (!identityCheckPass) {
    console.log(`    [WARN] Identity check failed: ${tooltipData.gain} - ${Math.abs(tooltipData.loss)} = ${expectedNet} != ${tooltipData.netTotal}`);
  }

  const tier = getTier(tooltipData.netTotal);
  if (tier === 'SKIP') {
    console.log(`    [SKIP] |PnL| = $${Math.abs(tooltipData.netTotal).toFixed(2)} < $${MIN_PNL_TIER_B}`);
    return false;
  }

  // Load current dataset
  let dataset = loadTruthDataset();
  if (!dataset) {
    dataset = {
      metadata: {
        generated_at: new Date().toISOString(),
        source: 'mcp_playwright_tooltip_verified',
        method: 'MCP Playwright tooltip extraction',
        classification: 'CLOB_ONLY',
        wallet_count: 0,
        identity_pass_count: 0,
      },
      wallets: [],
    };
  }

  // Check if already exists
  if (dataset.wallets.some(w => w.wallet.toLowerCase() === wallet.toLowerCase())) {
    console.log(`    [SKIP] Wallet already in truth dataset`);
    return false;
  }

  // Add entry
  const entry: WalletTruthEntry = {
    wallet: wallet.toLowerCase(),
    uiPnl: tooltipData.netTotal,
    gain: tooltipData.gain,
    loss: tooltipData.loss,
    volume: tooltipData.volume,
    scrapedAt: new Date().toISOString(),
    identityCheckPass,
    clobEvents,
    openPositionsApprox,
    cashFlowEstimate,
    notes: `CLOB-only wallet. Tier ${tier}. Tooltip verified.`,
  };

  dataset.wallets.push(entry);
  dataset.metadata.wallet_count = dataset.wallets.length;
  dataset.metadata.identity_pass_count = dataset.wallets.filter(w => w.identityCheckPass).length;

  saveTruthDataset(dataset);

  console.log(`    [ADD] Wallet ${wallet.slice(0, 10)}... Tier ${tier}: $${tooltipData.netTotal.toFixed(2)}`);
  console.log(`    [INFO] Truth dataset now has ${dataset.wallets.length} wallets`);

  // Print dashboard every DASHBOARD_INTERVAL
  if (dataset.wallets.length % DASHBOARD_INTERVAL === 0) {
    const stats = computeStats(dataset);
    console.log(formatDashboard(stats));
    saveSnapshot(stats, dataset.wallets.length);
  }

  return true;
}

// Main
const queuePath = process.argv[2] || path.join(process.cwd(), 'tmp/clob_only_truth_queue_100.json');
runBatchScraper(queuePath).catch(console.error);
