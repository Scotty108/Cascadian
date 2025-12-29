/**
 * Verify Top Copy-Trade Candidates Against Polymarket UI
 *
 * Reads the exported synthesis JSON, visits each wallet's profile,
 * scrapes the all-time P&L, and filters to only UI-positive wallets.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import { chromium, Page } from 'playwright';

interface Candidate {
  wallet: string;
  trades: number;
  markets: number;
  win_pct: number;
  wilson_pct: number;
  pf: number;
  asym: number;
  drawdown_pct: number;
  pnl_60d: number;
  pnl_30d: number;
  pnl_7d: number;
  tw_pnl_day: number;
  coverage_pct: number;
  losses: number;
  tier: string;
  copytrade_score: number;
}

interface ExportData {
  generated_at: string;
  methodology: string;
  scoring_formula: string;
  filters: Record<string, string>;
  candidates: Candidate[];
}

interface VerifiedCandidate extends Candidate {
  ui_all_time_pnl: number | null;
  ui_username: string | null;
  ui_status: 'PASS' | 'FAIL_NEGATIVE' | 'FAIL_PARSE' | 'FAIL_LOAD';
}

async function scrapeProfilePnL(page: Page): Promise<{ pnl: number | null; username: string | null }> {
  try {
    // Wait for page to load
    await page.waitForTimeout(2000);

    // Get username from page title or paragraph
    let username: string | null = null;
    try {
      const title = await page.title();
      const match = title.match(/@(\w+)/);
      if (match) username = match[1];
    } catch {
      // ignore
    }

    // The P&L is rendered as individual digit spans
    // Look for the "Profit/Loss" heading, then find the value nearby
    const snapshot = await page.accessibility.snapshot();
    if (!snapshot) return { pnl: null, username };

    // Find all text in the page and look for the P&L pattern
    const bodyText = await page.locator('body').innerText();

    // The pattern in the UI is like "$12,630.94" or "-$501.57"
    // It appears after "Profit/Loss" section
    const pnlMatch = bodyText.match(/Profit\/Loss[\s\S]*?(\$[\d,]+\.?\d*|\-\$[\d,]+\.?\d*)/);
    if (pnlMatch) {
      const pnlStr = pnlMatch[1].replace(/[$,]/g, '');
      const pnl = parseFloat(pnlStr);
      if (!isNaN(pnl)) return { pnl, username };
    }

    // Alternative: look for the specific structure
    // The digits are in separate elements like "1" "2" "," "6" "3" "0" "." "9" "4"
    const allText = bodyText;

    // Find "All-Time" and look before it for the number
    const allTimeIdx = allText.indexOf('All-Time');
    if (allTimeIdx > 0) {
      const beforeText = allText.slice(Math.max(0, allTimeIdx - 100), allTimeIdx);
      // Extract number pattern
      const numMatch = beforeText.match(/(-?\$?[\d,]+\.?\d*)/g);
      if (numMatch && numMatch.length > 0) {
        // Get the last number before "All-Time"
        const lastNum = numMatch[numMatch.length - 1];
        const cleaned = lastNum.replace(/[$,]/g, '');
        const pnl = parseFloat(cleaned);
        if (!isNaN(pnl) && Math.abs(pnl) < 10000000) {
          return { pnl, username };
        }
      }
    }

    return { pnl: null, username };
  } catch (error) {
    console.error('Error scraping:', error);
    return { pnl: null, username: null };
  }
}

async function main() {
  const inputPath = process.argv[2] || 'exports/copytrade/ultimate_synthesis_2025-12-18.json';
  const topN = parseInt(process.argv[3] || '20', 10);
  const minUiPnl = parseFloat(process.argv[4] || '0');

  console.log(`=== UI Verification for Top ${topN} Candidates ===\n`);
  console.log(`Input: ${inputPath}`);
  console.log(`Min UI P&L threshold: $${minUiPnl}\n`);

  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    console.log('Run ultimate-synthesis-copytrade.ts first to generate candidates.');
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const data: ExportData = JSON.parse(raw);
  const candidates = data.candidates.slice(0, topN);

  console.log(`Loaded ${candidates.length} candidates to verify\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  const results: VerifiedCandidate[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const url = `https://polymarket.com/profile/${c.wallet}`;
    console.log(`[${i + 1}/${candidates.length}] ${c.wallet.slice(0, 10)}...`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const { pnl, username } = await scrapeProfilePnL(page);

      let status: VerifiedCandidate['ui_status'];
      if (pnl === null) {
        status = 'FAIL_PARSE';
      } else if (pnl < minUiPnl) {
        status = 'FAIL_NEGATIVE';
      } else {
        status = 'PASS';
      }

      const pnlStr = pnl !== null ? `$${pnl.toLocaleString()}` : 'N/A';
      console.log(`   -> ${username || 'unknown'}: ${pnlStr} [${status}]`);

      results.push({
        ...c,
        ui_all_time_pnl: pnl,
        ui_username: username,
        ui_status: status,
      });
    } catch (error) {
      console.log(`   -> FAIL_LOAD`);
      results.push({
        ...c,
        ui_all_time_pnl: null,
        ui_username: null,
        ui_status: 'FAIL_LOAD',
      });
    }

    // Rate limit
    await page.waitForTimeout(1000);
  }

  await browser.close();

  // Filter to only PASS
  const passed = results.filter(r => r.ui_status === 'PASS');
  const failed = results.filter(r => r.ui_status !== 'PASS');

  console.log(`\n=== Results ===`);
  console.log(`PASS: ${passed.length}`);
  console.log(`FAIL_NEGATIVE: ${results.filter(r => r.ui_status === 'FAIL_NEGATIVE').length}`);
  console.log(`FAIL_PARSE: ${results.filter(r => r.ui_status === 'FAIL_PARSE').length}`);
  console.log(`FAIL_LOAD: ${results.filter(r => r.ui_status === 'FAIL_LOAD').length}`);

  // Export verified results
  const dateStr = new Date().toISOString().slice(0, 10);

  // Full results (all candidates with UI data)
  const fullJsonPath = `exports/copytrade/ultimate_synthesis_ui_all_${dateStr}.json`;
  fs.writeFileSync(fullJsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: inputPath,
    min_ui_pnl_threshold: minUiPnl,
    total_checked: results.length,
    passed: passed.length,
    results,
  }, null, 2));
  console.log(`\nWrote all results: ${fullJsonPath}`);

  // Verified-only export (PASS only)
  const verifiedJsonPath = `exports/copytrade/ultimate_synthesis_ui_verified_${dateStr}.json`;
  fs.writeFileSync(verifiedJsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: inputPath,
    min_ui_pnl_threshold: minUiPnl,
    methodology: data.methodology + ' + UI verified',
    filters: {
      ...data.filters,
      ui_all_time_pnl: `>= $${minUiPnl}`,
    },
    candidates: passed,
  }, null, 2));
  console.log(`Wrote verified only: ${verifiedJsonPath}`);

  // CSV export
  const csvPath = `exports/copytrade/ultimate_synthesis_ui_verified_${dateStr}.csv`;
  const header = 'rank,wallet,username,ui_pnl,pnl_60d,trades,win_pct,pf,asym,score,status';
  const rows = results.map((r, i) =>
    [
      i + 1,
      r.wallet,
      r.ui_username || '',
      r.ui_all_time_pnl ?? '',
      r.pnl_60d,
      r.trades,
      r.win_pct,
      r.pf,
      r.asym,
      r.copytrade_score,
      r.ui_status,
    ].join(',')
  );
  fs.writeFileSync(csvPath, [header, ...rows].join('\n'));
  console.log(`Wrote CSV: ${csvPath}`);

  // Summary table
  console.log('\n=== Top Verified Candidates ===\n');
  console.log('Rank | Wallet                                     | Username      | UI P&L      | 60d P&L   | Score');
  console.log('-----|--------------------------------------------| --------------|-------------|-----------|--------');
  for (let i = 0; i < Math.min(passed.length, 15); i++) {
    const r = passed[i];
    const uiPnl = r.ui_all_time_pnl !== null ? `$${r.ui_all_time_pnl.toLocaleString()}` : 'N/A';
    console.log(
      `${String(i + 1).padStart(4)} | ${r.wallet} | ${(r.ui_username || '').padEnd(13)} | ${uiPnl.padStart(11)} | ${('$' + r.pnl_60d.toLocaleString()).padStart(9)} | ${r.copytrade_score}`
    );
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
