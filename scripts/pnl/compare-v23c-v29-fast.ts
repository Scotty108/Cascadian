/**
 * ============================================================================
 * V23C vs V29 FAST COMPARISON (BATCH PRELOAD) - TRADER_STRICT V2
 * ============================================================================
 *
 * PURPOSE: Clean apples-to-apples comparison with sane error metrics
 *
 * USAGE:
 *   npx tsx scripts/pnl/compare-v23c-v29-fast.ts --limit=20
 *   npx tsx scripts/pnl/compare-v23c-v29-fast.ts --limit=50 --wallets-file=tmp/trader_strict_sample_v2_fast.json
 *   npx tsx scripts/pnl/compare-v23c-v29-fast.ts --limit=20 --output=tmp/results.json
 *   npx tsx scripts/pnl/compare-v23c-v29-fast.ts --truth=live --live-snapshot=tmp/ui_pnl_live_snapshot_2025_12_07.json
 *   npx tsx scripts/pnl/compare-v23c-v29-fast.ts --truth=v2 --allow-v1-fallback
 *
 * Terminal: Claude 1 & 2
 * Date: 2025-12-06
 */

import fs from 'fs';
import { calculateV23cPnL } from '../../lib/pnl/shadowLedgerV23c';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';
import { preloadV23cData } from '../../lib/pnl/v23cBatchLoaders';
import { preloadV29Data } from '../../lib/pnl/v29BatchLoaders';
import { loadUITruth } from '../../lib/pnl/uiTruthLoader';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  limit: number;
  walletsFile: string | null;
  output: string | null;
  truth: 'live' | 'v2' | 'v1';
  liveSnapshot: string | null;
  allowV1Fallback: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let limit = 20;
  let walletsFile: string | null = null;
  let output: string | null = null;
  let truth: 'live' | 'v2' | 'v1' = 'v2';
  let liveSnapshot: string | null = null;
  let allowV1Fallback = false;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10) || 20;
    } else if (arg.startsWith('--wallets-file=')) {
      walletsFile = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      output = arg.split('=')[1];
    } else if (arg.startsWith('--truth=')) {
      const val = arg.split('=')[1] as 'live' | 'v2' | 'v1';
      if (['live', 'v2', 'v1'].includes(val)) {
        truth = val;
      }
    } else if (arg.startsWith('--live-snapshot=')) {
      liveSnapshot = arg.split('=')[1];
    } else if (arg === '--allow-v1-fallback') {
      allowV1Fallback = true;
    }
  }

  return { limit, walletsFile, output, truth, liveSnapshot, allowV1Fallback };
}

// ============================================================================
// Types
// ============================================================================

interface WalletResult {
  wallet: string;
  ui_pnl: number | null;
  v23c_pnl: number;
  v29_pnl: number;
  v29_realized_pnl: number;
  abs_error_usd_v23c: number | null;
  abs_error_usd_v29: number | null;
  pct_error_safe_v23c: number | null;
  pct_error_safe_v29: number | null;
  winner: 'V23C' | 'V29' | 'TIE' | 'NO_UI';
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Safe percentage error calculation
 * Uses max(abs(ui), 100) as denominator to avoid division by small numbers
 */
function pctErrorSafe(calculated: number, ui: number): number {
  const denom = Math.max(Math.abs(ui), 100);
  return (Math.abs(calculated - ui) / denom) * 100;
}

function formatPnL(n: number | null): string {
  if (n === null) return 'N/A';
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
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

// ============================================================================
// Load Wallets
// ============================================================================

async function loadWallets(config: Config): Promise<{ wallets: string[]; uiBenchmarks: Map<string, number> }> {
  const wallets: string[] = [];

  // Determine source file
  let sourceFile = config.walletsFile;
  if (!sourceFile) {
    sourceFile = './tmp/trader_strict_sample_v2_fast.json';
  }

  if (!fs.existsSync(sourceFile)) {
    console.error(`ERROR: Wallet file not found: ${sourceFile}`);
    process.exit(1);
  }

  console.log(`Loading wallets from: ${sourceFile}`);
  const data = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));

  // Support multiple formats
  if (data.wallets && Array.isArray(data.wallets)) {
    // Format: { wallets: [...] } or { wallets: [{wallet_address: "0x..."},...] }
    if (typeof data.wallets[0] === 'string') {
      wallets.push(...data.wallets.slice(0, config.limit));
    } else if (data.wallets[0]?.wallet_address) {
      wallets.push(...data.wallets.slice(0, config.limit).map((w: any) => w.wallet_address));
    }
  } else if (Array.isArray(data)) {
    // Format: [{wallet: "0x...", uiPnL: 123}, ...]
    const slice = data.slice(0, config.limit);
    for (const item of slice) {
      if (item.wallet) {
        wallets.push(item.wallet);
      }
    }
  }

  // Normalize to lowercase
  const normalizedWallets = wallets.map(w => w.toLowerCase());

  // Load UI benchmarks using new truth loader
  const truthOptions = {
    preferSource: config.truth,
    liveSnapshotPath: config.liveSnapshot,
    allowV1Fallback: config.allowV1Fallback,
    minConfidence: 'medium' as const,
  };

  const truthResult = await loadUITruth(normalizedWallets, truthOptions);

  // Extract PnL map from benchmarks
  const uiBenchmarks = new Map<string, number>();
  for (const [wallet, benchmark] of truthResult.benchmarks) {
    uiBenchmarks.set(wallet, benchmark.ui_pnl);
  }

  return { wallets: normalizedWallets, uiBenchmarks };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log('═'.repeat(100));
  console.log('V23C vs V29 FAST COMPARISON - TRADER_STRICT V2');
  console.log('═'.repeat(100));
  console.log('');
  console.log(`Config:`);
  console.log(`  limit: ${config.limit}`);
  console.log(`  wallets-file: ${config.walletsFile || 'default (trader_strict_sample_v2_fast.json)'}`);
  console.log(`  output: ${config.output || 'auto-generated'}`);
  console.log(`  truth: ${config.truth}`);
  if (config.liveSnapshot) {
    console.log(`  live-snapshot: ${config.liveSnapshot}`);
  }
  console.log(`  allow-v1-fallback: ${config.allowV1Fallback}`);
  console.log('');

  // Step 1: Load wallets
  console.log('STEP 1: Loading wallets...');
  const { wallets, uiBenchmarks } = await loadWallets(config);
  console.log(`  Loaded ${wallets.length} wallets`);
  console.log(`  UI benchmarks available: ${uiBenchmarks.size}`);
  console.log('');

  // Step 2: Preload V23C and V29 data in parallel
  console.log('STEP 2: Preloading data for V23C and V29...');
  const startPreload = Date.now();

  const [v23cData, v29Data] = await Promise.all([
    preloadV23cData(wallets),
    preloadV29Data(wallets),
  ]);

  const preloadDuration = Date.now() - startPreload;
  console.log(`\n✅ Preload complete in ${preloadDuration}ms\n`);

  // Step 3: Process wallets
  console.log('STEP 3: Computing V23C and V29 PnL...');
  const results: WalletResult[] = [];
  const startCalc = Date.now();

  for (const wallet of wallets) {
    const ui_pnl = uiBenchmarks.get(wallet) ?? null;

    try {
      // Get preloaded data for this wallet
      const v23cEvents = v23cData.eventsByWallet.get(wallet) || [];
      const v29Events = v29Data.eventsByWallet.get(wallet) || [];

      // Run V23C with preload
      const v23cResult = await calculateV23cPnL(wallet, {
        useUIOracle: true,
        preload: {
          events: v23cEvents,
          resolutionPrices: v23cData.resolutionPrices,
          uiPrices: v23cData.uiPrices,
        },
      });

      // Run V29 with preload
      const v29Result = await calculateV29PnL(wallet, {
        inventoryGuard: true,
        useMaterializedTable: true,
        preload: {
          events: v29Events,
          resolutionPrices: v29Data.resolutionPrices,
        },
      });

      const v23c_pnl = v23cResult.totalPnl;
      const v29_pnl = v29Result.totalPnl;
      const v29_realized_pnl = v29Result.realizedPnl;

      let abs_error_usd_v23c: number | null = null;
      let abs_error_usd_v29: number | null = null;
      let pct_error_safe_v23c: number | null = null;
      let pct_error_safe_v29: number | null = null;
      let winner: 'V23C' | 'V29' | 'TIE' | 'NO_UI' = 'NO_UI';

      if (ui_pnl !== null) {
        abs_error_usd_v23c = Math.abs(v23c_pnl - ui_pnl);
        abs_error_usd_v29 = Math.abs(v29_pnl - ui_pnl);
        pct_error_safe_v23c = pctErrorSafe(v23c_pnl, ui_pnl);
        pct_error_safe_v29 = pctErrorSafe(v29_pnl, ui_pnl);

        if (abs_error_usd_v23c < abs_error_usd_v29) {
          winner = 'V23C';
        } else if (abs_error_usd_v29 < abs_error_usd_v23c) {
          winner = 'V29';
        } else {
          winner = 'TIE';
        }
      }

      results.push({
        wallet,
        ui_pnl,
        v23c_pnl,
        v29_pnl,
        v29_realized_pnl,
        abs_error_usd_v23c,
        abs_error_usd_v29,
        pct_error_safe_v23c,
        pct_error_safe_v29,
        winner,
      });

      const statusEmoji = winner === 'V23C' ? '🟢' : winner === 'V29' ? '🔵' : winner === 'TIE' ? '⚪' : '⚫';
      console.log(`  ${statusEmoji} ${wallet.substring(0, 12)}... -> ${winner}`);
    } catch (err: any) {
      results.push({
        wallet,
        ui_pnl,
        v23c_pnl: 0,
        v29_pnl: 0,
        v29_realized_pnl: 0,
        abs_error_usd_v23c: null,
        abs_error_usd_v29: null,
        pct_error_safe_v23c: null,
        pct_error_safe_v29: null,
        winner: 'NO_UI',
        error: err.message,
      });
      console.log(`  ❌ ${wallet.substring(0, 12)}... -> ERROR: ${err.message}`);
    }
  }

  const calcDuration = Date.now() - startCalc;
  console.log(`\n✅ Calculations complete in ${calcDuration}ms\n`);

  // Step 4: Write results
  console.log('STEP 4: Writing results...');
  const outputPath = config.output || `./tmp/v23c_vs_v29_trader_strict_fast_${config.limit}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`  Wrote results to ${outputPath}`);
  console.log('');

  // Step 5: Summary
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log('');

  const withUI = results.filter(r => r.ui_pnl !== null && !r.error);
  const v23cWins = withUI.filter(r => r.winner === 'V23C').length;
  const v29Wins = withUI.filter(r => r.winner === 'V29').length;
  const ties = withUI.filter(r => r.winner === 'TIE').length;
  const noUI = results.filter(r => r.winner === 'NO_UI').length;
  const errors = results.filter(r => r.error).length;
  const nearZeroUI = withUI.filter(r => Math.abs(r.ui_pnl!) < 100).length;

  console.log(`Total Wallets: ${results.length}`);
  console.log(`  With UI Benchmarks: ${withUI.length}`);
  console.log(`  No UI Benchmarks: ${noUI}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Near-Zero UI (<$100): ${nearZeroUI}`);
  console.log('');

  if (withUI.length > 0) {
    console.log('Winner Breakdown:');
    console.log(`  🟢 V23C Wins: ${v23cWins} (${((v23cWins / withUI.length) * 100).toFixed(1)}%)`);
    console.log(`  🔵 V29 Wins:  ${v29Wins} (${((v29Wins / withUI.length) * 100).toFixed(1)}%)`);
    console.log(`  ⚪ Ties:      ${ties} (${((ties / withUI.length) * 100).toFixed(1)}%)`);
    console.log('');

    // Error statistics
    const v23cErrors = withUI.map(r => r.abs_error_usd_v23c!);
    const v29Errors = withUI.map(r => r.abs_error_usd_v29!);

    console.log('Absolute Error USD (V23C):');
    console.log(`  Median: ${formatPnL(median(v23cErrors))}`);
    console.log(`  P90:    ${formatPnL(percentile(v23cErrors, 90))}`);
    console.log('');

    console.log('Absolute Error USD (V29):');
    console.log(`  Median: ${formatPnL(median(v29Errors))}`);
    console.log(`  P90:    ${formatPnL(percentile(v29Errors, 90))}`);
    console.log('');

    // Performance stats
    console.log('Performance:');
    console.log(`  Total Time: ${(preloadDuration + calcDuration)}ms`);
    console.log(`    Preload: ${preloadDuration}ms`);
    console.log(`    Calculation: ${calcDuration}ms`);
    console.log(`  Per-Wallet Avg: ${((preloadDuration + calcDuration) / wallets.length).toFixed(0)}ms`);
    console.log('');

    // Verdict
    if (v23cWins > v29Wins) {
      const advantage = ((v23cWins - v29Wins) / withUI.length) * 100;
      console.log(`🎯 VERDICT: V23C outperforms V29 by ${advantage.toFixed(1)}%`);
    } else if (v29Wins > v23cWins) {
      const advantage = ((v29Wins - v23cWins) / withUI.length) * 100;
      console.log(`🎯 VERDICT: V29 outperforms V23C by ${advantage.toFixed(1)}%`);
    } else {
      console.log(`🎯 VERDICT: V23C and V29 perform equally`);
    }
    console.log('');

    // Check if V29 is losing badly
    const v29MedianError = median(v29Errors);
    const v23cMedianError = median(v23cErrors);

    if (v29MedianError > v23cMedianError * 1.5) {
      console.log('⚠️  V29 LOSING BADLY - Top 5 Worst Wallets:');
      console.log('');
      console.log('Wallet           | UI Benchmark | V29 PnL      | V23C PnL     | V29 Error    | V23C Error');
      console.log('-'.repeat(110));

      const worst = [...withUI]
        .sort((a, b) => (b.abs_error_usd_v29 || 0) - (a.abs_error_usd_v29 || 0))
        .slice(0, 5);

      for (const r of worst) {
        console.log(
          `${r.wallet.substring(0, 15)}... | ${formatPnL(r.ui_pnl).padStart(12)} | ${formatPnL(r.v29_pnl).padStart(12)} | ${formatPnL(r.v23c_pnl).padStart(12)} | ${formatPnL(r.abs_error_usd_v29).padStart(12)} | ${formatPnL(r.abs_error_usd_v23c).padStart(12)}`
        );
      }
      console.log('');
      console.log('🔍 Flag these wallets for forensic follow-up');
      console.log('');
    }
  } else {
    console.log('⚠️  No UI benchmarks available - cannot determine winner');
  }

  console.log('═'.repeat(100));
  console.log(`Terminal 1 | ${new Date().toISOString()}`);
  console.log('═'.repeat(100));
}

main().catch(console.error);
