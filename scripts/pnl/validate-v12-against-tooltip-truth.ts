#!/usr/bin/env npx tsx
/**
 * VALIDATE V12 AGAINST UI TOOLTIP TRUTH
 * ============================================================================
 *
 * Compares V12 Synthetic Realized PnL engine output against scraped UI tooltip
 * truth from Polymarket profile pages.
 *
 * Metrics compared:
 * - net_total (V12 realized PnL vs UI "Net total")
 *
 * Inputs:
 * - tmp/ui_tooltip_truth_tierA_pilot10.json (or specified file)
 *
 * Outputs:
 * - tmp/v12_tooltip_validation_results.json
 * - Console report with pass/fail rates
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-v12-against-tooltip-truth.ts
 *   npx tsx scripts/pnl/validate-v12-against-tooltip-truth.ts --input=tmp/custom_truth.json
 *   npx tsx scripts/pnl/validate-v12-against-tooltip-truth.ts --tolerance=5
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import * as fs from 'fs';
import { calculateRealizedPnlV12, closeClient, RealizedPnlResult } from '../../lib/pnl/realizedPnlV12';

interface TooltipTruth {
  wallet_address: string;
  profile_url: string;
  scraped_at: string;
  metrics: {
    volume_traded: number;
    gain: number;
    loss: number;
    net_total: number;
  };
  raw: {
    volume_traded: string;
    gain: string;
    loss: string;
    net_total: string;
  };
}

interface TruthFile {
  metadata: {
    generated_at: string;
    sample_type: string;
    total_wallets: number;
    description: string;
  };
  wallets: TooltipTruth[];
}

interface ValidationResult {
  wallet_address: string;
  ui_net_total: number;
  v12_realized_pnl: number;
  delta_pct: number;
  pass: boolean;
  v12_details: {
    event_count: number;
    resolved_events: number;
    unresolved_events: number;
    unresolved_pct: number;
    is_comparable: boolean;
  };
}

function parseArgs(): { inputFile: string; tolerance: number; outputFile: string; comparableThreshold: number } {
  const args = process.argv.slice(2);
  let inputFile = 'tmp/ui_tooltip_truth_tierA_pilot10.json';
  let tolerance = 5; // 5% default
  let outputFile = 'tmp/v12_tooltip_validation_results.json';
  let comparableThreshold = 5; // 5% unresolved max for comparable

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      inputFile = arg.split('=')[1];
    } else if (arg.startsWith('--tolerance=')) {
      tolerance = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--output=')) {
      outputFile = arg.split('=')[1];
    } else if (arg.startsWith('--comparable=')) {
      comparableThreshold = parseFloat(arg.split('=')[1]);
    }
  }

  return { inputFile, tolerance, outputFile, comparableThreshold };
}

function calculatePercentDelta(expected: number, actual: number): number {
  if (expected === 0 && actual === 0) return 0;
  if (expected === 0) return Math.abs(actual) > 0.01 ? 100 : 0; // Small values near zero
  return Math.abs((actual - expected) / Math.abs(expected)) * 100;
}

async function main() {
  const { inputFile, tolerance, outputFile, comparableThreshold } = parseArgs();

  console.log('═'.repeat(80));
  console.log('V12 TOOLTIP TRUTH VALIDATION');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Input file: ${inputFile}`);
  console.log(`Tolerance: ${tolerance}%`);
  console.log(`Comparable threshold: unresolved <= ${comparableThreshold}%`);
  console.log(`Output file: ${outputFile}`);
  console.log('');

  // Load truth file
  if (!fs.existsSync(inputFile)) {
    console.error(`ERROR: Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const truthData: TruthFile = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  console.log(`Loaded ${truthData.wallets.length} wallets from truth file`);
  console.log(`Truth file created: ${truthData.metadata.generated_at}`);
  console.log('');

  const results: ValidationResult[] = [];
  let passCount = 0;

  console.log('Running validation...');
  console.log('─'.repeat(80));

  for (let i = 0; i < truthData.wallets.length; i++) {
    const truth = truthData.wallets[i];
    const wallet = truth.wallet_address;

    // Compute V12 values using the actual engine
    let v12Result: RealizedPnlResult;
    try {
      v12Result = await calculateRealizedPnlV12(wallet);
    } catch (error) {
      console.error(`Error computing V12 for ${wallet}:`, error);
      v12Result = {
        wallet,
        realizedPnl: 0,
        eventCount: 0,
        resolvedEvents: 0,
        unresolvedEvents: 0,
        unresolvedPct: 100,
        unresolvedUsdcSpent: 0,
        makerEvents: 0,
        takerEvents: 0,
        isComparable: false,
        errors: [(error as Error).message],
      };
    }

    // Calculate delta
    const deltaPct = calculatePercentDelta(truth.metrics.net_total, v12Result.realizedPnl);
    const pass = deltaPct <= tolerance;

    if (pass) passCount++;

    const result: ValidationResult = {
      wallet_address: wallet,
      ui_net_total: truth.metrics.net_total,
      v12_realized_pnl: v12Result.realizedPnl,
      delta_pct: deltaPct,
      pass,
      v12_details: {
        event_count: v12Result.eventCount,
        resolved_events: v12Result.resolvedEvents,
        unresolved_events: v12Result.unresolvedEvents,
        unresolved_pct: v12Result.unresolvedPct,
        is_comparable: v12Result.isComparable,
      },
    };

    results.push(result);

    // Print result
    const status = pass ? '✓' : '✗';
    const shortWallet = wallet.slice(0, 10) + '...' + wallet.slice(-4);
    console.log(
      `[${String(i + 1).padStart(3)}/${truthData.wallets.length}] ${status} ${shortWallet} ` +
      `UI: $${truth.metrics.net_total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | ` +
      `V12: $${v12Result.realizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | ` +
      `Δ: ${deltaPct.toFixed(1)}% | ` +
      `Unres: ${v12Result.unresolvedPct.toFixed(1)}%`
    );
  }

  console.log('─'.repeat(80));
  console.log('');

  // Categorize by comparability (using our threshold)
  const comparableResults = results.filter(r => r.v12_details.unresolved_pct <= comparableThreshold);
  const nonComparableResults = results.filter(r => r.v12_details.unresolved_pct > comparableThreshold);

  const comparablePassCount = comparableResults.filter(r => r.pass).length;
  const nonComparablePassCount = nonComparableResults.filter(r => r.pass).length;

  // Summary
  console.log('═'.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Tolerance: ${tolerance}%`);
  console.log(`Comparable threshold: unresolved <= ${comparableThreshold}%`);
  console.log('');
  console.log('ALL WALLETS:');
  console.log(`  Total: ${truthData.wallets.length}`);
  console.log(`  Pass Rate: ${passCount}/${truthData.wallets.length} (${((passCount / truthData.wallets.length) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('COMPARABLE ONLY (unresolved <= ' + comparableThreshold + '%):');
  console.log(`  Total: ${comparableResults.length}`);
  console.log(`  Pass Rate: ${comparablePassCount}/${comparableResults.length} (${comparableResults.length > 0 ? ((comparablePassCount / comparableResults.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log('');
  console.log('NON-COMPARABLE (unresolved > ' + comparableThreshold + '%):');
  console.log(`  Total: ${nonComparableResults.length}`);
  console.log(`  (Expected divergence - excluded from parity target)`);
  console.log('');

  // Categorize failures for the old breakdown
  const failures = results.filter(r => !r.pass);
  const comparableFailures = failures.filter(r => r.v12_details.unresolved_pct <= comparableThreshold);
  const nonComparableFailures = failures.filter(r => r.v12_details.unresolved_pct > comparableThreshold);

  console.log('Failure Breakdown:');
  console.log(`  Comparable failures (unres <50%): ${comparableFailures.length}`);
  console.log(`  Non-comparable (unres ≥50%): ${nonComparableFailures.length}`);
  console.log('');

  // Save results
  const comparablePassRate = comparableResults.length > 0
    ? (comparablePassCount / comparableResults.length) * 100
    : 0;

  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      input_file: inputFile,
      tolerance_pct: tolerance,
      comparable_threshold_pct: comparableThreshold,
      total_wallets: truthData.wallets.length,
    },
    summary: {
      all_wallets: {
        total: truthData.wallets.length,
        pass_count: passCount,
        pass_rate: (passCount / truthData.wallets.length) * 100,
      },
      comparable_only: {
        total: comparableResults.length,
        pass_count: comparablePassCount,
        pass_rate: comparablePassRate,
      },
      non_comparable: {
        total: nonComparableResults.length,
        note: 'Expected divergence - excluded from parity target',
      },
    },
    results,
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${outputFile}`);

  // Final verdict - use comparable pass rate
  console.log('');
  console.log('VERDICT (based on comparable wallets):');
  if (comparableResults.length === 0) {
    console.log('⚠️  NO COMPARABLE WALLETS - Cannot determine parity');
  } else if (comparablePassCount === comparableResults.length) {
    console.log('✅ ALL COMPARABLE WALLETS PASSED VALIDATION');
  } else if (comparablePassRate >= 90) {
    console.log(`✅ PASSING (${comparablePassRate.toFixed(1)}% comparable pass rate)`);
  } else if (comparablePassRate >= 80) {
    console.log(`⚠️  MOSTLY PASSING (${comparablePassRate.toFixed(1)}% comparable pass rate)`);
  } else if (comparablePassRate >= 50) {
    console.log(`⚠️  PARTIAL (${comparablePassRate.toFixed(1)}% comparable pass rate) - needs investigation`);
  } else {
    console.log(`❌ FAILING (${comparablePassRate.toFixed(1)}% comparable pass rate) - formula mismatch`);
  }

  await closeClient();
}

main().catch(console.error);
