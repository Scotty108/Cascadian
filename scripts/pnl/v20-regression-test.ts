/**
 * ============================================================================
 * V20 PNL Regression Test
 * ============================================================================
 *
 * This is the canonical regression test for the V20 PnL engine.
 * Run this before any PnL-related changes to verify accuracy.
 *
 * Usage:
 *   npx tsx scripts/pnl/v20-regression-test.ts
 *   npx tsx scripts/pnl/v20-regression-test.ts --set=fresh_2025_12_04
 *
 * Expected Results:
 *   - 90%+ of wallets should pass (< 5% error)
 *   - Mean error < 2% for fresh benchmarks
 *   - All top-15 leaderboard wallets within 2%
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

interface BenchmarkRow {
  wallet: string;
  pnl_value: number;
  benchmark_set: string;
  captured_at: string;
  note: string;
}

interface TestResult {
  wallet: string;
  ui_pnl: number;
  v20_pnl: number;
  error_pct: number;
  passed: boolean;
  note: string;
}

const ERROR_THRESHOLD = 5; // 5% error threshold for pass/fail

async function getBenchmarks(benchmarkSet?: string): Promise<BenchmarkRow[]> {
  // Get available benchmark sets
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
    console.log('No benchmark sets found in pm_ui_pnl_benchmarks_v1');
    return [];
  }

  // Use provided set or most recent
  const targetSet = benchmarkSet || sets[0].benchmark_set;

  console.log('Available benchmark sets:');
  sets.forEach((s: any) => {
    const marker = s.benchmark_set === targetSet ? ' <-- USING' : '';
    console.log(`  ${s.benchmark_set}: ${s.cnt} wallets (${s.latest})${marker}`);
  });
  console.log('');

  // Fetch benchmarks
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

async function runTest(benchmarkSet?: string): Promise<void> {
  console.log('='.repeat(70));
  console.log('V20 PNL REGRESSION TEST');
  console.log('='.repeat(70));
  console.log('');

  const benchmarks = await getBenchmarks(benchmarkSet);
  if (benchmarks.length === 0) {
    console.log('ERROR: No benchmarks found. Run capture script first.');
    process.exit(1);
  }

  console.log(`Testing ${benchmarks.length} wallets...`);
  console.log('');

  const results: TestResult[] = [];
  let processed = 0;

  for (const bench of benchmarks) {
    try {
      const v20Result = await calculateV20PnL(bench.wallet);
      const v20Pnl = v20Result.total_pnl;
      const uiPnl = bench.pnl_value;

      // Calculate error
      let errorPct = 0;
      if (uiPnl === 0 && v20Pnl === 0) {
        errorPct = 0;
      } else if (uiPnl === 0) {
        errorPct = 100;
      } else {
        errorPct = Math.abs((v20Pnl - uiPnl) / uiPnl) * 100;
      }

      const passed = errorPct < ERROR_THRESHOLD;

      results.push({
        wallet: bench.wallet,
        ui_pnl: uiPnl,
        v20_pnl: v20Pnl,
        error_pct: errorPct,
        passed,
        note: bench.note || '',
      });

      processed++;
      if (processed % 10 === 0) {
        process.stdout.write(`\rProcessed ${processed}/${benchmarks.length}...`);
      }
    } catch (e) {
      results.push({
        wallet: bench.wallet,
        ui_pnl: bench.pnl_value,
        v20_pnl: 0,
        error_pct: 100,
        passed: false,
        note: `ERROR: ${e instanceof Error ? e.message : 'Unknown'}`,
      });
    }
  }

  console.log('\r' + ' '.repeat(50));

  // Summary
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);
  const passRate = ((passed.length / results.length) * 100).toFixed(1);

  const errors = results.map((r) => r.error_pct).filter((e) => e < 100);
  const meanError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
  const medianError = errors.length > 0 ? errors.sort((a, b) => a - b)[Math.floor(errors.length / 2)] : 0;

  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Total wallets:  ${results.length}`);
  console.log(`Passed (<${ERROR_THRESHOLD}%): ${passed.length} (${passRate}%)`);
  console.log(`Failed:         ${failed.length}`);
  console.log('');
  console.log(`Mean error:     ${meanError.toFixed(2)}%`);
  console.log(`Median error:   ${medianError.toFixed(2)}%`);
  console.log('');

  // Show failures
  if (failed.length > 0) {
    console.log('FAILED WALLETS:');
    console.log('-'.repeat(70));

    // Sort by error descending
    failed.sort((a, b) => b.error_pct - a.error_pct);

    for (const f of failed.slice(0, 20)) {
      const walletShort = f.wallet.slice(0, 10) + '...';
      const uiStr = formatPnl(f.ui_pnl).padStart(12);
      const v20Str = formatPnl(f.v20_pnl).padStart(12);
      const errStr = f.error_pct.toFixed(1).padStart(6) + '%';
      console.log(`${walletShort}  UI:${uiStr}  V20:${v20Str}  Err:${errStr}  ${f.note}`);
    }

    if (failed.length > 20) {
      console.log(`... and ${failed.length - 20} more`);
    }
    console.log('');
  }

  // Show top performers
  console.log('TOP 10 ACCURATE:');
  console.log('-'.repeat(70));
  const topPassed = results.filter((r) => r.error_pct < 100).sort((a, b) => a.error_pct - b.error_pct);
  for (const p of topPassed.slice(0, 10)) {
    const walletShort = p.wallet.slice(0, 10) + '...';
    const uiStr = formatPnl(p.ui_pnl).padStart(12);
    const v20Str = formatPnl(p.v20_pnl).padStart(12);
    const errStr = p.error_pct.toFixed(2).padStart(6) + '%';
    console.log(`${walletShort}  UI:${uiStr}  V20:${v20Str}  Err:${errStr}`);
  }
  console.log('');

  // Final verdict
  console.log('='.repeat(70));
  if (Number(passRate) >= 90 && meanError < 5) {
    console.log('REGRESSION TEST: PASSED');
  } else if (Number(passRate) >= 70) {
    console.log('REGRESSION TEST: WARNING (some degradation)');
  } else {
    console.log('REGRESSION TEST: FAILED');
  }
  console.log('='.repeat(70));

  // Save results
  const outputPath = `/tmp/v20-regression-${Date.now()}.json`;
  const fs = await import('fs');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        benchmark_set: benchmarks[0]?.benchmark_set,
        summary: {
          total: results.length,
          passed: passed.length,
          failed: failed.length,
          pass_rate: Number(passRate),
          mean_error: meanError,
          median_error: medianError,
        },
        results,
      },
      null,
      2
    )
  );
  console.log(`\nResults saved to: ${outputPath}`);
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

// Parse command line args
const args = process.argv.slice(2);
let benchmarkSet: string | undefined;
for (const arg of args) {
  if (arg.startsWith('--set=')) {
    benchmarkSet = arg.slice(6);
  }
}

runTest(benchmarkSet).catch(console.error);
