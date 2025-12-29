#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * V12 REALIZED PNL BENCHMARK - 50 CLOB-ONLY WALLETS VS DOME
 * ============================================================================
 *
 * Compares V12 realized PnL against Dome API for the pre-validated 50-wallet
 * CLOB-only cohort (from tmp/clob_50_wallets.json).
 *
 * This benchmark uses Dome realized PnL as truth (not Polymarket UI snapshot),
 * since these wallets were specifically selected for being CLOB-only with
 * high-confidence Dome data.
 *
 * USAGE:
 *   npx tsx scripts/pnl/benchmark-v12-vs-dome-50.ts
 *
 * OUTPUT:
 *   - Console table with comparison
 *   - JSON results saved to tmp/v12_vs_dome_50_results.json
 *
 * Terminal: Claude 1
 * Date: 2025-12-09
 */

import * as fs from 'fs';
import {
  calculateRealizedPnlV12,
  closeClient,
} from '../../lib/pnl/realizedPnlV12';

// ============================================================================
// Configuration
// ============================================================================

const WALLETS_PATH = 'tmp/clob_50_wallets.json';
const ERROR_THRESHOLD_PCT = 5; // Pass if error < 5%

// ============================================================================
// Types
// ============================================================================

interface WalletInput {
  wallet_address: string;
  dome_realized: number;
  dome_confidence: 'high' | 'low';
  is_clob_only: boolean;
  has_active_positions: boolean;
}

interface BenchmarkResult {
  wallet: string;
  domeRealized: number;
  v12Realized: number;
  v12EventCount: number;
  v12UnresolvedPct: number;
  errorPct: number;
  pass: boolean;
  notes: string[];
}

// ============================================================================
// Main Benchmark Function
// ============================================================================

async function runBenchmark(): Promise<BenchmarkResult[]> {
  console.log('='.repeat(100));
  console.log('V12 REALIZED PNL BENCHMARK - 50 CLOB-ONLY WALLETS VS DOME');
  console.log('='.repeat(100));
  console.log('');

  // Load wallets
  if (!fs.existsSync(WALLETS_PATH)) {
    console.error(`Wallets file not found: ${WALLETS_PATH}`);
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync(WALLETS_PATH, 'utf-8'));
  const wallets: WalletInput[] = rawData.wallets || rawData;

  // Filter to high-confidence, CLOB-only wallets
  const validWallets = wallets.filter(
    (w) => w.dome_confidence === 'high' && w.is_clob_only
  );

  console.log(`Loaded ${wallets.length} wallets, ${validWallets.length} high-confidence CLOB-only\n`);

  const results: BenchmarkResult[] = [];

  // Print header
  console.log('Wallet           | Dome PnL    | V12 PnL     | Unres% | Error  | Result');
  console.log('-'.repeat(100));

  for (let i = 0; i < validWallets.length; i++) {
    const w = validWallets[i];
    const shortWallet = w.wallet_address.slice(0, 16);

    // Calculate V12 realized PnL
    const v12Result = await calculateRealizedPnlV12(w.wallet_address);

    // Calculate error vs Dome
    const errorPct =
      w.dome_realized !== 0
        ? Math.abs((v12Result.realizedPnl - w.dome_realized) / w.dome_realized * 100)
        : v12Result.realizedPnl !== 0
        ? 100
        : 0;

    const pass = errorPct < ERROR_THRESHOLD_PCT;
    const notes: string[] = [];

    if (v12Result.errors.length > 0) {
      notes.push(...v12Result.errors);
    }
    if (w.has_active_positions) {
      notes.push('Has active positions');
    }
    if (!pass && errorPct > 50) {
      notes.push('Large discrepancy - investigate');
    }

    const result: BenchmarkResult = {
      wallet: w.wallet_address,
      domeRealized: w.dome_realized,
      v12Realized: v12Result.realizedPnl,
      v12EventCount: v12Result.eventCount,
      v12UnresolvedPct: v12Result.unresolvedPct,
      errorPct,
      pass,
      notes,
    };

    results.push(result);

    // Print row
    const passStr = pass ? '✓ PASS' : '✗ FAIL';
    console.log(
      `${shortWallet} | $${Math.round(w.dome_realized).toString().padStart(9)} | $${Math.round(v12Result.realizedPnl).toString().padStart(9)} | ${v12Result.unresolvedPct.toFixed(1).padStart(5)}% | ${errorPct.toFixed(1).padStart(5)}% | ${passStr}`
    );
  }

  console.log('-'.repeat(100));

  return results;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  try {
    const results = await runBenchmark();

    // Calculate summary stats
    const passCount = results.filter((r) => r.pass).length;
    const failCount = results.filter((r) => !r.pass).length;
    const avgError = results.reduce((sum, r) => sum + r.errorPct, 0) / results.length;
    const medianError = [...results].sort((a, b) => a.errorPct - b.errorPct)[
      Math.floor(results.length / 2)
    ].errorPct;

    console.log('');
    console.log('='.repeat(100));
    console.log('SUMMARY');
    console.log('='.repeat(100));
    console.log(`Total Wallets:       ${results.length}`);
    console.log(`Pass (<5% error):    ${passCount}`);
    console.log(`Fail (>=5% error):   ${failCount}`);
    console.log(`Pass Rate:           ${(passCount / results.length * 100).toFixed(1)}%`);
    console.log('');
    console.log(`Average Error:       ${avgError.toFixed(2)}%`);
    console.log(`Median Error:        ${medianError.toFixed(2)}%`);
    console.log('');

    // Show worst failures
    const failures = results.filter((r) => !r.pass).sort((a, b) => b.errorPct - a.errorPct);
    if (failures.length > 0) {
      console.log('TOP FAILURES:');
      for (const f of failures.slice(0, 5)) {
        console.log(
          `  ${f.wallet.slice(0, 20)}... Dome=$${Math.round(f.domeRealized)}, V12=$${Math.round(f.v12Realized)}, err=${f.errorPct.toFixed(1)}%`
        );
      }
    }

    // Save JSON results
    const jsonPath = 'tmp/v12_vs_dome_50_results.json';
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to: ${jsonPath}`);

  } finally {
    await closeClient();
  }
}

main().catch(console.error);
