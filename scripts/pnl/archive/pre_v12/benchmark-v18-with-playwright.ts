/**
 * V18 Benchmark Script with Playwright UI Scraping
 *
 * Scrapes Polymarket UI for wallet data and compares against V18 engine.
 * Builds cumulative accuracy report across batches.
 *
 * Usage:
 *   npx tsx scripts/pnl/benchmark-v18-with-playwright.ts [count]
 *
 * Examples:
 *   npx tsx scripts/pnl/benchmark-v18-with-playwright.ts 5    # First 5 wallets
 *   npx tsx scripts/pnl/benchmark-v18-with-playwright.ts 10   # Next 10 wallets
 */

import { chromium, Browser, Page } from 'playwright';
import { createV18Engine } from '../../lib/pnl/uiActivityEngineV18';
import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const REPORT_FILE = 'data/v18-benchmark-report.json';

interface UIData {
  wallet: string;
  username: string;
  pnl: number;
  volume: number;
  gain: number;
  loss: number;
  positions_value: number;
  biggest_win: number;
  predictions: number;
  has_open_positions: boolean;  // True if positions_value > 0
  scraped_at: string;
}

interface V18Data {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;
  positions_count: number;
}

interface BenchmarkResult {
  wallet: string;
  batch: number;
  ui: UIData;
  v18: V18Data;
  pnl_diff: number;
  pnl_error_pct: number;
  // Compare total PnL (realized + unrealized) when open positions exist
  total_pnl_diff: number;
  total_pnl_error_pct: number;
  volume_diff: number;
  volume_error_pct: number;
  accuracy: {
    exact: boolean;           // Within $0.01
    within_dollar: boolean;   // Within $1
    within_5_dollars: boolean;
    within_1_pct: boolean;
    within_2_pct: boolean;
    within_5_pct: boolean;
    within_10_pct: boolean;
    sign_match: boolean;
  };
  // Additional accuracy when comparing total PnL (for wallets with open positions)
  accuracy_total: {
    exact: boolean;
    within_dollar: boolean;
    within_5_dollars: boolean;
    within_1_pct: boolean;
    within_2_pct: boolean;
    within_5_pct: boolean;
    within_10_pct: boolean;
    sign_match: boolean;
  };
  notes: string[];
}

interface Report {
  last_updated: string;
  total_wallets: number;
  batches: number[];
  results: BenchmarkResult[];
  summary: {
    exact_matches: number;
    within_dollar: number;
    within_5_dollars: number;
    within_1_pct: number;
    within_2_pct: number;
    within_5_pct: number;
    within_10_pct: number;
    sign_matches: number;
    avg_error_pct: number;
    median_error_pct: number;
  };
}

async function getRandomWallets(count: number, excludeWallets: string[]): Promise<string[]> {
  const excludeList = excludeWallets.map(w => `'${w.toLowerCase()}'`).join(',');
  const excludeClause = excludeWallets.length > 0
    ? `AND lower(trader_wallet) NOT IN (${excludeList})`
    : '';

  const query = `
    SELECT trader_wallet, count() as trades, sum(usdc_amount)/1e6 as volume
    FROM pm_trader_events_v2
    WHERE is_deleted = 0 ${excludeClause}
    GROUP BY trader_wallet
    HAVING trades > 20 AND volume > 500
    ORDER BY rand()
    LIMIT ${count}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => r.trader_wallet);
}

async function scrapeWalletUI(page: Page, wallet: string): Promise<UIData> {
  const url = `https://polymarket.com/profile/${wallet}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for page to render
  await page.waitForTimeout(3000);

  // Click ALL time period - use text selector since it's not a button
  try {
    await page.click('text=ALL');
    await page.waitForTimeout(1500);
    console.log('  Clicked ALL timeframe');
  } catch (e) {
    console.log('  Could not click ALL button');
  }

  // Get username
  let username = 'Anon';
  try {
    const usernameEl = await page.locator('p').first();
    username = await usernameEl.textContent() || 'Anon';
  } catch (e) {}

  // Check if this is an "Anon" (invalid) wallet
  if (username === 'Anon') {
    return {
      wallet,
      username: 'Anon',
      pnl: 0,
      volume: 0,
      gain: 0,
      loss: 0,
      positions_value: 0,
      biggest_win: 0,
      predictions: 0,
      has_open_positions: false,
      scraped_at: new Date().toISOString(),
    };
  }

  // Hover over info icon to get tooltip data with volume/gain/loss/pnl
  let volume = 0, gain = 0, loss = 0, pnl = 0;

  // Helper function to parse tooltip text
  const parseTooltip = (text: string) => {
    // Parse: "Volume traded $13,297.98 Gain +$0.01 Loss -$7.03 Net total -$7.02"
    const volumeMatch = text.match(/Volume traded\s*\$?([\d,]+\.?\d*)/i);
    if (volumeMatch) volume = parseFloat(volumeMatch[1].replace(/,/g, ''));

    const gainMatch = text.match(/Gain\s*\+?\$?([\d,]+\.?\d*)/i);
    if (gainMatch) gain = parseFloat(gainMatch[1].replace(/,/g, ''));

    const lossMatch = text.match(/Loss\s*-?\$?([\d,]+\.?\d*)/i);
    if (lossMatch) loss = -Math.abs(parseFloat(lossMatch[1].replace(/,/g, '')));

    // Handle both +$6,354.54 and -$77.93 formats
    const netMatch = text.match(/Net total\s*([+-]?\$?[\d,]+\.?\d*)/i);
    if (netMatch) {
      const netStr = netMatch[1].replace(/[$,]/g, '');
      pnl = parseFloat(netStr);
      console.log(`  Parsed Net total: ${netStr} -> ${pnl}`);
    }
  };

  try {
    // Find and hover the info icon (using text-secondary class selector from snapshot)
    // The info icon is near the Profit/Loss heading
    const infoIcon = page.locator('.text-text-secondary\\/60').first();
    await infoIcon.hover();
    await page.waitForTimeout(1000);

    // Try to get tooltip using role
    const tooltipEl = page.getByRole('tooltip');
    const tooltipText = await tooltipEl.textContent({ timeout: 2000 });

    if (tooltipText) {
      parseTooltip(tooltipText);
    }
  } catch (e) {
    // Fallback: Try alternative selectors
    try {
      // Try hovering on any img with cursor pointer in the Profit/Loss section
      const imgs = page.locator('img[cursor="pointer"]');
      const count = await imgs.count();
      for (let i = 0; i < Math.min(count, 3); i++) {
        await imgs.nth(i).hover();
        await page.waitForTimeout(500);

        try {
          const tooltipEl = page.getByRole('tooltip');
          const tooltipText = await tooltipEl.textContent({ timeout: 1000 });
          if (tooltipText && tooltipText.includes('Net total')) {
            parseTooltip(tooltipText);
            break;
          }
        } catch (e) {}
      }
    } catch (e2) {}
  }

  // Final fallback: Get PnL from page content if tooltip failed
  if (pnl === 0) {
    try {
      const content = await page.content();
      // Look for pattern in rendered HTML
      const netMatch = content.match(/>Net total<.*?>([-$\d,\.]+)</s);
      if (netMatch) {
        pnl = parseFloat(netMatch[1].replace(/[$,]/g, ''));
      }
    } catch (e) {}
  }

  // Log what we got
  if (pnl !== 0 || volume !== 0) {
    console.log(`  Tooltip: PnL=$${pnl.toFixed(2)}, Vol=$${volume.toFixed(2)}`);
  } else {
    console.log('  Could not get PnL from tooltip');
  }

  // Get other stats
  let positions_value = 0, biggest_win = 0, predictions = 0;
  try {
    const posValueEl = await page.locator('text="Positions Value"').locator('..').locator('p').last();
    const posText = await posValueEl.textContent();
    if (posText) positions_value = parseFloat(posText.replace(/[$,]/g, '')) || 0;
  } catch (e) {}

  try {
    const bigWinEl = await page.locator('text="Biggest Win"').locator('..').locator('p').last();
    const winText = await bigWinEl.textContent();
    if (winText && winText !== '—') biggest_win = parseFloat(winText.replace(/[$,]/g, '')) || 0;
  } catch (e) {}

  try {
    const predEl = await page.locator('text="Predictions"').locator('..').locator('p').last();
    const predText = await predEl.textContent();
    if (predText) predictions = parseInt(predText.replace(/,/g, '')) || 0;
  } catch (e) {}

  return {
    wallet,
    username,
    pnl,
    volume,
    gain,
    loss,
    positions_value,
    biggest_win,
    predictions,
    has_open_positions: positions_value > 0,
    scraped_at: new Date().toISOString(),
  };
}

async function computeV18(wallet: string): Promise<V18Data> {
  const engine = createV18Engine();
  const result = await engine.compute(wallet);

  return {
    wallet,
    realized_pnl: result.realized_pnl,
    unrealized_pnl: result.unrealized_pnl,
    total_pnl: result.total_pnl,
    volume_traded: result.volume_traded,
    volume_buys: result.volume_buys,
    volume_sells: result.volume_sells,
    positions_count: result.positions_count,
  };
}

function calculateAccuracy(ui_pnl: number, v18_pnl: number): BenchmarkResult['accuracy'] {
  const diff = Math.abs(ui_pnl - v18_pnl);
  const pct = ui_pnl !== 0 ? (diff / Math.abs(ui_pnl)) * 100 : (v18_pnl === 0 ? 0 : 100);

  return {
    exact: diff < 0.01,
    within_dollar: diff < 1,
    within_5_dollars: diff < 5,
    within_1_pct: pct < 1,
    within_2_pct: pct < 2,
    within_5_pct: pct < 5,
    within_10_pct: pct < 10,
    sign_match: (ui_pnl >= 0) === (v18_pnl >= 0),
  };
}

function loadReport(): Report {
  if (fs.existsSync(REPORT_FILE)) {
    return JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
  }
  return {
    last_updated: new Date().toISOString(),
    total_wallets: 0,
    batches: [],
    results: [],
    summary: {
      exact_matches: 0,
      within_dollar: 0,
      within_5_dollars: 0,
      within_1_pct: 0,
      within_2_pct: 0,
      within_5_pct: 0,
      within_10_pct: 0,
      sign_matches: 0,
      avg_error_pct: 0,
      median_error_pct: 0,
    },
  };
}

function saveReport(report: Report): void {
  // Ensure data directory exists
  if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
  }
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
}

function updateSummary(report: Report): void {
  const validResults = report.results.filter(r => r.ui.username !== 'Anon');
  const n = validResults.length;

  if (n === 0) return;

  report.summary = {
    exact_matches: validResults.filter(r => r.accuracy.exact).length,
    within_dollar: validResults.filter(r => r.accuracy.within_dollar).length,
    within_5_dollars: validResults.filter(r => r.accuracy.within_5_dollars).length,
    within_1_pct: validResults.filter(r => r.accuracy.within_1_pct).length,
    within_2_pct: validResults.filter(r => r.accuracy.within_2_pct).length,
    within_5_pct: validResults.filter(r => r.accuracy.within_5_pct).length,
    within_10_pct: validResults.filter(r => r.accuracy.within_10_pct).length,
    sign_matches: validResults.filter(r => r.accuracy.sign_match).length,
    avg_error_pct: validResults.reduce((s, r) => s + r.pnl_error_pct, 0) / n,
    median_error_pct: [...validResults].sort((a, b) => a.pnl_error_pct - b.pnl_error_pct)[Math.floor(n / 2)].pnl_error_pct,
  };
}

function printReport(report: Report): void {
  const validResults = report.results.filter(r => r.ui.username !== 'Anon');
  const n = validResults.length;

  console.log('\n' + '='.repeat(100));
  console.log('V18 BENCHMARK REPORT');
  console.log('='.repeat(100));
  console.log(`Last Updated: ${report.last_updated}`);
  console.log(`Total Wallets: ${report.total_wallets} (${n} valid, ${report.total_wallets - n} Anon/invalid)`);
  console.log(`Batches: ${report.batches.join(', ')}`);

  console.log('\n' + '-'.repeat(100));
  console.log('ACCURACY SUMMARY');
  console.log('-'.repeat(100));
  console.log(`Exact matches (<$0.01):     ${report.summary.exact_matches}/${n} (${(report.summary.exact_matches/n*100).toFixed(1)}%)`);
  console.log(`Within $1:                  ${report.summary.within_dollar}/${n} (${(report.summary.within_dollar/n*100).toFixed(1)}%)`);
  console.log(`Within $5:                  ${report.summary.within_5_dollars}/${n} (${(report.summary.within_5_dollars/n*100).toFixed(1)}%)`);
  console.log(`Within 1%:                  ${report.summary.within_1_pct}/${n} (${(report.summary.within_1_pct/n*100).toFixed(1)}%)`);
  console.log(`Within 2%:                  ${report.summary.within_2_pct}/${n} (${(report.summary.within_2_pct/n*100).toFixed(1)}%)`);
  console.log(`Within 5%:                  ${report.summary.within_5_pct}/${n} (${(report.summary.within_5_pct/n*100).toFixed(1)}%)`);
  console.log(`Within 10%:                 ${report.summary.within_10_pct}/${n} (${(report.summary.within_10_pct/n*100).toFixed(1)}%)`);
  console.log(`Sign matches:               ${report.summary.sign_matches}/${n} (${(report.summary.sign_matches/n*100).toFixed(1)}%)`);
  console.log(`Average error:              ${report.summary.avg_error_pct.toFixed(2)}%`);
  console.log(`Median error:               ${report.summary.median_error_pct.toFixed(2)}%`);

  console.log('\n' + '-'.repeat(100));
  console.log('DETAILED RESULTS');
  console.log('-'.repeat(100));
  console.log('Wallet           | Username     | UI PnL         | V18 PnL        | Diff       | Error %  | Status');
  console.log('-'.repeat(100));

  for (const r of validResults.slice(-20)) {  // Show last 20
    const status = r.accuracy.exact ? '✓ EXACT' :
                   r.accuracy.within_1_pct ? '✓ <1%' :
                   r.accuracy.within_5_pct ? '~ <5%' :
                   r.accuracy.within_10_pct ? '~ <10%' : '✗ >10%';
    console.log(
      `${r.wallet.substring(0, 14)}... | ` +
      `${r.ui.username.substring(0, 12).padEnd(12)} | ` +
      `$${r.ui.pnl.toFixed(2).padStart(12)} | ` +
      `$${r.v18.realized_pnl.toFixed(2).padStart(12)} | ` +
      `$${r.pnl_diff.toFixed(2).padStart(8)} | ` +
      `${r.pnl_error_pct.toFixed(1).padStart(6)}% | ` +
      `${status}`
    );
  }

  console.log('\n' + '='.repeat(100));
}

async function main() {
  const count = parseInt(process.argv[2] || '5');

  console.log(`\nV18 Benchmark: Testing ${count} new wallets`);
  console.log('='.repeat(60));

  // Load existing report
  const report = loadReport();
  const existingWallets = report.results.map(r => r.wallet);
  const batchNum = report.batches.length + 1;

  console.log(`Batch #${batchNum} - ${existingWallets.length} wallets already tested`);

  // Get random wallets
  console.log('\nFetching random wallets...');
  const wallets = await getRandomWallets(count, existingWallets);
  console.log(`Got ${wallets.length} new wallets to test`);

  // Launch browser
  console.log('\nLaunching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const newResults: BenchmarkResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    console.log(`\n[${i + 1}/${wallets.length}] Testing ${wallet.substring(0, 14)}...`);

    try {
      // Scrape UI
      console.log('  Scraping UI...');
      const ui = await scrapeWalletUI(page, wallet);
      console.log(`  UI: ${ui.username} | PnL: $${ui.pnl.toFixed(2)}`);

      if (ui.username === 'Anon') {
        console.log('  SKIPPING: Anon wallet');
        continue;
      }

      // Compute V18
      console.log('  Computing V18...');
      const v18 = await computeV18(wallet);
      console.log(`  V18: PnL: $${v18.realized_pnl.toFixed(2)}`);

      // Calculate accuracy - compare realized PnL
      const pnl_diff = v18.realized_pnl - ui.pnl;
      const pnl_error_pct = ui.pnl !== 0 ? (Math.abs(pnl_diff) / Math.abs(ui.pnl)) * 100 : 0;

      // Calculate total PnL accuracy (realized + unrealized) - better when open positions exist
      const total_pnl_diff = v18.total_pnl - ui.pnl;
      const total_pnl_error_pct = ui.pnl !== 0 ? (Math.abs(total_pnl_diff) / Math.abs(ui.pnl)) * 100 : 0;

      const volume_diff = v18.volume_traded - ui.volume;
      const volume_error_pct = ui.volume !== 0 ? (Math.abs(volume_diff) / Math.abs(ui.volume)) * 100 : 0;

      // Build notes
      const notes: string[] = [];
      if (ui.has_open_positions) {
        notes.push(`OPEN POSITIONS: $${ui.positions_value.toFixed(2)} value`);
        notes.push(`Unrealized PnL from V18: $${v18.unrealized_pnl.toFixed(2)}`);
        if (total_pnl_error_pct < pnl_error_pct) {
          notes.push('NOTE: Total PnL (realized+unrealized) is closer to UI');
        }
      }
      if (v18.unrealized_pnl !== 0) {
        notes.push(`V18 unrealized: $${v18.unrealized_pnl.toFixed(2)}`);
      }

      const result: BenchmarkResult = {
        wallet,
        batch: batchNum,
        ui,
        v18,
        pnl_diff,
        pnl_error_pct,
        total_pnl_diff,
        total_pnl_error_pct,
        volume_diff,
        volume_error_pct,
        accuracy: calculateAccuracy(ui.pnl, v18.realized_pnl),
        accuracy_total: calculateAccuracy(ui.pnl, v18.total_pnl),
        notes,
      };

      newResults.push(result);

      const status = result.accuracy.exact ? '✓ EXACT MATCH' :
                     result.accuracy.within_1_pct ? '✓ Within 1%' :
                     result.accuracy.within_5_pct ? '~ Within 5%' : '✗ Error > 5%';
      console.log(`  Result: ${status} (${pnl_error_pct.toFixed(1)}% error)`);
      if (ui.has_open_positions) {
        console.log(`  NOTE: Has open positions ($${ui.positions_value.toFixed(2)} value)`);
        console.log(`  Total PnL error: ${total_pnl_error_pct.toFixed(1)}%`);
      }

    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  await browser.close();

  // Update report
  report.results.push(...newResults);
  report.batches.push(batchNum);
  report.total_wallets = report.results.length;
  report.last_updated = new Date().toISOString();
  updateSummary(report);

  // Save and print
  saveReport(report);
  printReport(report);

  console.log(`\nReport saved to: ${REPORT_FILE}`);
}

main().catch(console.error);
