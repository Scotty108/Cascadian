/**
 * ============================================================================
 * Test Display Layer vs V20 Against Benchmark
 * ============================================================================
 *
 * Compares both V20 PnL and the new Display Layer against the fresh benchmark
 * to measure improvement from mark-to-market pricing.
 *
 * Usage:
 *   npx tsx scripts/pnl/test-display-layer-benchmark.ts
 *   npx tsx scripts/pnl/test-display-layer-benchmark.ts --set=fresh_2025_12_04_alltime
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import { getWalletPnlDisplay, DisplayPnL, PnLMode } from '../../lib/pnl/pnlDisplayLayer';

interface BenchmarkRow {
  wallet: string;
  pnl_value: number;
  benchmark_set: string;
  captured_at: string;
  note: string;
}

interface ComparisonResult {
  wallet: string;
  ui_pnl: number;
  v20_pnl: number;
  display_pnl: number;
  v20_error_pct: number;
  display_error_pct: number;
  v20_passed: boolean;
  display_passed: boolean;
  mode: PnLMode;
  positions_open: number;
  positions_resolved: number;
  open_notional: number;
  improvement: number; // positive = display is better
  note: string;
}

const ERROR_THRESHOLD = 5; // 5% error threshold

async function getBenchmarks(benchmarkSet?: string): Promise<BenchmarkRow[]> {
  const setsResult = await clickhouse.query({
    query: `
      SELECT benchmark_set, count() as cnt, max(captured_at) as latest
      FROM pm_ui_pnl_benchmarks_v1
      GROUP BY benchmark_set
      ORDER BY latest DESC
    `,
    format: 'JSONEachRow',
  });
  const sets = (await setsResult.json()) as any[];

  if (sets.length === 0) {
    console.log('No benchmark sets found');
    return [];
  }

  const targetSet = benchmarkSet || sets[0].benchmark_set;

  console.log('Available benchmark sets:');
  sets.forEach((s: any) => {
    const marker = s.benchmark_set === targetSet ? ' <-- USING' : '';
    console.log(`  ${s.benchmark_set}: ${s.cnt} wallets (${s.latest})${marker}`);
  });
  console.log('');

  const result = await clickhouse.query({
    query: `
      SELECT wallet, pnl_value, benchmark_set, captured_at, note
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = {set:String}
    `,
    query_params: { set: targetSet },
    format: 'JSONEachRow',
  });

  return (await result.json()) as BenchmarkRow[];
}

function calculateError(actual: number, expected: number): number {
  if (expected === 0 && actual === 0) return 0;
  if (expected === 0) return 100;
  return Math.abs((actual - expected) / expected) * 100;
}

function formatPnl(pnl: number): string {
  const sign = pnl < 0 ? '-' : '+';
  const abs = Math.abs(pnl);
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}K`;
  } else {
    return `${sign}$${abs.toFixed(2)}`;
  }
}

async function runComparison(benchmarkSet?: string): Promise<void> {
  console.log('='.repeat(80));
  console.log('V20 vs DISPLAY LAYER BENCHMARK COMPARISON');
  console.log('='.repeat(80));
  console.log('');

  const benchmarks = await getBenchmarks(benchmarkSet);
  if (benchmarks.length === 0) {
    console.log('ERROR: No benchmarks found.');
    process.exit(1);
  }

  console.log(`Testing ${benchmarks.length} wallets...`);
  console.log('');

  const results: ComparisonResult[] = [];
  let processed = 0;

  for (const bench of benchmarks) {
    try {
      // Get V20 result
      const v20Result = await calculateV20PnL(bench.wallet);
      const v20Pnl = v20Result.total_pnl;

      // Get Display Layer result
      const displayResult = await getWalletPnlDisplay(bench.wallet);
      const displayPnl = displayResult.displayed_pnl;

      const uiPnl = bench.pnl_value;

      // Calculate errors
      const v20Error = calculateError(v20Pnl, uiPnl);
      const displayError = calculateError(displayPnl, uiPnl);

      const v20Passed = v20Error < ERROR_THRESHOLD;
      const displayPassed = displayError < ERROR_THRESHOLD;

      // Improvement: positive means display is better (smaller error)
      const improvement = v20Error - displayError;

      results.push({
        wallet: bench.wallet,
        ui_pnl: uiPnl,
        v20_pnl: v20Pnl,
        display_pnl: displayPnl,
        v20_error_pct: v20Error,
        display_error_pct: displayError,
        v20_passed: v20Passed,
        display_passed: displayPassed,
        mode: displayResult.mode,
        positions_open: displayResult.positions_open,
        positions_resolved: displayResult.positions_resolved,
        open_notional: displayResult.open_notional,
        improvement,
        note: bench.note || '',
      });

      processed++;
      if (processed % 5 === 0) {
        process.stdout.write(`\rProcessed ${processed}/${benchmarks.length}...`);
      }
    } catch (e) {
      console.error(`\nError processing ${bench.wallet}:`, e);
      results.push({
        wallet: bench.wallet,
        ui_pnl: bench.pnl_value,
        v20_pnl: 0,
        display_pnl: 0,
        v20_error_pct: 100,
        display_error_pct: 100,
        v20_passed: false,
        display_passed: false,
        mode: 'realized_only',
        positions_open: 0,
        positions_resolved: 0,
        open_notional: 0,
        improvement: 0,
        note: `ERROR: ${e instanceof Error ? e.message : 'Unknown'}`,
      });
    }
  }

  console.log('\r' + ' '.repeat(50));
  console.log('');

  // Summary stats
  const v20Passed = results.filter((r) => r.v20_passed);
  const displayPassed = results.filter((r) => r.display_passed);

  const v20PassRate = ((v20Passed.length / results.length) * 100).toFixed(1);
  const displayPassRate = ((displayPassed.length / results.length) * 100).toFixed(1);

  const v20Errors = results.map((r) => r.v20_error_pct).filter((e) => e < 100);
  const displayErrors = results.map((r) => r.display_error_pct).filter((e) => e < 100);

  const v20MeanError = v20Errors.length > 0 ? v20Errors.reduce((a, b) => a + b, 0) / v20Errors.length : 0;
  const displayMeanError = displayErrors.length > 0 ? displayErrors.reduce((a, b) => a + b, 0) / displayErrors.length : 0;

  const v20MedianError = v20Errors.length > 0 ? v20Errors.sort((a, b) => a - b)[Math.floor(v20Errors.length / 2)] : 0;
  const displayMedianError = displayErrors.length > 0 ? displayErrors.sort((a, b) => a - b)[Math.floor(displayErrors.length / 2)] : 0;

  // Wallets where display layer was used
  const mtmWallets = results.filter((r) => r.mode === 'realized_plus_mark');

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('                         V20          Display Layer    Improvement');
  console.log('-'.repeat(80));
  console.log(`Pass Rate (<${ERROR_THRESHOLD}%):       ${v20PassRate.padStart(6)}%        ${displayPassRate.padStart(6)}%           ${(Number(displayPassRate) - Number(v20PassRate)).toFixed(1)}%`);
  console.log(`Mean Error:            ${v20MeanError.toFixed(2).padStart(6)}%        ${displayMeanError.toFixed(2).padStart(6)}%           ${(v20MeanError - displayMeanError).toFixed(2)}%`);
  console.log(`Median Error:          ${v20MedianError.toFixed(2).padStart(6)}%        ${displayMedianError.toFixed(2).padStart(6)}%           ${(v20MedianError - displayMedianError).toFixed(2)}%`);
  console.log('');
  console.log(`Wallets using mark-to-market: ${mtmWallets.length}/${results.length}`);
  console.log('');

  // Show wallets where display layer improved things
  const improved = results.filter((r) => r.improvement > 1); // At least 1% improvement
  const degraded = results.filter((r) => r.improvement < -1); // At least 1% worse

  if (improved.length > 0) {
    console.log('='.repeat(80));
    console.log(`IMPROVED WALLETS (${improved.length})`);
    console.log('='.repeat(80));
    improved.sort((a, b) => b.improvement - a.improvement);
    for (const r of improved.slice(0, 15)) {
      const walletShort = r.wallet.slice(0, 10) + '...';
      const uiStr = formatPnl(r.ui_pnl).padStart(12);
      const v20Str = formatPnl(r.v20_pnl).padStart(12);
      const dispStr = formatPnl(r.display_pnl).padStart(12);
      const impStr = `+${r.improvement.toFixed(1)}%`.padStart(8);
      console.log(`${walletShort}  UI:${uiStr}  V20:${v20Str}  Disp:${dispStr}  Imp:${impStr}  ${r.mode}`);
    }
    console.log('');
  }

  if (degraded.length > 0) {
    console.log('='.repeat(80));
    console.log(`DEGRADED WALLETS (${degraded.length})`);
    console.log('='.repeat(80));
    degraded.sort((a, b) => a.improvement - b.improvement);
    for (const r of degraded.slice(0, 10)) {
      const walletShort = r.wallet.slice(0, 10) + '...';
      const uiStr = formatPnl(r.ui_pnl).padStart(12);
      const v20Str = formatPnl(r.v20_pnl).padStart(12);
      const dispStr = formatPnl(r.display_pnl).padStart(12);
      const impStr = `${r.improvement.toFixed(1)}%`.padStart(8);
      console.log(`${walletShort}  UI:${uiStr}  V20:${v20Str}  Disp:${dispStr}  Imp:${impStr}  ${r.mode}`);
    }
    console.log('');
  }

  // Show all failures
  const allFailed = results.filter((r) => !r.display_passed);
  if (allFailed.length > 0) {
    console.log('='.repeat(80));
    console.log(`STILL FAILING (${allFailed.length})`);
    console.log('='.repeat(80));
    allFailed.sort((a, b) => b.display_error_pct - a.display_error_pct);
    for (const r of allFailed.slice(0, 20)) {
      const walletShort = r.wallet.slice(0, 10) + '...';
      const uiStr = formatPnl(r.ui_pnl).padStart(12);
      const dispStr = formatPnl(r.display_pnl).padStart(12);
      const errStr = r.display_error_pct.toFixed(1).padStart(6) + '%';
      const openStr = `${r.positions_open}/${r.positions_open + r.positions_resolved}`.padStart(8);
      console.log(`${walletShort}  UI:${uiStr}  Disp:${dispStr}  Err:${errStr}  Open:${openStr}  ${r.mode}`);
    }
    console.log('');
  }

  // Final verdict
  console.log('='.repeat(80));
  const passImproved = Number(displayPassRate) > Number(v20PassRate);
  const errorImproved = displayMeanError < v20MeanError;

  if (passImproved && errorImproved) {
    console.log('RESULT: Display Layer IMPROVED accuracy');
    console.log(`  Pass rate: ${v20PassRate}% -> ${displayPassRate}% (+${(Number(displayPassRate) - Number(v20PassRate)).toFixed(1)}%)`);
    console.log(`  Mean error: ${v20MeanError.toFixed(2)}% -> ${displayMeanError.toFixed(2)}% (${(displayMeanError - v20MeanError).toFixed(2)}%)`);
  } else if (passImproved || errorImproved) {
    console.log('RESULT: Display Layer PARTIALLY improved accuracy');
  } else {
    console.log('RESULT: Display Layer did NOT improve accuracy');
    console.log('  (This may indicate the failures are NOT due to unrealized positions)');
  }
  console.log('='.repeat(80));

  // Save detailed results
  const outputPath = `/tmp/display-layer-comparison-${Date.now()}.json`;
  const fs = await import('fs');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        benchmark_set: benchmarks[0]?.benchmark_set,
        summary: {
          total: results.length,
          v20_passed: v20Passed.length,
          display_passed: displayPassed.length,
          v20_pass_rate: Number(v20PassRate),
          display_pass_rate: Number(displayPassRate),
          v20_mean_error: v20MeanError,
          display_mean_error: displayMeanError,
          mtm_wallets: mtmWallets.length,
          improved: improved.length,
          degraded: degraded.length,
        },
        results,
      },
      null,
      2
    )
  );
  console.log(`\nDetailed results saved to: ${outputPath}`);
}

// Parse command line args
const args = process.argv.slice(2);
let benchmarkSet: string | undefined;
for (const arg of args) {
  if (arg.startsWith('--set=')) {
    benchmarkSet = arg.slice(6);
  }
}

runComparison(benchmarkSet).catch(console.error);
