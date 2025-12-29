#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * UI DATA SCRAPER - Playwright MCP Automation
 * ============================================================================
 *
 * This is a COMPANION script to ui-parity-harness.ts that automates the
 * UI scraping process using Playwright MCP tools.
 *
 * NOTE: This script provides INSTRUCTIONS for manual Playwright MCP usage.
 * The actual browser navigation, hovering, and snapshot extraction must be
 * done manually through Claude's MCP integration.
 *
 * WORKFLOW:
 * 1. Load wallet list (same sources as ui-parity-harness.ts)
 * 2. For each wallet, output:
 *    - Navigation URL
 *    - Hover selector
 *    - Data extraction pattern
 * 3. User uses Playwright MCP to scrape each wallet
 * 4. Script saves results to tmp/ui-scrape-cache.json
 *
 * USAGE:
 *   # Generate scraping tasks for first 10 wallets
 *   npx tsx scripts/pnl/scrape-ui-data-mcp.ts --batch 10
 *
 *   # Save a single wallet result
 *   npx tsx scripts/pnl/scrape-ui-data-mcp.ts --save "0x123...,1234.56,5000,-3765.44,50000"
 *
 *   # Resume from checkpoint
 *   npx tsx scripts/pnl/scrape-ui-data-mcp.ts --resume
 *
 * Terminal: Claude 1
 * Date: 2025-12-15
 */

import * as fs from 'fs';
import * as path from 'path';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface WalletToScrape {
  wallet: string;
  username?: string;
  index: number;
}

interface ScrapedData {
  wallet: string;
  net: number;
  gain: number;
  loss: number;
  volume: number;
  scraped_at: string;
}

interface ScrapeCache {
  scraped_at: string;
  last_updated: string;
  wallets: ScrapedData[];
}

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const CACHE_FILE = path.join(process.cwd(), 'tmp', 'ui-scrape-cache.json');
const CHECKPOINT_FILE = path.join(process.cwd(), 'tmp', 'ui-scrape-checkpoint.json');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function loadCache(): ScrapeCache {
  if (!fs.existsSync(CACHE_FILE)) {
    return {
      scraped_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      wallets: [],
    };
  }
  return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
}

function saveCache(cache: ScrapeCache): void {
  cache.last_updated = new Date().toISOString();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`\nCache saved to: ${CACHE_FILE}`);
}

function loadCheckpoint(): Set<string> {
  if (!fs.existsSync(CHECKPOINT_FILE)) {
    return new Set();
  }
  const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
  return new Set(data.completed || []);
}

function saveCheckpoint(completed: Set<string>): void {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({
    completed: Array.from(completed),
    last_updated: new Date().toISOString(),
  }));
}

function loadWalletList(limit: number): WalletToScrape[] {
  // Try wallet-classification-report.json first
  const reportPath = path.join(process.cwd(), 'data', 'wallet-classification-report.json');
  if (fs.existsSync(reportPath)) {
    const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    return data.classifications
      .slice(0, limit)
      .map((c: any, i: number) => ({
        wallet: c.wallet.toLowerCase(),
        username: c.username,
        index: i + 1,
      }));
  }

  // Fallback to playwright_50_wallets.json
  const fallbackPath = path.join(process.cwd(), 'tmp', 'playwright_50_wallets.json');
  if (fs.existsSync(fallbackPath)) {
    const data = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
    return data.wallets
      .slice(0, limit)
      .map((w: any, i: number) => ({
        wallet: w.wallet.toLowerCase(),
        index: i + 1,
      }));
  }

  throw new Error('No wallet list found');
}

// -----------------------------------------------------------------------------
// Scraping Instructions
// -----------------------------------------------------------------------------

function printScrapingInstructions(wallets: WalletToScrape[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('PLAYWRIGHT MCP SCRAPING PROTOCOL');
  console.log('='.repeat(80));

  console.log('\n📋 STEP-BY-STEP INSTRUCTIONS:');
  console.log('\nFor EACH wallet below, execute these MCP tool calls:\n');

  console.log('1️⃣  NAVIGATE to profile page:');
  console.log('   Tool: mcp__playwright__browser_navigate');
  console.log('   URL: https://polymarket.com/profile/{wallet_address}');

  console.log('\n2️⃣  WAIT for page load (3-5 seconds)');

  console.log('\n3️⃣  HOVER over info icon:');
  console.log('   Tool: mcp__playwright__browser_hover');
  console.log('   Selector: .text-text-secondary\\/60');
  console.log('   Alternative: [class*="text-text-secondary"]');
  console.log('   Note: Info icon is next to the main PnL number');

  console.log('\n4️⃣  TAKE SNAPSHOT:');
  console.log('   Tool: mcp__playwright__browser_snapshot');
  console.log('   Extract from tooltip:');
  console.log('     - Net total: $XXX.XX (main number)');
  console.log('     - Gain: $XXX.XX');
  console.log('     - Loss: -$XXX.XX');
  console.log('     - Volume: $XXX.XX');

  console.log('\n5️⃣  SAVE result:');
  console.log('   npx tsx scripts/pnl/scrape-ui-data-mcp.ts --save "wallet,net,gain,loss,volume"');
  console.log('   Example:');
  console.log('   npx tsx scripts/pnl/scrape-ui-data-mcp.ts --save "0x123...,-312.78,1200.50,-1513.28,25000"');

  console.log('\n' + '='.repeat(80));
  console.log('WALLETS TO SCRAPE');
  console.log('='.repeat(80) + '\n');

  for (const w of wallets) {
    console.log(`[${w.index}] ${w.wallet}`);
    console.log(`    Username: ${w.username || 'N/A'}`);
    console.log(`    URL: https://polymarket.com/profile/${w.wallet}`);
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('\n💡 TIPS:');
  console.log('  - Rate limit: Wait 2-3 seconds between requests');
  console.log('  - If hover fails, try alternative selector: button[class*="info"]');
  console.log('  - Tooltip usually appears at top-right of PnL number');
  console.log('  - Save after EACH wallet to preserve progress');
  console.log('');
}

// -----------------------------------------------------------------------------
// Save Handler
// -----------------------------------------------------------------------------

function handleSave(data: string): void {
  const parts = data.split(',').map(p => p.trim());

  if (parts.length !== 5) {
    console.error('❌ Invalid format. Expected: wallet,net,gain,loss,volume');
    console.error('Example: 0x123...,-312.78,1200.50,-1513.28,25000');
    process.exit(1);
  }

  const [wallet, netStr, gainStr, lossStr, volumeStr] = parts;

  const net = parseFloat(netStr);
  const gain = parseFloat(gainStr);
  const loss = parseFloat(lossStr);
  const volume = parseFloat(volumeStr);

  if ([net, gain, loss, volume].some(isNaN)) {
    console.error('❌ Invalid numbers. Ensure all values are numeric.');
    process.exit(1);
  }

  // Load cache
  const cache = loadCache();
  const checkpoint = loadCheckpoint();

  // Check if already exists
  const existingIndex = cache.wallets.findIndex(
    w => w.wallet.toLowerCase() === wallet.toLowerCase()
  );

  const scraped: ScrapedData = {
    wallet: wallet.toLowerCase(),
    net,
    gain,
    loss,
    volume,
    scraped_at: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    cache.wallets[existingIndex] = scraped;
    console.log(`✅ Updated existing entry for ${wallet}`);
  } else {
    cache.wallets.push(scraped);
    console.log(`✅ Added new entry for ${wallet}`);
  }

  // Update checkpoint
  checkpoint.add(wallet.toLowerCase());

  // Save
  saveCache(cache);
  saveCheckpoint(checkpoint);

  console.log(`\nData saved:`);
  console.log(`  Wallet: ${wallet}`);
  console.log(`  Net: $${net.toFixed(2)}`);
  console.log(`  Gain: $${gain.toFixed(2)}`);
  console.log(`  Loss: $${loss.toFixed(2)}`);
  console.log(`  Volume: $${volume.toFixed(2)}`);
  console.log(`\nTotal wallets scraped: ${cache.wallets.length}`);
  console.log(`Checkpoint: ${checkpoint.size} wallets completed`);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  // Handle --save
  if (args.includes('--save')) {
    const idx = args.indexOf('--save');
    const data = args[idx + 1];
    if (!data) {
      console.error('❌ --save requires data argument');
      process.exit(1);
    }
    handleSave(data);
    return;
  }

  // Handle batch generation
  const batchSize = args.includes('--batch')
    ? parseInt(args[args.indexOf('--batch') + 1], 10) || 10
    : 10;

  const resume = args.includes('--resume');

  console.log('='.repeat(80));
  console.log('UI DATA SCRAPER - Playwright MCP');
  console.log('='.repeat(80));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Batch size: ${batchSize}\n`);

  // Load wallets
  const allWallets = loadWalletList(50);
  console.log(`Loaded ${allWallets.length} wallets from source\n`);

  // Load checkpoint
  const completed = loadCheckpoint();
  console.log(`Checkpoint: ${completed.size} wallets already completed\n`);

  // Filter to pending wallets
  const pending = resume
    ? allWallets.filter(w => !completed.has(w.wallet))
    : allWallets;

  const batch = pending.slice(0, batchSize);

  if (batch.length === 0) {
    console.log('✅ All wallets completed!');
    console.log(`\nCache file: ${CACHE_FILE}`);
    console.log('You can now run ui-parity-harness.ts to validate.');
    return;
  }

  console.log(`Remaining wallets: ${pending.length}`);
  console.log(`Current batch: ${batch.length}\n`);

  // Print instructions
  printScrapingInstructions(batch);

  // Summary
  console.log('='.repeat(80));
  console.log('NEXT STEPS');
  console.log('='.repeat(80));
  console.log('1. Use Playwright MCP to scrape each wallet (follow instructions above)');
  console.log('2. Save each result using --save command');
  console.log('3. Re-run with --resume to get next batch');
  console.log('4. When complete, run ui-parity-harness.ts to validate results');
  console.log('');
}

main();
