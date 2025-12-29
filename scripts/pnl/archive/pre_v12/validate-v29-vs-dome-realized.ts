#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * V29 vs DOME REALIZED PNL VALIDATOR
 * ============================================================================
 *
 * PURPOSE: Fast validator comparing V29 realized PnL against Dome ground truth
 *
 * USAGE:
 *   npx tsx scripts/pnl/validate-v29-vs-dome-realized.ts \
 *     --wallets-file=tmp/trader_strict_sample_v2_fast.json \
 *     --limit=50 \
 *     --concurrency=6 \
 *     --snapshot=tmp/dome_realized_snapshot_2025_12_07.json \
 *     --output=tmp/v29_vs_dome_realized_2025_12_07.json
 *
 * Terminal: Claude 2
 * Date: 2025-12-06
 */

import fs from 'fs';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';
import { preloadV29Data } from '../../lib/pnl/v29BatchLoaders';
import { loadDomeRealizedTruth } from '../../lib/pnl/domeTruthLoader';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  walletsFile: string;
  limit: number;
  concurrency: number;
  snapshot: string | null;
  output: string | null;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let walletsFile = '';
  let limit = 50;
  let concurrency = 6;
  let snapshot: string | null = null;
  let output: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--wallets-file=')) {
      walletsFile = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10) || 50;
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = parseInt(arg.split('=')[1], 10) || 6;
    } else if (arg.startsWith('--snapshot=') || arg.startsWith('--dome-snapshot=')) {
      snapshot = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      output = arg.split('=')[1];
    }
  }

  if (!walletsFile) {
    console.error('ERROR: --wallets-file required');
    process.exit(1);
  }

  return { walletsFile, limit, concurrency, snapshot, output };
}

// ============================================================================
// Types
// ============================================================================

interface ValidationResult {
  wallet: string;
  v29_realized: number;
  dome_realized: number;
  abs_error_usd: number;
  pct_error_safe: number;
  confidence: 'high' | 'low';
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function pctErrorSafe(calculated: number, dome: number): number {
  const denom = Math.max(Math.abs(dome), 100);
  return (Math.abs(calculated - dome) / denom) * 100;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function formatPnL(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ============================================================================
// Load Wallets
// ============================================================================

function loadWallets(config: Config): string[] {
  if (!fs.existsSync(config.walletsFile)) {
    console.error(`ERROR: Wallet file not found: ${config.walletsFile}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(config.walletsFile, 'utf-8'));
  const wallets: string[] = [];

  // Support multiple formats
  if (data.wallets && Array.isArray(data.wallets)) {
    if (typeof data.wallets[0] === 'string') {
      wallets.push(...data.wallets.slice(0, config.limit));
    } else if (data.wallets[0]?.wallet_address) {
      wallets.push(...data.wallets.slice(0, config.limit).map((w: any) => w.wallet_address));
    } else if (data.wallets[0]?.wallet) {
      wallets.push(...data.wallets.slice(0, config.limit).map((w: any) => w.wallet));
    }
  } else if (Array.isArray(data)) {
    const slice = data.slice(0, config.limit);
    for (const item of slice) {
      if (item.wallet) {
        wallets.push(item.wallet);
      } else if (item.wallet_address) {
        wallets.push(item.wallet_address);
      }
    }
  }

  return wallets.map(w => w.toLowerCase());
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log('═'.repeat(100));
  console.log('V29 vs DOME REALIZED PNL VALIDATOR');
  console.log('═'.repeat(100));
  console.log('');
  console.log(`Config:`);
  console.log(`  wallets-file: ${config.walletsFile}`);
  console.log(`  limit: ${config.limit}`);
  console.log(`  concurrency: ${config.concurrency}`);
  console.log(`  snapshot: ${config.snapshot || 'none (will fetch live)'}`);
  console.log(`  output: ${config.output || 'auto-generated'}`);
  console.log('');

  // Step 1: Load wallets
  console.log('STEP 1: Loading wallets...');
  const wallets = loadWallets(config);
  console.log(`  Loaded ${wallets.length} wallets`);
  console.log('');

  // Step 2: Load Dome benchmarks
  console.log('STEP 2: Loading Dome realized PnL benchmarks...');
  const domeBenchmarks = await loadDomeRealizedTruth({
    snapshotPath: config.snapshot || undefined,
    wallets,
    concurrency: config.concurrency,
    fetchLive: !config.snapshot, // Only fetch live if no snapshot provided
  });
  console.log(`  Loaded ${domeBenchmarks.size} Dome benchmarks`);
  console.log('');

  // Step 3: Preload V29 data
  console.log('STEP 3: Preloading V29 data...');
  const startPreload = Date.now();
  const v29Data = await preloadV29Data(wallets);
  const preloadDuration = Date.now() - startPreload;
  console.log(`  Preload complete in ${preloadDuration}ms`);
  console.log('');

  // Step 4: Calculate V29 PnL and compare
  console.log('STEP 4: Calculating V29 PnL and comparing...');
  const startCalc = Date.now();
  const results: ValidationResult[] = [];

  for (const wallet of wallets) {
    const domeBenchmark = domeBenchmarks.get(wallet);

    if (!domeBenchmark) {
      results.push({
        wallet,
        v29_realized: 0,
        dome_realized: 0,
        abs_error_usd: 0,
        pct_error_safe: 0,
        confidence: 'low',
        error: 'No Dome benchmark available',
      });
      continue;
    }

    try {
      // Get preloaded events for this wallet
      const events = v29Data.eventsByWallet.get(wallet) || [];

      // Calculate V29 PnL with preload
      const v29Result = await calculateV29PnL(wallet, {
        inventoryGuard: true,
        preload: {
          events,
          resolutionPrices: v29Data.resolutionPrices,
        },
      });

      // V29 returns realizedPnl (camelCase) from the engine
      const v29Realized = v29Result.realizedPnl ?? 0;
      const domeRealized = domeBenchmark.realizedPnl;

      const absError = Math.abs(v29Realized - domeRealized);
      const pctError = pctErrorSafe(v29Realized, domeRealized);

      results.push({
        wallet,
        v29_realized: v29Realized,
        dome_realized: domeRealized,
        abs_error_usd: absError,
        pct_error_safe: pctError,
        confidence: domeBenchmark.confidence,
      });
    } catch (err: any) {
      console.log(`\n❌ Error for ${wallet.substring(0, 12)}...: ${err.message}`);
      results.push({
        wallet,
        v29_realized: 0,
        dome_realized: domeBenchmark.realizedPnl,
        abs_error_usd: 0,
        pct_error_safe: 0,
        confidence: 'low',
        error: err.message,
      });
    }
  }

  const calcDuration = Date.now() - startCalc;
  console.log(`  Calculations complete in ${calcDuration}ms`);
  console.log('');

  // Step 5: Compute statistics
  console.log('STEP 5: Computing statistics...');

  const highConfidenceResults = results.filter(r => r.confidence === 'high' && !r.error);
  const absErrors = highConfidenceResults.map(r => r.abs_error_usd);
  const pctErrors = highConfidenceResults.map(r => r.pct_error_safe);

  const medianAbsError = median(absErrors);
  const p90AbsError = percentile(absErrors, 90);
  const medianPctError = median(pctErrors);
  const p90PctError = percentile(pctErrors, 90);

  // Pass rates
  const passUnder10 = highConfidenceResults.filter(r => r.abs_error_usd < 10).length;
  const passUnder50 = highConfidenceResults.filter(r => r.abs_error_usd < 50).length;
  const passUnder100 = highConfidenceResults.filter(r => r.abs_error_usd < 100).length;
  const passUnder3Pct = highConfidenceResults.filter(r => r.pct_error_safe < 3).length;

  const stats = {
    total_wallets: results.length,
    high_confidence: highConfidenceResults.length,
    low_confidence: results.length - highConfidenceResults.length,
    median_abs_error_usd: medianAbsError,
    p90_abs_error_usd: p90AbsError,
    median_pct_error_safe: medianPctError,
    p90_pct_error_safe: p90PctError,
    pass_rates: {
      under_10_usd: passUnder10,
      under_50_usd: passUnder50,
      under_100_usd: passUnder100,
      under_3_pct: passUnder3Pct,
    },
    pass_rate_percentages: {
      under_10_usd: (passUnder10 / highConfidenceResults.length) * 100,
      under_50_usd: (passUnder50 / highConfidenceResults.length) * 100,
      under_100_usd: (passUnder100 / highConfidenceResults.length) * 100,
      under_3_pct: (passUnder3Pct / highConfidenceResults.length) * 100,
    },
    performance: {
      preload_ms: preloadDuration,
      calc_ms: calcDuration,
      total_ms: preloadDuration + calcDuration,
      per_wallet_avg_ms: (preloadDuration + calcDuration) / results.length,
    },
  };

  console.log('  Done');
  console.log('');

  // Step 6: Display summary
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log('');
  console.log(`Total Wallets: ${stats.total_wallets}`);
  console.log(`  High Confidence: ${stats.high_confidence}`);
  console.log(`  Low Confidence: ${stats.low_confidence}`);
  console.log('');
  console.log(`Absolute Error USD:`);
  console.log(`  Median: ${formatPnL(medianAbsError)}`);
  console.log(`  P90:    ${formatPnL(p90AbsError)}`);
  console.log('');
  console.log(`Percent Error (Safe):`);
  console.log(`  Median: ${medianPctError.toFixed(2)}%`);
  console.log(`  P90:    ${p90PctError.toFixed(2)}%`);
  console.log('');
  console.log(`Pass Rates (High Confidence Only):`);
  console.log(`  < $10:   ${passUnder10}/${highConfidenceResults.length} (${stats.pass_rate_percentages.under_10_usd.toFixed(1)}%)`);
  console.log(`  < $50:   ${passUnder50}/${highConfidenceResults.length} (${stats.pass_rate_percentages.under_50_usd.toFixed(1)}%)`);
  console.log(`  < $100:  ${passUnder100}/${highConfidenceResults.length} (${stats.pass_rate_percentages.under_100_usd.toFixed(1)}%)`);
  console.log(`  < 3%:    ${passUnder3Pct}/${highConfidenceResults.length} (${stats.pass_rate_percentages.under_3_pct.toFixed(1)}%)`);
  console.log('');

  // Top 10 worst wallets
  const worst = highConfidenceResults
    .sort((a, b) => b.abs_error_usd - a.abs_error_usd)
    .slice(0, 10);

  console.log('Top 10 Worst Wallets (by abs error):');
  console.log('-'.repeat(100));
  console.log('Wallet           | V29 Realized  | Dome Realized | Abs Error     | Pct Error');
  console.log('-'.repeat(100));

  for (const r of worst) {
    console.log(
      `${r.wallet.substring(0, 15)}... | ${formatPnL(r.v29_realized).padStart(13)} | ${formatPnL(r.dome_realized).padStart(13)} | ${formatPnL(r.abs_error_usd).padStart(13)} | ${r.pct_error_safe.toFixed(2)}%`
    );
  }

  console.log('');

  // Performance
  console.log(`Performance:`);
  console.log(`  Total Time: ${stats.performance.total_ms}ms`);
  console.log(`    Preload: ${stats.performance.preload_ms}ms`);
  console.log(`    Calculation: ${stats.performance.calc_ms}ms`);
  console.log(`  Per-Wallet Avg: ${stats.performance.per_wallet_avg_ms.toFixed(0)}ms`);
  console.log('');

  // Step 7: Write output
  const outputPath = config.output || `tmp/v29_vs_dome_realized_${new Date().toISOString().split('T')[0].replace(/-/g, '_')}.json`;

  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      wallets_file: config.walletsFile,
      snapshot: config.snapshot,
      limit: config.limit,
    },
    stats,
    rows: results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`✅ Results written to: ${outputPath}`);
  console.log('');

  console.log('═'.repeat(100));
  console.log(`Terminal 2 | ${new Date().toISOString()}`);
  console.log('═'.repeat(100));
}

main().catch(console.error);
