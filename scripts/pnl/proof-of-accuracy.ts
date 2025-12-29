/**
 * ============================================================================
 * PROOF OF ACCURACY: 100-Wallet V23c PnL Validation
 * ============================================================================
 *
 * THE DEFINITIVE TEST: 100 random wallets, strict filtering, UI comparison.
 *
 * METHODOLOGY:
 * 1. SELECT: 100 distinct recent wallets from pm_trader_events_v2
 * 2. FILTER: checkInventoryConsistency + isTraderStrict
 *    - Record: "Passed" or "Excluded (Reason)"
 * 3. GROUND TRUTH: Scrape UI PnL via Playwright for PASSED wallets only
 * 4. ENGINE: Run calculateV23cPnL (Native V23c, no bypass)
 * 5. REPORT: Output comprehensive table with accuracy metrics
 *
 * TARGET: 100% Accuracy for the "TRADER_STRICT" cohort.
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { chromium, Browser, Page } from 'playwright';
import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV23cPnL } from '../../lib/pnl/shadowLedgerV23c';
import {
  isTraderStrict,
  checkInventoryConsistency,
  InventoryConsistency,
} from '../../lib/pnl/walletClassifier';
import * as fs from 'fs';

// ============================================================================
// Configuration
// ============================================================================

const TOTAL_WALLETS = 100;
const SAVE_FILE = 'data/proof-of-accuracy-results.json';
const PER_WALLET_TIMEOUT = 60000;
const SCRAPE_TIMEOUT = 30000;

// ============================================================================
// Types
// ============================================================================

interface WalletResult {
  wallet: string;
  status: 'PASSED' | 'EXCLUDED';
  exclusion_reason?: string;

  // Filter checks
  is_trader_strict: boolean;
  is_inventory_consistent: boolean;
  inventory_mismatch: number;
  split_events: number;
  merge_events: number;
  transfer_in_value: number;

  // PnL values (only for PASSED wallets)
  ui_pnl?: number;
  v23c_pnl?: number;
  v23c_realized?: number;
  v23c_unrealized?: number;

  // Accuracy metrics
  delta?: number;
  error_pct?: number;
  within_5pct?: boolean;
  within_10pct?: boolean;
}

interface ProofReport {
  tested_at: string;
  engine: string;
  total_sampled: number;
  passed_filter: number;
  excluded_filter: number;
  scraped_successfully: number;
  valid_comparisons: number;
  within_5pct: number;
  within_10pct: number;
  accuracy_5pct: number;
  accuracy_10pct: number;
  exclusion_breakdown: Record<string, number>;
  results: WalletResult[];
}

// ============================================================================
// Step 1: Select 100 Random Recent Wallets
// ============================================================================

async function selectRandomWallets(count: number): Promise<string[]> {
  console.log(`\nStep 1: Selecting ${count} random recent wallets from pm_trader_events_v2...`);

  const query = `
    SELECT DISTINCT trader_wallet as wallet
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND trade_time >= now() - INTERVAL 30 DAY
    ORDER BY rand()
    LIMIT ${count}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as { wallet: string }[];
  const wallets = rows.map((r) => r.wallet.toLowerCase());

  console.log(`  Found ${wallets.length} wallets`);
  return wallets;
}

// ============================================================================
// Step 2: Filter with TRADER_STRICT Criteria
// ============================================================================

async function filterWallets(
  wallets: string[]
): Promise<{ passed: WalletResult[]; excluded: WalletResult[] }> {
  console.log(`\nStep 2: Filtering ${wallets.length} wallets with TRADER_STRICT criteria...`);

  const passed: WalletResult[] = [];
  const excluded: WalletResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    if ((i + 1) % 10 === 0) {
      console.log(`  Filtered ${i + 1}/${wallets.length}...`);
    }

    try {
      const strictCheck = await isTraderStrict(wallet);

      const result: WalletResult = {
        wallet,
        status: strictCheck.is_trader_strict ? 'PASSED' : 'EXCLUDED',
        exclusion_reason: strictCheck.is_trader_strict ? undefined : strictCheck.reasons.join('; '),
        is_trader_strict: strictCheck.is_trader_strict,
        is_inventory_consistent: strictCheck.inventory.is_consistent,
        inventory_mismatch: strictCheck.inventory.inventory_mismatch,
        split_events: strictCheck.activity.split_events,
        merge_events: strictCheck.activity.merge_events,
        transfer_in_value: strictCheck.transfers.transfer_in_value,
      };

      if (strictCheck.is_trader_strict) {
        passed.push(result);
      } else {
        excluded.push(result);
      }
    } catch (err: any) {
      excluded.push({
        wallet,
        status: 'EXCLUDED',
        exclusion_reason: `Error: ${err.message}`,
        is_trader_strict: false,
        is_inventory_consistent: false,
        inventory_mismatch: 0,
        split_events: 0,
        merge_events: 0,
        transfer_in_value: 0,
      });
    }
  }

  console.log(`  PASSED: ${passed.length}`);
  console.log(`  EXCLUDED: ${excluded.length}`);

  return { passed, excluded };
}

// ============================================================================
// Step 3: Scrape UI PnL via Playwright
// ============================================================================

async function scrapeUIPnL(page: Page, wallet: string): Promise<number | null> {
  const url = `https://polymarket.com/profile/${wallet}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: SCRAPE_TIMEOUT });
    await page.waitForTimeout(3000);

    // Click "ALL" timeframe if available
    try {
      await page.click('text=ALL');
      await page.waitForTimeout(1500);
    } catch {
      // May already be selected
    }

    // Extract PnL from page
    const pnlText = await page.evaluate(() => {
      // Look for "Profit" or "P&L" or similar
      const profitElements = Array.from(document.querySelectorAll('*')).filter((el) => {
        const text = el.textContent || '';
        return (
          (text.includes('Profit') || text.includes('P&L') || text.includes('PnL')) &&
          text.match(/[+-]?\$[\d,]+(?:\.\d+)?/)
        );
      });

      for (const el of profitElements) {
        const text = el.textContent || '';
        const match = text.match(/([+-])?\$([\d,]+(?:\.\d+)?)/);
        if (match) {
          const sign = match[1] === '-' ? -1 : 1;
          const value = parseFloat(match[2].replace(/,/g, ''));
          return sign * value;
        }
      }

      // Fallback: Look for any prominent dollar value near "Profit"
      const allText = document.body.innerText;
      const profitMatch = allText.match(/(?:Profit|P&L|PnL)[^\$]*([+-])?\$([\d,]+(?:\.\d+)?)/i);
      if (profitMatch) {
        const sign = profitMatch[1] === '-' ? -1 : 1;
        const value = parseFloat(profitMatch[2].replace(/,/g, ''));
        return sign * value;
      }

      return null;
    });

    return pnlText;
  } catch (err: any) {
    console.log(`    Scrape error for ${wallet.substring(0, 14)}...: ${err.message}`);
    return null;
  }
}

async function scrapeAllPassed(passed: WalletResult[]): Promise<void> {
  console.log(`\nStep 3: Scraping UI PnL for ${passed.length} PASSED wallets via Playwright...`);

  if (passed.length === 0) {
    console.log('  No wallets to scrape.');
    return;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    for (let i = 0; i < passed.length; i++) {
      const result = passed[i];
      console.log(`  [${i + 1}/${passed.length}] ${result.wallet.substring(0, 14)}...`);

      const uiPnl = await scrapeUIPnL(page, result.wallet);
      if (uiPnl !== null) {
        result.ui_pnl = uiPnl;
        console.log(`    UI PnL: $${uiPnl.toFixed(2)}`);
      } else {
        console.log(`    UI PnL: FAILED TO SCRAPE`);
      }

      // Rate limiting
      await page.waitForTimeout(2000);
    }
  } finally {
    await browser.close();
  }

  const scraped = passed.filter((r) => r.ui_pnl !== undefined).length;
  console.log(`  Scraped successfully: ${scraped}/${passed.length}`);
}

// ============================================================================
// Step 4: Calculate V23c PnL
// ============================================================================

async function calculateAllV23c(passed: WalletResult[]): Promise<void> {
  console.log(`\nStep 4: Calculating V23c PnL for ${passed.length} PASSED wallets...`);

  for (let i = 0; i < passed.length; i++) {
    const result = passed[i];
    console.log(`  [${i + 1}/${passed.length}] ${result.wallet.substring(0, 14)}...`);

    try {
      const v23c = await Promise.race([
        calculateV23cPnL(result.wallet, { useUIOracle: true }),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), PER_WALLET_TIMEOUT)
        ),
      ]);

      if (v23c) {
        result.v23c_pnl = v23c.totalPnl;
        result.v23c_realized = v23c.realizedPnl;
        result.v23c_unrealized = v23c.unrealizedPnl;
        console.log(`    V23c PnL: $${v23c.totalPnl.toFixed(2)}`);
      }
    } catch (err: any) {
      console.log(`    V23c error: ${err.message}`);
    }
  }

  const calculated = passed.filter((r) => r.v23c_pnl !== undefined).length;
  console.log(`  Calculated successfully: ${calculated}/${passed.length}`);
}

// ============================================================================
// Step 5: Generate Report
// ============================================================================

function generateReport(passed: WalletResult[], excluded: WalletResult[]): ProofReport {
  // Calculate accuracy metrics for wallets with both UI and V23c PnL
  const validComparisons = passed.filter(
    (r) => r.ui_pnl !== undefined && r.v23c_pnl !== undefined
  );

  let within5pct = 0;
  let within10pct = 0;

  for (const r of validComparisons) {
    const delta = r.v23c_pnl! - r.ui_pnl!;
    const reference = Math.max(Math.abs(r.v23c_pnl!), Math.abs(r.ui_pnl!), 1);
    const errorPct = (Math.abs(delta) / reference) * 100;

    r.delta = delta;
    r.error_pct = errorPct;
    r.within_5pct = errorPct <= 5;
    r.within_10pct = errorPct <= 10;

    if (errorPct <= 5) within5pct++;
    if (errorPct <= 10) within10pct++;
  }

  // Exclusion breakdown
  const exclusionBreakdown: Record<string, number> = {};
  for (const r of excluded) {
    const reason = r.exclusion_reason || 'Unknown';
    // Simplify reasons
    let category = 'Other';
    if (reason.includes('Inventory mismatch')) category = 'Inventory Mismatch';
    else if (reason.includes('PositionSplit')) category = 'Has Splits';
    else if (reason.includes('PositionsMerge')) category = 'Has Merges';
    else if (reason.includes('Transfer-heavy')) category = 'Transfer Heavy';
    else if (reason.includes('Error')) category = 'Error';

    exclusionBreakdown[category] = (exclusionBreakdown[category] || 0) + 1;
  }

  const accuracy5pct = validComparisons.length > 0 ? (within5pct / validComparisons.length) * 100 : 0;
  const accuracy10pct = validComparisons.length > 0 ? (within10pct / validComparisons.length) * 100 : 0;

  return {
    tested_at: new Date().toISOString(),
    engine: 'V23c (UI Oracle)',
    total_sampled: passed.length + excluded.length,
    passed_filter: passed.length,
    excluded_filter: excluded.length,
    scraped_successfully: passed.filter((r) => r.ui_pnl !== undefined).length,
    valid_comparisons: validComparisons.length,
    within_5pct: within5pct,
    within_10pct: within10pct,
    accuracy_5pct: accuracy5pct,
    accuracy_10pct: accuracy10pct,
    exclusion_breakdown: exclusionBreakdown,
    results: [...passed, ...excluded],
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    PROOF OF ACCURACY: 100-Wallet V23c PnL Validation                                  ║');
  console.log('║  The Definitive Test: Random wallets, strict filtering, UI comparison                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Target: ${TOTAL_WALLETS} wallets`);
  console.log('');

  // Step 1: Select random wallets
  const wallets = await selectRandomWallets(TOTAL_WALLETS);

  // Step 2: Filter with TRADER_STRICT
  const { passed, excluded } = await filterWallets(wallets);

  // Step 3: Scrape UI PnL for PASSED wallets
  await scrapeAllPassed(passed);

  // Step 4: Calculate V23c PnL
  await calculateAllV23c(passed);

  // Step 5: Generate report
  const report = generateReport(passed, excluded);

  // Save results
  fs.writeFileSync(SAVE_FILE, JSON.stringify(report, null, 2));
  console.log(`\nResults saved to: ${SAVE_FILE}`);

  // Print final report
  console.log('');
  console.log('═'.repeat(100));
  console.log('PROOF OF ACCURACY REPORT');
  console.log('═'.repeat(100));
  console.log('');

  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log(`║  SAMPLE SIZE:           ${report.total_sampled.toString().padStart(5)} wallets                                                     ║`);
  console.log(`║  PASSED FILTER:         ${report.passed_filter.toString().padStart(5)} wallets (TRADER_STRICT)                                     ║`);
  console.log(`║  EXCLUDED:              ${report.excluded_filter.toString().padStart(5)} wallets                                                     ║`);
  console.log(`║  SCRAPED SUCCESSFULLY:  ${report.scraped_successfully.toString().padStart(5)} wallets                                                     ║`);
  console.log(`║  VALID COMPARISONS:     ${report.valid_comparisons.toString().padStart(5)} wallets                                                     ║`);
  console.log('╠════════════════════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  ACCURACY (within 5%):  ${report.accuracy_5pct.toFixed(1).padStart(5)}% (${report.within_5pct}/${report.valid_comparisons})                                                  ║`);
  console.log(`║  ACCURACY (within 10%): ${report.accuracy_10pct.toFixed(1).padStart(5)}% (${report.within_10pct}/${report.valid_comparisons})                                                  ║`);
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Exclusion breakdown
  console.log('EXCLUSION BREAKDOWN:');
  for (const [reason, count] of Object.entries(report.exclusion_breakdown)) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log('');

  // Detailed results table for PASSED wallets with valid comparisons
  const validResults = passed.filter((r) => r.ui_pnl !== undefined && r.v23c_pnl !== undefined);

  if (validResults.length > 0) {
    console.log('PASSED WALLETS - ACCURACY BREAKDOWN:');
    console.log('-'.repeat(105));
    console.log('| Wallet                     | UI PnL       | V23c PnL     | Delta        | Error %  | Status |');
    console.log('-'.repeat(105));

    for (const r of validResults) {
      const walletShort = r.wallet.substring(0, 24) + '...';
      const uiPnl = `$${r.ui_pnl!.toFixed(2).padStart(10)}`;
      const v23cPnl = `$${r.v23c_pnl!.toFixed(2).padStart(10)}`;
      const delta = `$${r.delta!.toFixed(2).padStart(10)}`;
      const errorPct = `${r.error_pct!.toFixed(1).padStart(6)}%`;
      const status = r.within_5pct ? '✓ PASS' : r.within_10pct ? '~ CLOSE' : '✗ FAIL';

      console.log(`| ${walletShort} | ${uiPnl} | ${v23cPnl} | ${delta} | ${errorPct} | ${status} |`);
    }
    console.log('-'.repeat(105));
  }

  console.log('');
  console.log('═'.repeat(100));

  // Verdict
  if (report.accuracy_5pct === 100 && report.valid_comparisons > 0) {
    console.log('🎯 PERFECT: V23c achieves 100% accuracy for TRADER_STRICT wallets!');
  } else if (report.accuracy_5pct >= 90) {
    console.log('🎉 EXCELLENT: V23c achieves ≥90% accuracy for TRADER_STRICT wallets.');
  } else if (report.accuracy_5pct >= 80) {
    console.log('✓ GOOD: V23c achieves ≥80% accuracy for TRADER_STRICT wallets.');
  } else if (report.accuracy_10pct >= 80) {
    console.log('⚠️ MODERATE: V23c achieves ≥80% within 10% tolerance.');
  } else {
    console.log('❌ NEEDS INVESTIGATION: Accuracy below target threshold.');
  }

  console.log('');
  console.log('═'.repeat(100));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(100));
}

main().catch(console.error);
