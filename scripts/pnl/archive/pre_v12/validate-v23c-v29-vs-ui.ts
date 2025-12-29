#!/usr/bin/env npx tsx
/**
 * Comprehensive Validation: V23c vs V29 vs UI
 *
 * This script validates both engines against Polymarket UI values.
 *
 * Key Questions Answered:
 * 1. Does V23c match UI? (Expected: ~75% pass rate)
 * 2. Does V29 match UI? (Expected: low pass rate due to unrealized pricing)
 * 3. How do V23c and V29 differ for the same wallets?
 * 4. Which wallets pass BOTH engines?
 *
 * The results inform our leaderboard strategy:
 * - If V23c matches UI → our data is correct
 * - V29's divergence is INTENTIONAL (we want resolved = realized)
 */

import { calculateV23cPnL, V23cResult } from '../../lib/pnl/shadowLedgerV23c';
import { calculateV29PnL, V29Result } from '../../lib/pnl/inventoryEngineV29';
import fs from 'fs';

interface ValidationResult {
  wallet: string;
  uiPnl: number | null;
  v23c: {
    totalPnl: number;
    unresolvedConditions: number;
    uiOracleUsed: boolean;
    error?: string;
  } | null;
  v29: {
    realizedPnl: number;
    unrealizedPnl: number;
    resolvedUnredeemedValue: number;
    uiParityPnl: number;
    totalPnl: number;
    error?: string;
  } | null;
  comparison: {
    v23c_vs_ui_error: number | null;
    v23c_vs_ui_error_pct: number | null;
    v23c_passes: boolean;
    v29_vs_ui_error: number | null;
    v29_vs_ui_error_pct: number | null;
    v29_passes: boolean;
    v23c_vs_v29_diff: number | null;
  };
}

const TOLERANCE_PCT = 0.06; // 6% tolerance

function calculateErrorPct(calculated: number, ui: number): number | null {
  if (Math.abs(ui) < 100) return null; // Skip small PnL values
  return (calculated - ui) / Math.abs(ui);
}

function passes(errorPct: number | null): boolean {
  if (errorPct === null) return true; // Skip small values
  return Math.abs(errorPct) < TOLERANCE_PCT;
}

async function validateWallet(wallet: string, uiPnl: number | null): Promise<ValidationResult> {
  let v23c: ValidationResult['v23c'] = null;
  let v29: ValidationResult['v29'] = null;

  // Calculate V23c
  try {
    const v23cResult = await calculateV23cPnL(wallet, { useUIOracle: true });
    v23c = {
      totalPnl: v23cResult.totalPnl,
      unresolvedConditions: v23cResult.unresolvedConditions,
      uiOracleUsed: v23cResult.uiOracleUsed,
    };
  } catch (err: any) {
    v23c = {
      totalPnl: 0,
      unresolvedConditions: 0,
      uiOracleUsed: false,
      error: err.message,
    };
  }

  // Calculate V29
  try {
    const v29Result = await calculateV29PnL(wallet, { inventoryGuard: true });
    v29 = {
      realizedPnl: v29Result.realizedPnl,
      unrealizedPnl: v29Result.unrealizedPnl,
      resolvedUnredeemedValue: v29Result.resolvedUnredeemedValue,
      uiParityPnl: v29Result.uiParityPnl,
      totalPnl: v29Result.totalPnl,
    };
  } catch (err: any) {
    v29 = {
      realizedPnl: 0,
      unrealizedPnl: 0,
      resolvedUnredeemedValue: 0,
      uiParityPnl: 0,
      totalPnl: 0,
      error: err.message,
    };
  }

  // Compare
  const v23c_vs_ui_error_pct = uiPnl !== null && v23c
    ? calculateErrorPct(v23c.totalPnl, uiPnl)
    : null;
  const v29_vs_ui_error_pct = uiPnl !== null && v29
    ? calculateErrorPct(v29.uiParityPnl, uiPnl)
    : null;

  return {
    wallet,
    uiPnl,
    v23c,
    v29,
    comparison: {
      v23c_vs_ui_error: uiPnl !== null && v23c ? v23c.totalPnl - uiPnl : null,
      v23c_vs_ui_error_pct,
      v23c_passes: passes(v23c_vs_ui_error_pct),
      v29_vs_ui_error: uiPnl !== null && v29 ? v29.uiParityPnl - uiPnl : null,
      v29_vs_ui_error_pct,
      v29_passes: passes(v29_vs_ui_error_pct),
      v23c_vs_v29_diff: v23c && v29 ? v23c.totalPnl - v29.uiParityPnl : null,
    },
  };
}

async function main() {
  const inputPath = process.argv[2] || 'tmp/clob_only_validation_set.json';
  const outputPath = process.argv[3] || 'tmp/v23c_v29_ui_validation.json';
  const limitArg = parseInt(process.argv[4]) || 50;

  console.log('='.repeat(80));
  console.log('V23c vs V29 vs UI VALIDATION');
  console.log('='.repeat(80));
  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Limit: ${limitArg} wallets`);
  console.log(`Tolerance: ${TOLERANCE_PCT * 100}%`);
  console.log();

  // Load input
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    console.log('Run: npx tsx scripts/pnl/build-clob-only-validation-set.ts first');
    process.exit(1);
  }

  const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const wallets = (input.wallets || []).slice(0, limitArg);

  console.log(`Processing ${wallets.length} wallets...\n`);

  const results: ValidationResult[] = [];
  let processed = 0;

  for (const w of wallets) {
    processed++;
    process.stdout.write(`\r[${processed}/${wallets.length}] ${w.wallet.slice(0, 12)}...`);

    try {
      const result = await validateWallet(w.wallet, w.uiPnl);
      results.push(result);
    } catch (err: any) {
      console.log(`\nError processing ${w.wallet}: ${err.message}`);
    }
  }

  console.log('\n');

  // Calculate summary statistics
  const withUI = results.filter(r => r.uiPnl !== null && Math.abs(r.uiPnl) >= 100);
  const v23cPasses = withUI.filter(r => r.comparison.v23c_passes);
  const v29Passes = withUI.filter(r => r.comparison.v29_passes);
  const bothPass = withUI.filter(r => r.comparison.v23c_passes && r.comparison.v29_passes);

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets processed: ${results.length}`);
  console.log(`Wallets with UI > $100: ${withUI.length}`);
  console.log();
  console.log('V23c (Shadow Ledger with UI Oracle):');
  console.log(`  Pass rate: ${v23cPasses.length}/${withUI.length} (${(v23cPasses.length / withUI.length * 100).toFixed(1)}%)`);
  console.log();
  console.log('V29 (Inventory Engine):');
  console.log(`  Pass rate: ${v29Passes.length}/${withUI.length} (${(v29Passes.length / withUI.length * 100).toFixed(1)}%)`);
  console.log();
  console.log('Both engines pass:');
  console.log(`  Count: ${bothPass.length}/${withUI.length} (${(bothPass.length / withUI.length * 100).toFixed(1)}%)`);

  // Show top failures
  console.log('\n--- TOP 5 V23c FAILURES ---');
  const v23cFailures = withUI.filter(r => !r.comparison.v23c_passes)
    .sort((a, b) => Math.abs(b.comparison.v23c_vs_ui_error_pct || 0) - Math.abs(a.comparison.v23c_vs_ui_error_pct || 0));

  for (const r of v23cFailures.slice(0, 5)) {
    console.log(`${r.wallet.slice(0, 12)}... | UI: $${r.uiPnl?.toLocaleString()} | V23c: $${r.v23c?.totalPnl.toLocaleString()} | Error: ${((r.comparison.v23c_vs_ui_error_pct || 0) * 100).toFixed(1)}%`);
  }

  console.log('\n--- TOP 5 V29 FAILURES ---');
  const v29Failures = withUI.filter(r => !r.comparison.v29_passes)
    .sort((a, b) => Math.abs(b.comparison.v29_vs_ui_error_pct || 0) - Math.abs(a.comparison.v29_vs_ui_error_pct || 0));

  for (const r of v29Failures.slice(0, 5)) {
    console.log(`${r.wallet.slice(0, 12)}... | UI: $${r.uiPnl?.toLocaleString()} | V29: $${r.v29?.uiParityPnl.toLocaleString()} | Error: ${((r.comparison.v29_vs_ui_error_pct || 0) * 100).toFixed(1)}%`);
  }

  // Show V23c vs V29 comparison
  console.log('\n--- V23c vs V29 COMPARISON (sample) ---');
  for (const r of results.slice(0, 10)) {
    const v23cVal = r.v23c?.totalPnl || 0;
    const v29Val = r.v29?.uiParityPnl || 0;
    const diff = v23cVal - v29Val;
    console.log(`${r.wallet.slice(0, 12)}... | V23c: $${v23cVal.toFixed(0)} | V29: $${v29Val.toFixed(0)} | Diff: $${diff.toFixed(0)}`);
  }

  // Save results
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      tolerance_pct: TOLERANCE_PCT,
      total_wallets: results.length,
      with_ui_above_100: withUI.length,
    },
    summary: {
      v23c_pass_rate: withUI.length > 0 ? v23cPasses.length / withUI.length : 0,
      v29_pass_rate: withUI.length > 0 ? v29Passes.length / withUI.length : 0,
      both_pass_rate: withUI.length > 0 ? bothPass.length / withUI.length : 0,
      v23c_passes: v23cPasses.length,
      v29_passes: v29Passes.length,
      both_pass: bothPass.length,
    },
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved to: ${outputPath}`);
}

main().catch(console.error);
