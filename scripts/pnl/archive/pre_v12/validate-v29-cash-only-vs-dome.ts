#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * VALIDATE V29 CASH-ONLY VS DOME
 * ============================================================================
 *
 * V29's realizedPnl includes resolvedUnredeemedValue (paper gains from resolved
 * but unredeemed positions). Dome's realized PnL likely ONLY counts actual
 * cash events.
 *
 * This script extracts the pure "cash event" realized PnL from V29 by:
 *   cashOnlyRealized = V29.realizedPnl - V29.resolvedUnredeemedValue
 *
 * This should match Dome's definition more closely.
 *
 * Input:
 *   tmp/dome_realized_500_2025_12_07.json
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-v29-cash-only-vs-dome.ts --limit=50
 *   npx tsx scripts/pnl/validate-v29-cash-only-vs-dome.ts --limit=500
 *
 * Terminal: Claude 2 (Parallel Dome Validation Track)
 * Date: 2025-12-07
 */

import fs from 'fs';
import { calculateV29PnL, V29Result } from '../../lib/pnl/inventoryEngineV29';
import { preloadV29Data } from '../../lib/pnl/v29BatchLoaders';

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
let limit = 50;

for (const arg of args) {
  if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1]);
}

// ============================================================================
// Types
// ============================================================================

interface DomeWallet {
  wallet: string;
  realizedPnl: number;
  confidence: string;
}

interface ValidationResult {
  wallet: string;
  v29_realized_full: number;         // V29's realizedPnl (includes resolvedUnredeemed)
  v29_resolved_unredeemed: number;   // The resolved but unredeemed value
  v29_cash_only_realized: number;    // = v29_realized_full - v29_resolved_unredeemed
  dome_realized: number;

  // Full comparison
  delta_full: number;
  pct_error_full: number;

  // Cash-only comparison (should match Dome better)
  delta_cash_only: number;
  pct_error_cash_only: number;

  // Pass flags
  passed_cash_5pct: boolean;
  passed_cash_10usd: boolean;
  passed_full_5pct: boolean;
  passed_full_10usd: boolean;
}

// ============================================================================
// Load Dome Data
// ============================================================================

function loadDomeData(maxWallets: number): DomeWallet[] {
  const file = 'tmp/dome_realized_500_2025_12_07.json';
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const wallets: DomeWallet[] = [];

  for (const w of data.wallets || []) {
    if (w.confidence === 'high' && w.realizedPnl !== null && !w.isPlaceholder) {
      wallets.push({
        wallet: w.wallet.toLowerCase(),
        realizedPnl: w.realizedPnl,
        confidence: w.confidence,
      });
    }
    if (wallets.length >= maxWallets) break;
  }

  return wallets;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('V29 CASH-ONLY VS DOME VALIDATION');
  console.log('='.repeat(80));
  console.log('');
  console.log('HYPOTHESIS: V29 realizedPnl includes resolvedUnredeemedValue');
  console.log('            Dome realized likely only counts actual cash events');
  console.log('');
  console.log(`Testing with ${limit} wallets...`);
  console.log('');

  // Load Dome data
  const domeWallets = loadDomeData(limit);
  console.log(`Loaded ${domeWallets.length} high-confidence Dome wallets`);

  // Preload V29 data for batch processing
  console.log('\nPreloading V29 data...');
  const walletList = domeWallets.map(w => w.wallet);
  const startPreload = Date.now();
  const v29Data = await preloadV29Data(walletList);
  console.log(`Preload complete in ${Date.now() - startPreload}ms`);

  // Calculate V29 PnL for each wallet
  console.log('\nCalculating V29 PnL...');
  const results: ValidationResult[] = [];

  for (let i = 0; i < domeWallets.length; i++) {
    const dome = domeWallets[i];
    process.stdout.write(`\r  Progress: ${i + 1}/${domeWallets.length}`);

    try {
      const events = v29Data.eventsByWallet.get(dome.wallet) || [];
      const v29Result = await calculateV29PnL(dome.wallet, {
        inventoryGuard: true,
        preload: {
          events,
          resolutionPrices: v29Data.resolutionPrices,
        },
      });

      // V29's realizedPnl = actual cash events + resolvedUnredeemedValue
      // Extract just the cash-only portion
      const cashOnlyRealized = v29Result.realizedPnl - v29Result.resolvedUnredeemedValue;

      const deltaFull = v29Result.realizedPnl - dome.realizedPnl;
      const deltaCashOnly = cashOnlyRealized - dome.realizedPnl;

      const denom = Math.max(Math.abs(dome.realizedPnl), 100);
      const pctErrorFull = (Math.abs(deltaFull) / denom) * 100;
      const pctErrorCashOnly = (Math.abs(deltaCashOnly) / denom) * 100;

      results.push({
        wallet: dome.wallet,
        v29_realized_full: v29Result.realizedPnl,
        v29_resolved_unredeemed: v29Result.resolvedUnredeemedValue,
        v29_cash_only_realized: cashOnlyRealized,
        dome_realized: dome.realizedPnl,
        delta_full: deltaFull,
        pct_error_full: pctErrorFull,
        delta_cash_only: deltaCashOnly,
        pct_error_cash_only: pctErrorCashOnly,
        passed_cash_5pct: pctErrorCashOnly < 5 || Math.abs(deltaCashOnly) < 5,
        passed_cash_10usd: Math.abs(deltaCashOnly) < 10,
        passed_full_5pct: pctErrorFull < 5 || Math.abs(deltaFull) < 5,
        passed_full_10usd: Math.abs(deltaFull) < 10,
      });
    } catch (err: any) {
      console.log(`\n  Error for ${dome.wallet}: ${err.message}`);
    }
  }

  console.log('\n');

  // Calculate stats
  const passedCash5pct = results.filter(r => r.passed_cash_5pct).length;
  const passedCash10usd = results.filter(r => r.passed_cash_10usd).length;
  const passedFull5pct = results.filter(r => r.passed_full_5pct).length;
  const passedFull10usd = results.filter(r => r.passed_full_10usd).length;

  const medianPctCash = median(results.map(r => r.pct_error_cash_only));
  const medianPctFull = median(results.map(r => r.pct_error_full));
  const medianAbsCash = median(results.map(r => Math.abs(r.delta_cash_only)));
  const medianAbsFull = median(results.map(r => Math.abs(r.delta_full)));

  // Print comparison
  console.log('='.repeat(80));
  console.log('COMPARISON: Full V29 vs Cash-Only V29');
  console.log('='.repeat(80));
  console.log('');
  console.log('| Metric            | Full V29 (with resolved) | Cash-Only V29 |');
  console.log('|-------------------|--------------------------|---------------|');
  console.log(`| Pass Rate (5%)    | ${(passedFull5pct / results.length * 100).toFixed(1)}%                    | ${(passedCash5pct / results.length * 100).toFixed(1)}%          |`);
  console.log(`| Pass Rate ($10)   | ${(passedFull10usd / results.length * 100).toFixed(1)}%                    | ${(passedCash10usd / results.length * 100).toFixed(1)}%          |`);
  console.log(`| Median % Error    | ${medianPctFull.toFixed(2)}%                   | ${medianPctCash.toFixed(2)}%         |`);
  console.log(`| Median $ Error    | $${medianAbsFull.toFixed(2)}                   | $${medianAbsCash.toFixed(2)}         |`);
  console.log('');

  // Show top 10 where cash-only is much better
  const improvements = results
    .map(r => ({
      wallet: r.wallet,
      dome: r.dome_realized,
      full: r.v29_realized_full,
      cashOnly: r.v29_cash_only_realized,
      resolvedUnredeemed: r.v29_resolved_unredeemed,
      fullError: r.pct_error_full,
      cashError: r.pct_error_cash_only,
      improvement: r.pct_error_full - r.pct_error_cash_only,
    }))
    .filter(r => Math.abs(r.resolvedUnredeemed) > 10) // Only where there's unredeemed value
    .sort((a, b) => b.improvement - a.improvement)
    .slice(0, 10);

  console.log('Top 10 wallets where Cash-Only is better:');
  console.log('-'.repeat(100));
  console.log('Wallet           | Dome        | Full V29    | Cash-Only   | Unredeemed  | Improvement');
  console.log('-'.repeat(100));
  for (const r of improvements) {
    console.log(
      `${r.wallet.slice(0, 15)}... | $${r.dome.toFixed(0).padStart(9)} | $${r.full.toFixed(0).padStart(9)} | $${r.cashOnly.toFixed(0).padStart(9)} | $${r.resolvedUnredeemed.toFixed(0).padStart(9)} | ${r.improvement.toFixed(1)}% better`
    );
  }

  // Save results
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      total_wallets: results.length,
      hypothesis: 'V29 realizedPnl includes resolvedUnredeemedValue, Dome does not',
    },
    summary: {
      full_v29: {
        pass_rate_5pct: passedFull5pct / results.length,
        pass_rate_10usd: passedFull10usd / results.length,
        median_pct_error: medianPctFull,
        median_abs_error: medianAbsFull,
      },
      cash_only_v29: {
        pass_rate_5pct: passedCash5pct / results.length,
        pass_rate_10usd: passedCash10usd / results.length,
        median_pct_error: medianPctCash,
        median_abs_error: medianAbsCash,
      },
    },
    results,
  };

  fs.writeFileSync('tmp/v29_cash_only_vs_dome.json', JSON.stringify(output, null, 2));
  console.log('\nResults saved to: tmp/v29_cash_only_vs_dome.json');

  // Conclusion
  console.log('\n');
  console.log('='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));

  if (passedCash5pct > passedFull5pct) {
    console.log('');
    console.log('✅ HYPOTHESIS CONFIRMED: Cash-only V29 matches Dome better!');
    console.log('');
    console.log('   Dome realized PnL = actual cash events only');
    console.log('   V29 realizedPnl = cash events + resolved unredeemed');
    console.log('');
    console.log('   To match Dome, use: V29.realizedPnl - V29.resolvedUnredeemedValue');
  } else {
    console.log('');
    console.log('❌ HYPOTHESIS NOT CONFIRMED: Cash-only is not better');
    console.log('');
    console.log('   Need to investigate other differences...');
  }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

main().catch(console.error);
