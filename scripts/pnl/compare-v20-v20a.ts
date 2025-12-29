/**
 * ============================================================================
 * Compare V20 vs V20a Against Benchmark
 * ============================================================================
 *
 * Compares both V20 (CLOB only) and V20a (CLOB + PayoutRedemption) against
 * the benchmark to measure improvement from including redemption events.
 *
 * Usage:
 *   npx tsx scripts/pnl/compare-v20-v20a.ts
 *   npx tsx scripts/pnl/compare-v20-v20a.ts --set=fresh_2025_12_04_alltime
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import { calculateV20aPnL } from '../../lib/pnl/uiActivityEngineV20a';

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
  v20a_pnl: number;
  v20_error_pct: number;
  v20a_error_pct: number;
  v20_passed: boolean;
  v20a_passed: boolean;
  improvement: number; // positive = V20a is better
  v20_positions: number;
  v20a_positions: number;
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
  console.log('V20 vs V20a BENCHMARK COMPARISON');
  console.log('='.repeat(80));
  console.log('');
  console.log('V20:  CLOB only (canonical)');
  console.log('V20a: CLOB + PayoutRedemption (experimental)');
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

      // Get V20a result (CLOB + PayoutRedemption)
      const v20aResult = await calculateV20aPnL(bench.wallet);
      const v20aPnl = v20aResult.total_pnl;

      const uiPnl = bench.pnl_value;

      // Calculate errors
      const v20Error = calculateError(v20Pnl, uiPnl);
      const v20aError = calculateError(v20aPnl, uiPnl);

      const v20Passed = v20Error < ERROR_THRESHOLD;
      const v20aPassed = v20aError < ERROR_THRESHOLD;

      // Improvement: positive means V20a is better (smaller error)
      const improvement = v20Error - v20aError;

      results.push({
        wallet: bench.wallet,
        ui_pnl: uiPnl,
        v20_pnl: v20Pnl,
        v20a_pnl: v20aPnl,
        v20_error_pct: v20Error,
        v20a_error_pct: v20aError,
        v20_passed: v20Passed,
        v20a_passed: v20aPassed,
        improvement,
        v20_positions: v20Result.positions,
        v20a_positions: v20aResult.positions,
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
        v20a_pnl: 0,
        v20_error_pct: 100,
        v20a_error_pct: 100,
        v20_passed: false,
        v20a_passed: false,
        improvement: 0,
        v20_positions: 0,
        v20a_positions: 0,
        note: `ERROR: ${e instanceof Error ? e.message : 'Unknown'}`,
      });
    }
  }

  console.log('\r' + ' '.repeat(50));
  console.log('');

  // Summary stats
  const v20Passed = results.filter((r) => r.v20_passed);
  const v20aPassed = results.filter((r) => r.v20a_passed);

  const v20PassRate = ((v20Passed.length / results.length) * 100).toFixed(1);
  const v20aPassRate = ((v20aPassed.length / results.length) * 100).toFixed(1);

  const v20Errors = results.map((r) => r.v20_error_pct).filter((e) => e < 100);
  const v20aErrors = results.map((r) => r.v20a_error_pct).filter((e) => e < 100);

  const v20MeanError = v20Errors.length > 0 ? v20Errors.reduce((a, b) => a + b, 0) / v20Errors.length : 0;
  const v20aMeanError = v20aErrors.length > 0 ? v20aErrors.reduce((a, b) => a + b, 0) / v20aErrors.length : 0;

  const v20MedianError = v20Errors.length > 0 ? v20Errors.sort((a, b) => a - b)[Math.floor(v20Errors.length / 2)] : 0;
  const v20aMedianError = v20aErrors.length > 0 ? v20aErrors.sort((a, b) => a - b)[Math.floor(v20aErrors.length / 2)] : 0;

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('                         V20 (CLOB)     V20a (+Redemp)   Improvement');
  console.log('-'.repeat(80));
  console.log(`Pass Rate (<${ERROR_THRESHOLD}%):       ${v20PassRate.padStart(6)}%        ${v20aPassRate.padStart(6)}%           ${(Number(v20aPassRate) - Number(v20PassRate)).toFixed(1)}%`);
  console.log(`Mean Error:            ${v20MeanError.toFixed(2).padStart(6)}%        ${v20aMeanError.toFixed(2).padStart(6)}%           ${(v20MeanError - v20aMeanError).toFixed(2)}%`);
  console.log(`Median Error:          ${v20MedianError.toFixed(2).padStart(6)}%        ${v20aMedianError.toFixed(2).padStart(6)}%           ${(v20MedianError - v20aMedianError).toFixed(2)}%`);
  console.log('');

  // Show wallets where V20a improved things
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
      const v20aStr = formatPnl(r.v20a_pnl).padStart(12);
      const impStr = `+${r.improvement.toFixed(1)}%`.padStart(8);
      const v20ErrStr = r.v20_error_pct.toFixed(1).padStart(6) + '%';
      const v20aErrStr = r.v20a_error_pct.toFixed(1).padStart(6) + '%';
      console.log(`${walletShort}  UI:${uiStr}  V20:${v20Str}(${v20ErrStr})  V20a:${v20aStr}(${v20aErrStr})  Imp:${impStr}`);
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
      const v20aStr = formatPnl(r.v20a_pnl).padStart(12);
      const impStr = `${r.improvement.toFixed(1)}%`.padStart(8);
      console.log(`${walletShort}  UI:${uiStr}  V20:${v20Str}  V20a:${v20aStr}  Imp:${impStr}`);
    }
    console.log('');
  }

  // Show all failures
  const stillFailing = results.filter((r) => !r.v20a_passed);
  if (stillFailing.length > 0) {
    console.log('='.repeat(80));
    console.log(`STILL FAILING V20a (${stillFailing.length})`);
    console.log('='.repeat(80));
    stillFailing.sort((a, b) => b.v20a_error_pct - a.v20a_error_pct);
    for (const r of stillFailing.slice(0, 20)) {
      const walletShort = r.wallet.slice(0, 10) + '...';
      const uiStr = formatPnl(r.ui_pnl).padStart(12);
      const v20aStr = formatPnl(r.v20a_pnl).padStart(12);
      const errStr = r.v20a_error_pct.toFixed(1).padStart(6) + '%';
      const posStr = `${r.v20a_positions}`.padStart(6);
      console.log(`${walletShort}  UI:${uiStr}  V20a:${v20aStr}  Err:${errStr}  Pos:${posStr}`);
    }
    console.log('');
  }

  // Final verdict
  console.log('='.repeat(80));
  const passImproved = Number(v20aPassRate) > Number(v20PassRate);
  const errorImproved = v20aMeanError < v20MeanError;

  if (passImproved && errorImproved) {
    console.log('RESULT: V20a IMPROVED accuracy');
    console.log(`  Pass rate: ${v20PassRate}% -> ${v20aPassRate}% (+${(Number(v20aPassRate) - Number(v20PassRate)).toFixed(1)}%)`);
    console.log(`  Mean error: ${v20MeanError.toFixed(2)}% -> ${v20aMeanError.toFixed(2)}% (${(v20aMeanError - v20MeanError).toFixed(2)}%)`);
  } else if (passImproved || errorImproved) {
    console.log('RESULT: V20a PARTIALLY improved accuracy');
    console.log(`  Pass rate: ${v20PassRate}% -> ${v20aPassRate}%`);
    console.log(`  Mean error: ${v20MeanError.toFixed(2)}% -> ${v20aMeanError.toFixed(2)}%`);
  } else {
    console.log('RESULT: V20a did NOT improve accuracy');
    console.log('  (PayoutRedemption events may not be the issue)');
  }
  console.log('='.repeat(80));

  // Save detailed results
  const outputPath = `/tmp/v20-v20a-comparison-${Date.now()}.json`;
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
          v20a_passed: v20aPassed.length,
          v20_pass_rate: Number(v20PassRate),
          v20a_pass_rate: Number(v20aPassRate),
          v20_mean_error: v20MeanError,
          v20a_mean_error: v20aMeanError,
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
