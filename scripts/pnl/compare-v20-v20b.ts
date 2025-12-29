/**
 * ============================================================================
 * Compare V20 vs V20b Against Benchmark
 * ============================================================================
 *
 * Compares V20 (CLOB only) vs V20b (CLOB + filtered PayoutRedemption) against
 * the benchmark to measure improvement.
 *
 * V20b includes PayoutRedemption ONLY for positions that have CLOB trades,
 * avoiding the overcounting issue from V20a.
 *
 * Usage:
 *   npx tsx scripts/pnl/compare-v20-v20b.ts
 *   npx tsx scripts/pnl/compare-v20-v20b.ts --set=fresh_2025_12_04_alltime
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import { calculateV20bPnL } from '../../lib/pnl/uiActivityEngineV20b';

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
  v20b_pnl: number;
  v20_error_pct: number;
  v20b_error_pct: number;
  v20_passed: boolean;
  v20b_passed: boolean;
  improvement: number; // positive = V20b is better
  redemption_only_positions: number;
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
  console.log('V20 vs V20b BENCHMARK COMPARISON');
  console.log('='.repeat(80));
  console.log('');
  console.log('V20:  CLOB only (canonical)');
  console.log('V20b: CLOB + PayoutRedemption (for CLOB positions only)');
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
      // Get V20 result (CLOB only)
      const v20Result = await calculateV20PnL(bench.wallet);
      const v20Pnl = v20Result.total_pnl;

      // Get V20b result (CLOB + filtered PayoutRedemption)
      const v20bResult = await calculateV20bPnL(bench.wallet);
      const v20bPnl = v20bResult.total_pnl;

      const uiPnl = bench.pnl_value;

      // Calculate errors
      const v20Error = calculateError(v20Pnl, uiPnl);
      const v20bError = calculateError(v20bPnl, uiPnl);

      const v20Passed = v20Error < ERROR_THRESHOLD;
      const v20bPassed = v20bError < ERROR_THRESHOLD;

      // Improvement: positive means V20b is better (smaller error)
      const improvement = v20Error - v20bError;

      results.push({
        wallet: bench.wallet,
        ui_pnl: uiPnl,
        v20_pnl: v20Pnl,
        v20b_pnl: v20bPnl,
        v20_error_pct: v20Error,
        v20b_error_pct: v20bError,
        v20_passed: v20Passed,
        v20b_passed: v20bPassed,
        improvement,
        redemption_only_positions: v20bResult.redemption_only_positions,
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
        v20b_pnl: 0,
        v20_error_pct: 100,
        v20b_error_pct: 100,
        v20_passed: false,
        v20b_passed: false,
        improvement: 0,
        redemption_only_positions: 0,
        note: `ERROR: ${e instanceof Error ? e.message : 'Unknown'}`,
      });
    }
  }

  console.log('\r' + ' '.repeat(50));
  console.log('');

  // Summary stats
  const v20Passed = results.filter((r) => r.v20_passed);
  const v20bPassed = results.filter((r) => r.v20b_passed);

  const v20PassRate = ((v20Passed.length / results.length) * 100).toFixed(1);
  const v20bPassRate = ((v20bPassed.length / results.length) * 100).toFixed(1);

  const v20Errors = results.map((r) => r.v20_error_pct).filter((e) => e < 100);
  const v20bErrors = results.map((r) => r.v20b_error_pct).filter((e) => e < 100);

  const v20MeanError = v20Errors.length > 0 ? v20Errors.reduce((a, b) => a + b, 0) / v20Errors.length : 0;
  const v20bMeanError = v20bErrors.length > 0 ? v20bErrors.reduce((a, b) => a + b, 0) / v20bErrors.length : 0;

  const v20MedianError = v20Errors.length > 0 ? v20Errors.sort((a, b) => a - b)[Math.floor(v20Errors.length / 2)] : 0;
  const v20bMedianError = v20bErrors.length > 0 ? v20bErrors.sort((a, b) => a - b)[Math.floor(v20bErrors.length / 2)] : 0;

  // Stats on redemption-only positions
  const totalRedemptionOnly = results.reduce((sum, r) => sum + r.redemption_only_positions, 0);
  const walletsWithRedemptionOnly = results.filter((r) => r.redemption_only_positions > 0).length;

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('                         V20 (CLOB)     V20b (filtered)  Improvement');
  console.log('-'.repeat(80));
  console.log(`Pass Rate (<${ERROR_THRESHOLD}%):       ${v20PassRate.padStart(6)}%        ${v20bPassRate.padStart(6)}%           ${(Number(v20bPassRate) - Number(v20PassRate)).toFixed(1)}%`);
  console.log(`Mean Error:            ${v20MeanError.toFixed(2).padStart(6)}%        ${v20bMeanError.toFixed(2).padStart(6)}%           ${(v20MeanError - v20bMeanError).toFixed(2)}%`);
  console.log(`Median Error:          ${v20MedianError.toFixed(2).padStart(6)}%        ${v20bMedianError.toFixed(2).padStart(6)}%           ${(v20MedianError - v20bMedianError).toFixed(2)}%`);
  console.log('');
  console.log(`Wallets with redemption-only positions: ${walletsWithRedemptionOnly}`);
  console.log(`Total redemption-only positions skipped: ${totalRedemptionOnly}`);
  console.log('');

  // Show wallets where V20b improved things
  const improved = results.filter((r) => r.improvement > 1); // At least 1% improvement
  const degraded = results.filter((r) => r.improvement < -1); // At least 1% worse

  if (improved.length > 0) {
    console.log('='.repeat(80));
    console.log(`IMPROVED WALLETS (${improved.length})`);
    console.log('='.repeat(80));
    improved.sort((a, b) => b.improvement - a.improvement);
    for (const r of improved.slice(0, 20)) {
      const walletShort = r.wallet.slice(0, 10) + '...';
      const uiStr = formatPnl(r.ui_pnl).padStart(12);
      const v20Str = formatPnl(r.v20_pnl).padStart(12);
      const v20bStr = formatPnl(r.v20b_pnl).padStart(12);
      const impStr = `+${r.improvement.toFixed(1)}%`.padStart(8);
      const v20ErrStr = r.v20_error_pct.toFixed(1).padStart(6) + '%';
      const v20bErrStr = r.v20b_error_pct.toFixed(1).padStart(6) + '%';
      console.log(`${walletShort}  UI:${uiStr}  V20:${v20Str}(${v20ErrStr})  V20b:${v20bStr}(${v20bErrStr})  Imp:${impStr}`);
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
      const v20bStr = formatPnl(r.v20b_pnl).padStart(12);
      const impStr = `${r.improvement.toFixed(1)}%`.padStart(8);
      console.log(`${walletShort}  UI:${uiStr}  V20:${v20Str}  V20b:${v20bStr}  Imp:${impStr}`);
    }
    console.log('');
  }

  // Show all failures
  const stillFailing = results.filter((r) => !r.v20b_passed);
  if (stillFailing.length > 0) {
    console.log('='.repeat(80));
    console.log(`STILL FAILING V20b (${stillFailing.length})`);
    console.log('='.repeat(80));
    stillFailing.sort((a, b) => b.v20b_error_pct - a.v20b_error_pct);
    for (const r of stillFailing.slice(0, 20)) {
      const walletShort = r.wallet.slice(0, 10) + '...';
      const uiStr = formatPnl(r.ui_pnl).padStart(12);
      const v20bStr = formatPnl(r.v20b_pnl).padStart(12);
      const errStr = r.v20b_error_pct.toFixed(1).padStart(6) + '%';
      const skipStr = r.redemption_only_positions > 0 ? ` (${r.redemption_only_positions} skipped)` : '';
      console.log(`${walletShort}  UI:${uiStr}  V20b:${v20bStr}  Err:${errStr}${skipStr}`);
    }
    console.log('');
  }

  // Final verdict
  console.log('='.repeat(80));
  const passImproved = Number(v20bPassRate) > Number(v20PassRate);
  const errorImproved = v20bMeanError < v20MeanError;
  const noRegression = degraded.length === 0;

  if (passImproved && errorImproved && noRegression) {
    console.log('RESULT: V20b IMPROVED accuracy with NO REGRESSIONS');
    console.log(`  Pass rate: ${v20PassRate}% -> ${v20bPassRate}% (+${(Number(v20bPassRate) - Number(v20PassRate)).toFixed(1)}%)`);
    console.log(`  Mean error: ${v20MeanError.toFixed(2)}% -> ${v20bMeanError.toFixed(2)}% (${(v20bMeanError - v20MeanError).toFixed(2)}%)`);
  } else if (passImproved || errorImproved) {
    console.log('RESULT: V20b PARTIALLY improved accuracy');
    console.log(`  Pass rate: ${v20PassRate}% -> ${v20bPassRate}%`);
    console.log(`  Mean error: ${v20MeanError.toFixed(2)}% -> ${v20bMeanError.toFixed(2)}%`);
    if (!noRegression) {
      console.log(`  HOWEVER: ${degraded.length} wallets degraded`);
    }
  } else {
    console.log('RESULT: V20b did NOT improve accuracy');
  }
  console.log('='.repeat(80));

  // Save detailed results
  const outputPath = `/tmp/v20-v20b-comparison-${Date.now()}.json`;
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
          v20b_passed: v20bPassed.length,
          v20_pass_rate: Number(v20PassRate),
          v20b_pass_rate: Number(v20bPassRate),
          v20_mean_error: v20MeanError,
          v20b_mean_error: v20bMeanError,
          improved: improved.length,
          degraded: degraded.length,
          wallets_with_redemption_only: walletsWithRedemptionOnly,
          total_redemption_only_skipped: totalRedemptionOnly,
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
