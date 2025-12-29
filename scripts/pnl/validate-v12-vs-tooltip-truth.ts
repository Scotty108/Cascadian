#!/usr/bin/env npx tsx
/**
 * V12 vs Tooltip Truth Validator
 *
 * CANONICAL validation script for V12 Synthetic realized PnL accuracy.
 * Compares V12 Synthetic against Playwright tooltip-verified PnL values.
 *
 * V12 Synthetic is the CANONICAL Dome-parity metric per CTF-active benchmark findings.
 * (See docs/reports/V12_CTF_ACTIVE_BENCHMARK_2025_12_09.md)
 *
 * Input: tmp/playwright_tooltip_ground_truth.json or custom --input path
 * Output: tmp/v12_vs_tooltip_truth.json
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-v12-vs-tooltip-truth.ts
 *   npx tsx scripts/pnl/validate-v12-vs-tooltip-truth.ts --tolerance=0.05
 *   npx tsx scripts/pnl/validate-v12-vs-tooltip-truth.ts --input=tmp/ctf_tooltip_truth.json
 *
 * Terminal: Claude 1
 * Date: 2025-12-09
 */

import {
  calculateRealizedPnlV12,
  closeClient as closeV12Client,
} from '../../lib/pnl/realizedPnlV12';
import {
  calculateRealizedPnlV12CashFull,
  calculateRealizedPnlV12DomeCash,
  closeClient as closeCashClient,
} from '../../lib/pnl/realizedPnlV12Cash';
import fs from 'fs';

// ============================================================================
// Types
// ============================================================================

interface TooltipWallet {
  wallet: string;
  uiPnl: number;
  gain: number | null;
  loss: number | null;
  volume: number | null;
  scrapedAt: string;
  identityCheckPass: boolean;
  label?: string;
  bin?: string;
  notes: string;
}

interface TooltipTruthInput {
  metadata: {
    generated_at: string;
    source: string;
    wallet_count: number;
    schema_version?: string;
  };
  wallets: TooltipWallet[];
}

interface ValidationResult {
  wallet: string;
  // UI Truth
  uiPnl: number;
  uiGain: number | null;
  uiLoss: number | null;
  // V12 Synthetic (canonical)
  v12Synthetic: number;
  v12SyntheticError: number | null;
  v12SyntheticPass: boolean;
  // V12 CashFull (comparison)
  v12CashFull: number;
  v12CashFullError: number | null;
  v12CashFullPass: boolean;
  // V12 DomeCash (deprecated but included for completeness)
  v12DomeCash: number;
  v12DomeCashError: number | null;
  v12DomeCashPass: boolean;
  // Metadata
  resolvedEvents: number;
  unresolvedEvents: number;
  unresolvedPct: number;
  label: string;
  notes: string;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TOLERANCE = 0.10; // 10% tolerance
const DEFAULT_INPUT = 'tmp/playwright_tooltip_ground_truth.json';
const OUTPUT_PATH = 'tmp/v12_vs_tooltip_truth.json';
const MIN_PNL_THRESHOLD = 100; // Skip wallets with |PnL| < $100
const COMPARABLE_UNRESOLVED_MAX = 5; // Wallets with >5% unresolved are "non-comparable" for tooltip parity

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Parse args
  let tolerance = DEFAULT_TOLERANCE;
  let inputPath = DEFAULT_INPUT;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--tolerance=')) {
      tolerance = parseFloat(arg.split('=')[1]);
    }
    if (arg.startsWith('--input=')) {
      inputPath = arg.split('=')[1];
    }
  }

  console.log('='.repeat(100));
  console.log('V12 SYNTHETIC vs TOOLTIP TRUTH VALIDATION');
  console.log('='.repeat(100));
  console.log(`Input:     ${inputPath}`);
  console.log(`Output:    ${OUTPUT_PATH}`);
  console.log(`Tolerance: ${(tolerance * 100).toFixed(1)}%`);
  console.log(`Min PnL:   $${MIN_PNL_THRESHOLD}`);
  console.log();
  console.log('NOTE: V12 Synthetic is the CANONICAL Dome-parity metric.');
  console.log('      CashFull and DomeCash included for comparison only.');
  console.log();

  // Load ground truth
  if (!fs.existsSync(inputPath)) {
    console.error(`Ground truth not found: ${inputPath}`);
    console.log('Run Playwright tooltip scraper to create ground truth first:');
    console.log('  npx tsx scripts/pnl/scrape-tooltip-truth-v2.ts');
    process.exit(1);
  }

  const groundTruth: TooltipTruthInput = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const wallets = groundTruth.wallets;

  console.log(`Loaded ${wallets.length} tooltip-verified wallets\n`);

  // Run validation
  const results: ValidationResult[] = [];
  let processed = 0;

  console.log('Wallet           | UI PnL       | V12 Synth    | Err %   | CashFull     | DomeCash     | Result');
  console.log('-'.repeat(100));

  for (const w of wallets) {
    processed++;

    try {
      // Calculate all V12 metrics
      const v12Synthetic = await calculateRealizedPnlV12(w.wallet, { makerOnly: true });
      const v12CashFull = await calculateRealizedPnlV12CashFull(w.wallet);
      const v12DomeCash = await calculateRealizedPnlV12DomeCash(w.wallet);

      // Calculate errors (skip if uiPnl too small)
      let syntheticError: number | null = null;
      let cashFullError: number | null = null;
      let domeCashError: number | null = null;
      let syntheticPass = true;
      let cashFullPass = true;
      let domeCashPass = true;

      if (Math.abs(w.uiPnl) >= MIN_PNL_THRESHOLD) {
        syntheticError = (v12Synthetic.realizedPnl - w.uiPnl) / Math.abs(w.uiPnl);
        cashFullError = (v12CashFull.cashFull - w.uiPnl) / Math.abs(w.uiPnl);
        domeCashError = (v12DomeCash.domeCash - w.uiPnl) / Math.abs(w.uiPnl);

        syntheticPass = Math.abs(syntheticError) <= tolerance;
        cashFullPass = Math.abs(cashFullError) <= tolerance;
        domeCashPass = Math.abs(domeCashError) <= tolerance;
      }

      const result: ValidationResult = {
        wallet: w.wallet,
        uiPnl: w.uiPnl,
        uiGain: w.gain,
        uiLoss: w.loss,
        v12Synthetic: v12Synthetic.realizedPnl,
        v12SyntheticError: syntheticError,
        v12SyntheticPass: syntheticPass,
        v12CashFull: v12CashFull.cashFull,
        v12CashFullError: cashFullError,
        v12CashFullPass: cashFullPass,
        v12DomeCash: v12DomeCash.domeCash,
        v12DomeCashError: domeCashError,
        v12DomeCashPass: domeCashPass,
        resolvedEvents: v12Synthetic.resolvedEvents,
        unresolvedEvents: v12Synthetic.unresolvedEvents,
        unresolvedPct: v12Synthetic.unresolvedPct,
        label: w.label || 'unknown',
        notes: w.notes,
      };

      results.push(result);

      // Print row
      const errStr = syntheticError !== null ? `${(syntheticError * 100).toFixed(1)}%` : 'N/A';
      const passStr = syntheticPass ? (syntheticError !== null && Math.abs(syntheticError) < 0.05 ? '~ Synt' : 'PASS') : 'FAIL';
      console.log(
        `${w.wallet.slice(0, 16)} | $${w.uiPnl.toLocaleString().padStart(10)} | $${v12Synthetic.realizedPnl.toLocaleString().padStart(10)} | ${errStr.padStart(7)} | $${v12CashFull.cashFull.toLocaleString().padStart(10)} | $${v12DomeCash.domeCash.toLocaleString().padStart(10)} | ${passStr}`
      );
    } catch (err: any) {
      console.log(`${w.wallet.slice(0, 16)} | ERROR: ${err.message}`);
      results.push({
        wallet: w.wallet,
        uiPnl: w.uiPnl,
        uiGain: w.gain,
        uiLoss: w.loss,
        v12Synthetic: 0,
        v12SyntheticError: null,
        v12SyntheticPass: false,
        v12CashFull: 0,
        v12CashFullError: null,
        v12CashFullPass: false,
        v12DomeCash: 0,
        v12DomeCashError: null,
        v12DomeCashPass: false,
        resolvedEvents: 0,
        unresolvedEvents: 0,
        unresolvedPct: 0,
        label: w.label || 'unknown',
        notes: `ERROR: ${err.message}`,
      });
    }
  }

  // Close connections
  await closeV12Client();
  await closeCashClient();

  console.log('\n');

  // Calculate summary statistics
  const validResults = results.filter(r => r.v12SyntheticError !== null);
  const syntheticPasses = validResults.filter(r => r.v12SyntheticPass);
  const cashFullPasses = validResults.filter(r => r.v12CashFullPass);
  const domeCashPasses = validResults.filter(r => r.v12DomeCashPass);

  // COMPARABLE-ONLY: wallets with unresolved <= 5%
  const comparableResults = validResults.filter(r => r.unresolvedPct <= COMPARABLE_UNRESOLVED_MAX);
  const comparableSyntheticPasses = comparableResults.filter(r => r.v12SyntheticPass);
  const nonComparableResults = validResults.filter(r => r.unresolvedPct > COMPARABLE_UNRESOLVED_MAX);

  // By label
  const byLabel: Record<string, { total: number; passes: number }> = {};
  for (const r of validResults) {
    const label = r.label || 'unknown';
    if (!byLabel[label]) byLabel[label] = { total: 0, passes: 0 };
    byLabel[label].total++;
    if (r.v12SyntheticPass) byLabel[label].passes++;
  }

  // Print summary
  console.log('='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log(`Total wallets: ${results.length}`);
  console.log(`Valid for comparison (|PnL| >= $${MIN_PNL_THRESHOLD}): ${validResults.length}`);
  console.log();

  console.log('--- PASS RATES (V12 Synthetic is CANONICAL) ---');
  console.log(`V12 Synthetic (ALL):        ${syntheticPasses.length}/${validResults.length} (${(syntheticPasses.length / validResults.length * 100).toFixed(1)}%)`);
  console.log(`V12 CashFull:               ${cashFullPasses.length}/${validResults.length} (${(cashFullPasses.length / validResults.length * 100).toFixed(1)}%) [comparison only]`);
  console.log(`V12 DomeCash:               ${domeCashPasses.length}/${validResults.length} (${(domeCashPasses.length / validResults.length * 100).toFixed(1)}%) [deprecated]`);
  console.log();

  console.log(`--- COMPARABLE-ONLY (unresolved <= ${COMPARABLE_UNRESOLVED_MAX}%) ---`);
  console.log(`Comparable wallets:         ${comparableResults.length}/${validResults.length}`);
  console.log(`Non-comparable (>5% unres): ${nonComparableResults.length}/${validResults.length}`);
  const comparablePassRate = comparableResults.length > 0 ? (comparableSyntheticPasses.length / comparableResults.length * 100).toFixed(1) : 'N/A';
  console.log(`V12 Synthetic (COMPARABLE): ${comparableSyntheticPasses.length}/${comparableResults.length} (${comparablePassRate}%)`);
  console.log();

  console.log('--- BY LABEL (V12 Synthetic) ---');
  for (const [label, stats] of Object.entries(byLabel)) {
    const pct = stats.total > 0 ? (stats.passes / stats.total * 100).toFixed(1) : '0';
    console.log(`${label.padEnd(12)}: ${stats.passes}/${stats.total} (${pct}%)`);
  }
  console.log();

  // Average error for passes
  const passErrors = syntheticPasses.map(r => Math.abs(r.v12SyntheticError || 0));
  const avgError = passErrors.length > 0 ? passErrors.reduce((a, b) => a + b, 0) / passErrors.length : 0;
  const medianError = passErrors.length > 0 ? passErrors.sort((a, b) => a - b)[Math.floor(passErrors.length / 2)] : 0;

  console.log('--- ERROR STATS (V12 Synthetic passing) ---');
  console.log(`Average error: ${(avgError * 100).toFixed(2)}%`);
  console.log(`Median error:  ${(medianError * 100).toFixed(2)}%`);
  console.log();

  // Show failures
  const failures = validResults.filter(r => !r.v12SyntheticPass);
  if (failures.length > 0) {
    console.log('--- V12 SYNTHETIC FAILURES ---');
    for (const r of failures.sort((a, b) => Math.abs(b.v12SyntheticError || 0) - Math.abs(a.v12SyntheticError || 0))) {
      const errStr = r.v12SyntheticError !== null ? `${(r.v12SyntheticError * 100).toFixed(1)}%` : 'N/A';
      console.log(`${r.wallet.slice(0, 12)}... | UI: $${r.uiPnl.toLocaleString()} | V12: $${r.v12Synthetic.toLocaleString()} | Error: ${errStr} | Unresolved: ${r.unresolvedPct.toFixed(1)}%`);
    }
    console.log();
  }

  // Save results
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      input_file: inputPath,
      tolerance_pct: tolerance,
      min_pnl_threshold: MIN_PNL_THRESHOLD,
      wallet_count: results.length,
      valid_count: validResults.length,
      schema_version: '1.0',
    },
    summary: {
      v12_synthetic: {
        passes: syntheticPasses.length,
        total: validResults.length,
        pass_rate: validResults.length > 0 ? syntheticPasses.length / validResults.length : 0,
        avg_error_pct: avgError,
        median_error_pct: medianError,
        note: 'CANONICAL metric for Dome/UI parity',
      },
      v12_cash_full: {
        passes: cashFullPasses.length,
        total: validResults.length,
        pass_rate: validResults.length > 0 ? cashFullPasses.length / validResults.length : 0,
        note: 'Internal analytics only - not for UI parity',
      },
      v12_dome_cash: {
        passes: domeCashPasses.length,
        total: validResults.length,
        pass_rate: validResults.length > 0 ? domeCashPasses.length / validResults.length : 0,
        note: 'DEPRECATED - fails badly for CTF-active wallets',
      },
      by_label: byLabel,
      comparable_only: {
        threshold_pct: COMPARABLE_UNRESOLVED_MAX,
        comparable_count: comparableResults.length,
        non_comparable_count: nonComparableResults.length,
        passes: comparableSyntheticPasses.length,
        total: comparableResults.length,
        pass_rate: comparableResults.length > 0 ? comparableSyntheticPasses.length / comparableResults.length : 0,
        note: `Only wallets with unresolved <= ${COMPARABLE_UNRESOLVED_MAX}% are meaningful for tooltip parity`,
      },
    },
    results,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Saved to: ${OUTPUT_PATH}`);
}

main().catch(console.error);
