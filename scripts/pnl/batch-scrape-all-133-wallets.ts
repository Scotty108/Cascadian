/**
 * Batch Scrape UI PnL for All 133 Benchmark Wallets
 *
 * This script uses Playwright to scrape Polymarket UI PnL values for all 133
 * unique wallets in our benchmark table. Results are saved to JSON for seeding.
 *
 * Run with: npx playwright install chromium && npx tsx scripts/pnl/batch-scrape-all-133-wallets.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import { getClickHouseClient } from '../../lib/clickhouse/client';

interface ScrapeResult {
  wallet: string;
  ui_pnl: number | null;
  scraped_at: string;
  error?: string;
}

const OUTPUT_FILE = '/tmp/fresh_133_wallets_scraped.json';
const CHECKPOINT_FILE = '/tmp/scrape_checkpoint.json';
const BENCHMARK_SET = 'fresh_2025_12_16_all_133';

// Rate limiting
const DELAY_BETWEEN_WALLETS_MS = 2000; // 2 seconds between requests
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000;

async function loadWalletsFromDB(): Promise<string[]> {
  const client = getClickHouseClient();
  const result = await client.query({
    query: `SELECT DISTINCT wallet FROM pm_ui_pnl_benchmarks_v1 ORDER BY wallet`,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as { wallet: string }[];
  return rows.map((r) => r.wallet);
}

function parseUIPnL(text: string): number | null {
  // Parse values like "$22,053,934.00", "-$456.78", "−$102,200"
  if (!text) return null;

  const cleaned = text
    .replace(/[$,]/g, '')
    .replace(/−/g, '-') // Unicode minus
    .replace(/\u2212/g, '-') // Another unicode minus
    .trim();

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

async function scrapeWallet(
  page: Page,
  wallet: string
): Promise<{ pnl: number | null; error?: string }> {
  const url = `https://polymarket.com/profile/${wallet}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

    // Wait for the page to load with data
    await page.waitForTimeout(3000);

    // Look for the Profit/Loss section
    // The structure is: heading "Profit/Loss" followed by the value in a nested element
    const pnlSelectors = [
      // Try various possible selectors
      'text=/Profit.*Loss/i >> .. >> text=/\\$[\\d,.-]+/',
      '[data-testid="profit-loss-value"]',
      ':text("Profit/Loss") + div',
      'h2:has-text("Profit/Loss") ~ div',
    ];

    let pnlText: string | null = null;

    // Try to find the PnL value
    // First, look for any text matching dollar amounts near "Profit/Loss"
    const content = await page.content();

    // Look for the pattern in the page content
    // Polymarket shows P/L like: Profit/Loss ... $22,053,934.00
    const profitLossMatch = content.match(
      /Profit[^<]*Loss[^$]*(\$[\d,.-]+|\−\$[\d,.-]+|-\$[\d,.-]+)/i
    );
    if (profitLossMatch) {
      pnlText = profitLossMatch[1];
    }

    if (!pnlText) {
      // Try getting all text and finding the pattern
      const allText = await page.innerText('body');
      const lines = allText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes('profit') && lines[i].toLowerCase().includes('loss')) {
          // Check next few lines for a dollar amount
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const match = lines[j].match(/(\$[\d,.-]+|\−\$[\d,.-]+|-\$[\d,.-]+)/);
            if (match) {
              pnlText = match[1];
              break;
            }
          }
          if (pnlText) break;
        }
      }
    }

    if (!pnlText) {
      // Last resort: use accessibility snapshot-like approach
      // Look for any prominent dollar amount that could be the PnL
      const allText = await page.innerText('body');
      const dollarMatches = allText.match(/\$[\d,]+\.?\d*/g);
      if (dollarMatches && dollarMatches.length > 0) {
        // The PnL is usually one of the larger values
        // This is a fallback - not reliable
        return { pnl: null, error: 'Could not locate PnL value reliably' };
      }
      return { pnl: null, error: 'No dollar amounts found on page' };
    }

    const pnl = parseUIPnL(pnlText);
    if (pnl === null) {
      return { pnl: null, error: `Could not parse PnL: ${pnlText}` };
    }

    return { pnl };
  } catch (err: any) {
    return { pnl: null, error: err.message };
  }
}

function loadCheckpoint(): Map<string, ScrapeResult> {
  const results = new Map<string, ScrapeResult>();
  if (fs.existsSync(CHECKPOINT_FILE)) {
    const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    for (const r of data) {
      if (r.ui_pnl !== null) {
        results.set(r.wallet, r);
      }
    }
    console.log(`Loaded ${results.size} successful results from checkpoint`);
  }
  return results;
}

function saveCheckpoint(results: ScrapeResult[]) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(results, null, 2));
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   BATCH SCRAPE ALL 133 BENCHMARK WALLETS                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Load wallets
  console.log('Loading wallets from database...');
  const wallets = await loadWalletsFromDB();
  console.log(`Found ${wallets.length} unique wallets\n`);

  // Load any existing checkpoint
  const existingResults = loadCheckpoint();

  // Filter out already-scraped wallets
  const remaining = wallets.filter((w) => !existingResults.has(w.toLowerCase()));
  console.log(`${remaining.length} wallets remaining to scrape\n`);

  if (remaining.length === 0) {
    console.log('All wallets already scraped! Converting to final output...');
    const allResults = wallets.map((w) => existingResults.get(w.toLowerCase())!);
    saveFinalOutput(allResults);
    return;
  }

  // Launch browser
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  // Process wallets
  const results: ScrapeResult[] = Array.from(existingResults.values());
  let successCount = existingResults.size;
  let errorCount = 0;

  for (let i = 0; i < remaining.length; i++) {
    const wallet = remaining[i];
    const progress = `[${i + 1}/${remaining.length}]`;

    process.stdout.write(`${progress} Scraping ${wallet.slice(0, 10)}...`);

    let lastError = '';
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      const { pnl, error } = await scrapeWallet(page, wallet);

      if (pnl !== null) {
        results.push({
          wallet: wallet.toLowerCase(),
          ui_pnl: pnl,
          scraped_at: new Date().toISOString(),
        });
        successCount++;
        console.log(` $${pnl.toLocaleString()}`);
        break;
      } else {
        lastError = error || 'Unknown error';
        if (retry < MAX_RETRIES - 1) {
          process.stdout.write(` retry ${retry + 2}...`);
          await page.waitForTimeout(1000);
        }
      }
    }

    if (results[results.length - 1]?.wallet !== wallet.toLowerCase()) {
      results.push({
        wallet: wallet.toLowerCase(),
        ui_pnl: null,
        scraped_at: new Date().toISOString(),
        error: lastError,
      });
      errorCount++;
      console.log(` ERROR: ${lastError}`);
    }

    // Save checkpoint every 10 wallets
    if ((i + 1) % 10 === 0) {
      saveCheckpoint(results);
      console.log(`\n  [Checkpoint saved: ${successCount} success, ${errorCount} errors]\n`);
    }

    // Rate limiting
    await page.waitForTimeout(DELAY_BETWEEN_WALLETS_MS);
  }

  // Cleanup
  await browser.close();

  // Save final results
  saveFinalOutput(results);

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   SUMMARY                                                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Total wallets: ${wallets.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Success rate: ${((successCount / wallets.length) * 100).toFixed(1)}%`);
  console.log(`\nResults saved to: ${OUTPUT_FILE}`);
  console.log(`\nNext step: Seed results with:`);
  console.log(`  npx tsx scripts/pnl/seed-ui-benchmarks-from-file.ts ${OUTPUT_FILE}`);
}

function saveFinalOutput(results: ScrapeResult[]) {
  const successfulResults = results.filter((r) => r.ui_pnl !== null);

  const output = {
    metadata: {
      benchmark_set: BENCHMARK_SET,
      source: 'polymarket_ui_playwright',
      captured_at: new Date().toISOString(),
      notes: `Fresh scrape of all ${results.length} benchmark wallets on Dec 16, 2025`,
    },
    wallets: successfulResults.map((r) => ({
      wallet: r.wallet,
      ui_pnl: r.ui_pnl,
    })),
    errors: results.filter((r) => r.ui_pnl === null),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nSaved ${successfulResults.length} successful results to ${OUTPUT_FILE}`);
}

main().catch(console.error);
