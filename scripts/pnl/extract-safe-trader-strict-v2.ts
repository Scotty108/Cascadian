/**
 * SAFE_TRADER_STRICT v2 Cohort Extractor
 *
 * Extracts a high-confidence subset of wallets for V29 engine regression testing.
 *
 * SAFE_TRADER_STRICT v2 Rule:
 * - isTraderStrict === true (taker-only style, no maker inventory)
 * - splitCount === 0 (no CTF splits)
 * - mergeCount === 0 (no CTF merges)
 * - inventoryMismatch === 0 (clean inventory tracking)
 * - missingResolutions === 0 (all markets properly resolved)
 * - Optional: |v29UiParityPctError| < 3% (low error vs UI)
 *
 * Input Sources (prioritized):
 * 1. tmp/safe_trader_strict_wallets_2025_12_06.json (pre-extracted)
 * 2. tmp/v29-vs-cash-results.json (V29 vs cash benchmark)
 * 3. tmp/v29-ui-parity-report.json (V29 vs UI parity)
 *
 * Output: tmp/safe_trader_strict_v2_wallets.json
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface SafeTraderV1Entry {
  wallet: string;
  uiPnL: number;
  v29UiParityPnL: number;
  v29RealizedPnL: number;
  v29ResolvedUnredeemed: number;
  v29UiParityError: number;
  v29UiParityPctError: number;
  v23cPnL: number;
  tags: {
    isTraderStrict: boolean;
    splitCount: number;
    mergeCount: number;
    clobCount: number;
    inventoryMismatch: number;
    missingResolutions: number;
  };
}

interface CashResultEntry {
  wallet: string;
  uiPnl: number;
  cashPnl: number;
  v29UiParity: number;
  v29Realized: number;
  v29ResolvedUnredeemed: number;
  deltaAbs: number;
  deltaPct: number;
  passes: boolean;
  cashFlowDetails: {
    cashPnl: number;
    totalInflows: number;
    totalOutflows: number;
    clobBuyCount: number;
    clobSellCount: number;
    redemptionCount: number;
    eventsProcessed: number;
  };
}

interface SafeTraderV2Entry {
  wallet: string;
  uiPnL: number;
  v29UiParityPnL: number;
  v29RealizedPnL: number;
  v29ResolvedUnredeemed: number;
  v29UiParityPctError: number;
  cashPnL: number | null;
  cashVsUiDeltaPct: number | null;
  tags: {
    isTraderStrict: boolean;
    splitCount: number;
    mergeCount: number;
    clobCount: number;
    inventoryMismatch: number;
    missingResolutions: number;
  };
  dataHealth: {
    hasCashData: boolean;
    cashVsV29Passes: boolean;
    uiVsV29Passes: boolean;
  };
}

interface SafeTraderV2Output {
  generatedAt: string;
  filterRule: string;
  summary: {
    totalSourceWallets: number;
    traderStrictCount: number;
    safeTraderStrictV2Count: number;
    medianUiError: number;
    meanUiError: number;
    p90UiError: number;
  };
  wallets: SafeTraderV2Entry[];
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  console.log('\n=== SAFE_TRADER_STRICT v2 EXTRACTOR ===\n');

  // Load source data
  const sourceV1Path = path.join(process.cwd(), 'tmp/safe_trader_strict_wallets_2025_12_06.json');
  const cashResultsPath = path.join(process.cwd(), 'tmp/v29-vs-cash-results.json');

  if (!fs.existsSync(sourceV1Path)) {
    console.error(`Source file not found: ${sourceV1Path}`);
    process.exit(1);
  }

  const v1Data: SafeTraderV1Entry[] = JSON.parse(fs.readFileSync(sourceV1Path, 'utf-8'));
  console.log(`Loaded ${v1Data.length} wallets from safe_trader_strict v1`);

  // Load cash results if available
  let cashResults: CashResultEntry[] = [];
  if (fs.existsSync(cashResultsPath)) {
    const cashData = JSON.parse(fs.readFileSync(cashResultsPath, 'utf-8'));
    cashResults = cashData.results || [];
    console.log(`Loaded ${cashResults.length} wallets from v29-vs-cash-results`);
  }

  // Build cash lookup map
  const cashMap = new Map<string, CashResultEntry>();
  for (const cr of cashResults) {
    cashMap.set(cr.wallet.toLowerCase(), cr);
  }

  // Apply SAFE_TRADER_STRICT v2 filter
  // The v1 data already passed: isTraderStrict, splitCount=0, mergeCount=0, inventoryMismatch=0, missingResolutions=0
  // v2 adds: optional error threshold filter
  const ERROR_THRESHOLD_PCT = 3.0; // 3% absolute error threshold

  const v2Wallets: SafeTraderV2Entry[] = [];

  for (const w of v1Data) {
    const cashData = cashMap.get(w.wallet.toLowerCase());

    const entry: SafeTraderV2Entry = {
      wallet: w.wallet,
      uiPnL: w.uiPnL,
      v29UiParityPnL: w.v29UiParityPnL,
      v29RealizedPnL: w.v29RealizedPnL,
      v29ResolvedUnredeemed: w.v29ResolvedUnredeemed,
      v29UiParityPctError: w.v29UiParityPctError,
      cashPnL: cashData?.cashPnl ?? null,
      cashVsUiDeltaPct: cashData ? cashData.deltaPct : null,
      tags: w.tags,
      dataHealth: {
        hasCashData: !!cashData,
        cashVsV29Passes: cashData?.passes ?? false,
        uiVsV29Passes: Math.abs(w.v29UiParityPctError) < ERROR_THRESHOLD_PCT,
      },
    };

    v2Wallets.push(entry);
  }

  // Separate into strict and lenient cohorts
  const strictCohort = v2Wallets.filter(w => w.dataHealth.uiVsV29Passes);
  const lenientCohort = v2Wallets; // All wallets that pass base filter

  // Compute statistics on the strict cohort
  const errors = strictCohort.map(w => Math.abs(w.v29UiParityPctError)).sort((a, b) => a - b);
  const medianError = errors.length > 0 ? errors[Math.floor(errors.length / 2)] : 0;
  const meanError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
  const p90Error = errors.length > 0 ? errors[Math.floor(errors.length * 0.9)] : 0;

  // Sort by absolute error (ascending = best first)
  strictCohort.sort((a, b) => Math.abs(a.v29UiParityPctError) - Math.abs(b.v29UiParityPctError));
  lenientCohort.sort((a, b) => Math.abs(a.v29UiParityPctError) - Math.abs(b.v29UiParityPctError));

  // Create output
  const output: SafeTraderV2Output = {
    generatedAt: new Date().toISOString(),
    filterRule: `isTraderStrict=true, splitCount=0, mergeCount=0, inventoryMismatch=0, missingResolutions=0, |uiError|<${ERROR_THRESHOLD_PCT}%`,
    summary: {
      totalSourceWallets: v1Data.length,
      traderStrictCount: v1Data.filter(w => w.tags.isTraderStrict).length,
      safeTraderStrictV2Count: strictCohort.length,
      medianUiError: medianError,
      meanUiError: meanError,
      p90UiError: p90Error,
    },
    wallets: strictCohort,
  };

  // Write output
  const outputPath = path.join(process.cwd(), 'tmp/safe_trader_strict_v2_wallets.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // Print summary
  console.log('\n--- SUMMARY ---\n');
  console.log(`Total source wallets (v1):        ${v1Data.length}`);
  console.log(`TRADER_STRICT wallets:            ${v1Data.filter(w => w.tags.isTraderStrict).length}`);
  console.log(`SAFE_TRADER_STRICT v2 (strict):   ${strictCohort.length}`);
  console.log(`SAFE_TRADER_STRICT v2 (lenient):  ${lenientCohort.length}`);
  console.log('');
  console.log(`Strict cohort error stats:`);
  console.log(`  Median error:                   ${medianError.toFixed(4)}%`);
  console.log(`  Mean error:                     ${meanError.toFixed(4)}%`);
  console.log(`  P90 error:                      ${p90Error.toFixed(4)}%`);

  // Print top 10 wallets table
  console.log('\n--- TOP 10 SAFE_TRADER_STRICT v2 WALLETS (sorted by lowest error) ---\n');
  console.log('Wallet                                      UI PnL      V29 UiParity   Error %');
  console.log('─'.repeat(85));

  for (const w of strictCohort.slice(0, 10)) {
    const uiFormatted = w.uiPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const v29Formatted = w.v29UiParityPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const errPct = w.v29UiParityPctError.toFixed(4);
    console.log(`${w.wallet}  ${uiFormatted.padStart(12)}  ${v29Formatted.padStart(14)}  ${errPct.padStart(8)}%`);
  }

  // Print error distribution
  console.log('\n--- ERROR DISTRIBUTION (strict cohort) ---\n');
  const buckets = {
    '0.0-0.1%': 0,
    '0.1-0.5%': 0,
    '0.5-1.0%': 0,
    '1.0-2.0%': 0,
    '2.0-3.0%': 0,
  };

  for (const w of strictCohort) {
    const err = Math.abs(w.v29UiParityPctError);
    if (err < 0.1) buckets['0.0-0.1%']++;
    else if (err < 0.5) buckets['0.1-0.5%']++;
    else if (err < 1.0) buckets['0.5-1.0%']++;
    else if (err < 2.0) buckets['1.0-2.0%']++;
    else buckets['2.0-3.0%']++;
  }

  for (const [bucket, count] of Object.entries(buckets)) {
    const pct = strictCohort.length > 0 ? ((count / strictCohort.length) * 100).toFixed(1) : '0.0';
    const bar = '█'.repeat(Math.ceil(count / strictCohort.length * 30));
    console.log(`  ${bucket.padEnd(10)} ${String(count).padStart(3)} wallets (${pct.padStart(5)}%) ${bar}`);
  }

  console.log(`\n✅ Written to: ${outputPath}\n`);
}

main();
