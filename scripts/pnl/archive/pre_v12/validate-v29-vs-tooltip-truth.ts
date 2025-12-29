#!/usr/bin/env npx tsx
/**
 * V29 vs Tooltip Truth Validator
 *
 * This is the CANONICAL validation script for V29 accuracy.
 * It compares V29 uiParityPnl (valuationMode: 'ui') against Playwright tooltip-verified PnL values.
 *
 * Input: tmp/playwright_tooltip_ground_truth.json
 * Output: tmp/v29_vs_tooltip_truth.json
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-v29-vs-tooltip-truth.ts
 *   npx tsx scripts/pnl/validate-v29-vs-tooltip-truth.ts --tolerance=0.06
 */

import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';
import fs from 'fs';

interface TooltipWallet {
  wallet: string;
  uiPnl: number;
  gain: number | null;
  loss: number | null;
  volume: number | null;
  scrapedAt: string;
  identityCheckPass: boolean;
  label: 'leaderboard' | 'clob-only' | 'mixed';
  notes: string;
}

interface ValidationResult {
  wallet: string;
  uiPnl: number;
  v29UiParity: number;
  v29Realized: number;
  v29Unrealized: number;
  v29ResolvedUnredeemed: number;
  openPositions: number;
  errorPct: number | null;
  pass: boolean;
  label: string;
  notes: string;
}

const DEFAULT_TOLERANCE = 0.10; // 10% tolerance

async function main() {
  const inputPath = 'tmp/playwright_tooltip_ground_truth.json';
  const outputPath = 'tmp/v29_vs_tooltip_truth.json';

  // Parse tolerance from args
  let tolerance = DEFAULT_TOLERANCE;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--tolerance=')) {
      tolerance = parseFloat(arg.split('=')[1]);
    }
  }

  console.log('='.repeat(80));
  console.log('V29 vs TOOLTIP TRUTH VALIDATION');
  console.log('='.repeat(80));
  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Tolerance: ${(tolerance * 100).toFixed(1)}%`);
  console.log();

  // Load ground truth
  if (!fs.existsSync(inputPath)) {
    console.error(`Ground truth not found: ${inputPath}`);
    console.log('Run Playwright scraper to create ground truth first.');
    process.exit(1);
  }

  const groundTruth = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const wallets: TooltipWallet[] = groundTruth.wallets;

  console.log(`Loaded ${wallets.length} tooltip-verified wallets\n`);

  // Run validation
  const results: ValidationResult[] = [];
  let processed = 0;

  for (const w of wallets) {
    processed++;
    process.stdout.write(`\r[${processed}/${wallets.length}] ${w.wallet.slice(0, 12)}...`);

    try {
      const v29 = await calculateV29PnL(w.wallet, {
        inventoryGuard: true,
        valuationMode: 'ui', // Use UI mode for parity comparison
      });

      // Calculate error percentage (skip if uiPnl is too small)
      let errorPct: number | null = null;
      let pass = true;

      if (Math.abs(w.uiPnl) >= 100) {
        errorPct = (v29.uiParityPnl - w.uiPnl) / Math.abs(w.uiPnl);
        pass = Math.abs(errorPct) <= tolerance;
      }

      results.push({
        wallet: w.wallet,
        uiPnl: w.uiPnl,
        v29UiParity: v29.uiParityPnl,
        v29Realized: v29.realizedPnl,
        v29Unrealized: v29.unrealizedPnl,
        v29ResolvedUnredeemed: v29.resolvedUnredeemedValue,
        openPositions: v29.openPositions,
        errorPct,
        pass,
        label: w.label,
        notes: w.notes,
      });
    } catch (err: any) {
      console.log(`\nError processing ${w.wallet}: ${err.message}`);
      results.push({
        wallet: w.wallet,
        uiPnl: w.uiPnl,
        v29UiParity: 0,
        v29Realized: 0,
        v29Unrealized: 0,
        v29ResolvedUnredeemed: 0,
        openPositions: 0,
        errorPct: null,
        pass: false,
        label: w.label,
        notes: `ERROR: ${err.message}`,
      });
    }
  }

  console.log('\n\n');

  // Calculate summary statistics
  const validResults = results.filter(r => r.errorPct !== null);
  const passes = validResults.filter(r => r.pass);
  const fails = validResults.filter(r => !r.pass);

  // By label
  const leaderboardResults = validResults.filter(r => r.label === 'leaderboard');
  const clobOnlyResults = validResults.filter(r => r.label === 'clob-only');
  const mixedResults = validResults.filter(r => r.label === 'mixed');

  const leaderboardPasses = leaderboardResults.filter(r => r.pass);
  const clobOnlyPasses = clobOnlyResults.filter(r => r.pass);
  const mixedPasses = mixedResults.filter(r => r.pass);

  // By open positions
  const closedPositions = validResults.filter(r => r.openPositions === 0);
  const fewOpenPositions = validResults.filter(r => r.openPositions > 0 && r.openPositions <= 50);
  const manyOpenPositions = validResults.filter(r => r.openPositions > 50);

  const closedPasses = closedPositions.filter(r => r.pass);
  const fewOpenPasses = fewOpenPositions.filter(r => r.pass);
  const manyOpenPasses = manyOpenPositions.filter(r => r.pass);

  // Print summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets: ${results.length}`);
  console.log(`Valid for comparison (|PnL| >= $100): ${validResults.length}`);
  console.log();

  console.log('--- OVERALL PASS RATE ---');
  console.log(`PASS: ${passes.length}/${validResults.length} (${(passes.length / validResults.length * 100).toFixed(1)}%)`);
  console.log(`FAIL: ${fails.length}/${validResults.length}`);
  console.log();

  console.log('--- BY LABEL ---');
  console.log(`Leaderboard: ${leaderboardPasses.length}/${leaderboardResults.length} (${leaderboardResults.length > 0 ? (leaderboardPasses.length / leaderboardResults.length * 100).toFixed(1) : 0}%)`);
  console.log(`CLOB-only:   ${clobOnlyPasses.length}/${clobOnlyResults.length} (${clobOnlyResults.length > 0 ? (clobOnlyPasses.length / clobOnlyResults.length * 100).toFixed(1) : 0}%)`);
  console.log(`Mixed:       ${mixedPasses.length}/${mixedResults.length} (${mixedResults.length > 0 ? (mixedPasses.length / mixedResults.length * 100).toFixed(1) : 0}%)`);
  console.log();

  console.log('--- BY OPEN POSITIONS ---');
  console.log(`Closed (0):      ${closedPasses.length}/${closedPositions.length} (${closedPositions.length > 0 ? (closedPasses.length / closedPositions.length * 100).toFixed(1) : 0}%)`);
  console.log(`Few (1-50):      ${fewOpenPasses.length}/${fewOpenPositions.length} (${fewOpenPositions.length > 0 ? (fewOpenPasses.length / fewOpenPositions.length * 100).toFixed(1) : 0}%)`);
  console.log(`Many (50+):      ${manyOpenPasses.length}/${manyOpenPositions.length} (${manyOpenPositions.length > 0 ? (manyOpenPasses.length / manyOpenPositions.length * 100).toFixed(1) : 0}%)`);
  console.log();

  // Show failures
  if (fails.length > 0) {
    console.log('--- FAILURES ---');
    for (const r of fails.sort((a, b) => Math.abs(b.errorPct || 0) - Math.abs(a.errorPct || 0))) {
      const errorStr = r.errorPct !== null ? `${(r.errorPct * 100).toFixed(1)}%` : 'N/A';
      console.log(`${r.wallet.slice(0, 12)}... | UI: $${r.uiPnl.toLocaleString()} | V29: $${r.v29UiParity.toLocaleString()} | Error: ${errorStr} | Open: ${r.openPositions}`);
    }
    console.log();
  }

  // Show passes
  console.log('--- PASSES (sample) ---');
  for (const r of passes.slice(0, 10)) {
    const errorStr = r.errorPct !== null ? `${(r.errorPct * 100).toFixed(1)}%` : 'N/A';
    console.log(`${r.wallet.slice(0, 12)}... | UI: $${r.uiPnl.toLocaleString()} | V29: $${r.v29UiParity.toLocaleString()} | Error: ${errorStr} | Open: ${r.openPositions}`);
  }

  // Average error for passes
  const passErrors = passes.map(r => Math.abs(r.errorPct || 0));
  const avgError = passErrors.length > 0 ? passErrors.reduce((a, b) => a + b, 0) / passErrors.length : 0;
  console.log(`\nAverage error (passing): ${(avgError * 100).toFixed(2)}%`);

  // Save results
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      input_file: inputPath,
      tolerance_pct: tolerance,
      wallet_count: results.length,
      valid_count: validResults.length,
    },
    summary: {
      overall_pass_rate: validResults.length > 0 ? passes.length / validResults.length : 0,
      passes: passes.length,
      fails: fails.length,
      average_error_pct: avgError,
      by_label: {
        leaderboard: { passes: leaderboardPasses.length, total: leaderboardResults.length },
        clob_only: { passes: clobOnlyPasses.length, total: clobOnlyResults.length },
        mixed: { passes: mixedPasses.length, total: mixedResults.length },
      },
      by_open_positions: {
        closed: { passes: closedPasses.length, total: closedPositions.length },
        few_open: { passes: fewOpenPasses.length, total: fewOpenPositions.length },
        many_open: { passes: manyOpenPasses.length, total: manyOpenPositions.length },
      },
    },
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved to: ${outputPath}`);
}

main().catch(console.error);
