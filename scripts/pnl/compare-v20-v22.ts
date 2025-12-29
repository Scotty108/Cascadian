/**
 * ============================================================================
 * Compare V20 vs V22 PnL Engines
 * ============================================================================
 *
 * Benchmarks V20 (CLOB-only) against V22 (dual-formula with source_type splits)
 * using the UI PnL benchmark table.
 *
 * HYPOTHESIS:
 *   V22 should improve accuracy for wallets with non-CLOB activity by:
 *   - Using pure cash_flow for closed positions (avoids double-counting)
 *   - Including all source types (CLOB, PayoutRedemption, PositionsMerge)
 *
 * Usage:
 *   npx tsx scripts/pnl/compare-v20-v22.ts
 *   npx tsx scripts/pnl/compare-v20-v22.ts --set=fresh_2025_12_04_alltime
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import { calculateV22PnL } from '../../lib/pnl/uiActivityEngineV22';
import { getWalletConfidence, WalletConfidence } from '../../lib/pnl/getWalletConfidence';
import * as fs from 'fs';

interface BenchmarkRow {
  wallet: string;
  pnl_value: number;
  benchmark_set: string;
  note: string;
}

interface ComparisonResult {
  wallet: string;
  ui_pnl: number;
  v20_pnl: number;
  v22_pnl: number;
  v20_error_pct: number;
  v22_error_pct: number;
  v20_passes: boolean;
  v22_passes: boolean;
  improvement: boolean; // V22 better than V20
  regression: boolean;  // V22 worse than V20
  confidence: WalletConfidence;
  v22_breakdown: {
    closed_pnl: number;
    open_resolved_pnl: number;
    open_unresolved_pnl: number;
    clob_usdc: number;
    redemption_usdc: number;
    merge_usdc: number;
  };
}

const ERROR_THRESHOLD = 5; // 5% error threshold for pass/fail

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
      SELECT wallet, pnl_value, benchmark_set, note
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

async function compareWallet(wallet: string, uiPnl: number): Promise<ComparisonResult> {
  const [v20Result, v22Result, confidence] = await Promise.all([
    calculateV20PnL(wallet),
    calculateV22PnL(wallet),
    getWalletConfidence(wallet),
  ]);

  const v20Error = calculateError(v20Result.total_pnl, uiPnl);
  const v22Error = calculateError(v22Result.total_pnl, uiPnl);

  const v20Passes = v20Error < ERROR_THRESHOLD;
  const v22Passes = v22Error < ERROR_THRESHOLD;

  return {
    wallet,
    ui_pnl: uiPnl,
    v20_pnl: v20Result.total_pnl,
    v22_pnl: v22Result.total_pnl,
    v20_error_pct: v20Error,
    v22_error_pct: v22Error,
    v20_passes: v20Passes,
    v22_passes: v22Passes,
    improvement: !v20Passes && v22Passes,
    regression: v20Passes && !v22Passes,
    confidence,
    v22_breakdown: {
      closed_pnl: v22Result.closed_pnl,
      open_resolved_pnl: v22Result.open_resolved_pnl,
      open_unresolved_pnl: v22Result.open_unresolved_pnl,
      clob_usdc: v22Result.clob_usdc,
      redemption_usdc: v22Result.redemption_usdc,
      merge_usdc: v22Result.merge_usdc,
    },
  };
}

async function main(benchmarkSet?: string): Promise<void> {
  console.log('='.repeat(80));
  console.log('V20 vs V22 PnL ENGINE COMPARISON');
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
      const result = await compareWallet(bench.wallet, bench.pnl_value);
      results.push(result);

      processed++;
      if (processed % 5 === 0) {
        process.stdout.write(`\rProcessed ${processed}/${benchmarks.length}...`);
      }
    } catch (e) {
      console.error(`\nError processing ${bench.wallet}:`, e);
    }
  }

  console.log('\r' + ' '.repeat(50));
  console.log('');

  // Calculate summary stats
  const v20PassCount = results.filter((r) => r.v20_passes).length;
  const v22PassCount = results.filter((r) => r.v22_passes).length;
  const improvements = results.filter((r) => r.improvement).length;
  const regressions = results.filter((r) => r.regression).length;

  const v20PassRate = ((v20PassCount / results.length) * 100).toFixed(1);
  const v22PassRate = ((v22PassCount / results.length) * 100).toFixed(1);

  console.log('='.repeat(80));
  console.log('OVERALL RESULTS');
  console.log('='.repeat(80));
  console.log('');
  console.log(`V20 pass rate: ${v20PassRate}% (${v20PassCount}/${results.length})`);
  console.log(`V22 pass rate: ${v22PassRate}% (${v22PassCount}/${results.length})`);
  console.log('');
  console.log(`Improvements (V22 fixed):   ${improvements}`);
  console.log(`Regressions (V22 broke):    ${regressions}`);
  console.log('');

  // Results by confidence level
  const byLevel: Record<string, ComparisonResult[]> = { HIGH: [], MEDIUM: [], LOW: [] };
  for (const r of results) {
    byLevel[r.confidence.confidence_level].push(r);
  }

  console.log('='.repeat(80));
  console.log('RESULTS BY CONFIDENCE LEVEL');
  console.log('='.repeat(80));
  console.log('');
  console.log(
    'Level'.padEnd(10),
    'Count'.padStart(8),
    'V20 Pass'.padStart(12),
    'V22 Pass'.padStart(12),
    'Improved'.padStart(12),
    'Regressed'.padStart(12)
  );
  console.log('-'.repeat(70));

  for (const level of ['HIGH', 'MEDIUM', 'LOW'] as const) {
    const group = byLevel[level];
    const v20Pass = group.filter((r) => r.v20_passes).length;
    const v22Pass = group.filter((r) => r.v22_passes).length;
    const improved = group.filter((r) => r.improvement).length;
    const regressed = group.filter((r) => r.regression).length;

    const v20Pct = group.length > 0 ? `${((v20Pass / group.length) * 100).toFixed(0)}%` : '-';
    const v22Pct = group.length > 0 ? `${((v22Pass / group.length) * 100).toFixed(0)}%` : '-';

    console.log(
      level.padEnd(10),
      String(group.length).padStart(8),
      `${v20Pct} (${v20Pass})`.padStart(12),
      `${v22Pct} (${v22Pass})`.padStart(12),
      String(improved).padStart(12),
      String(regressed).padStart(12)
    );
  }
  console.log('');

  // Show detail for interesting cases
  if (improvements > 0) {
    console.log('='.repeat(80));
    console.log(`IMPROVEMENTS (V22 fixed ${improvements} wallets)`);
    console.log('='.repeat(80));
    console.log('');
    console.log(
      'wallet'.padEnd(14),
      'ui_pnl'.padStart(12),
      'v20_pnl'.padStart(12),
      'v22_pnl'.padStart(12),
      'v20_err'.padStart(10),
      'v22_err'.padStart(10)
    );
    console.log('-'.repeat(80));

    const improved = results.filter((r) => r.improvement).sort((a, b) => b.v20_error_pct - a.v20_error_pct);
    for (const r of improved.slice(0, 10)) {
      console.log(
        (r.wallet.slice(0, 12) + '..').padEnd(14),
        formatPnl(r.ui_pnl).padStart(12),
        formatPnl(r.v20_pnl).padStart(12),
        formatPnl(r.v22_pnl).padStart(12),
        `${r.v20_error_pct.toFixed(1)}%`.padStart(10),
        `${r.v22_error_pct.toFixed(1)}%`.padStart(10)
      );
    }
    console.log('');
  }

  if (regressions > 0) {
    console.log('='.repeat(80));
    console.log(`REGRESSIONS (V22 broke ${regressions} wallets)`);
    console.log('='.repeat(80));
    console.log('');
    console.log(
      'wallet'.padEnd(14),
      'ui_pnl'.padStart(12),
      'v20_pnl'.padStart(12),
      'v22_pnl'.padStart(12),
      'v20_err'.padStart(10),
      'v22_err'.padStart(10)
    );
    console.log('-'.repeat(80));

    const regressed = results.filter((r) => r.regression).sort((a, b) => b.v22_error_pct - a.v22_error_pct);
    for (const r of regressed.slice(0, 10)) {
      console.log(
        (r.wallet.slice(0, 12) + '..').padEnd(14),
        formatPnl(r.ui_pnl).padStart(12),
        formatPnl(r.v20_pnl).padStart(12),
        formatPnl(r.v22_pnl).padStart(12),
        `${r.v20_error_pct.toFixed(1)}%`.padStart(10),
        `${r.v22_error_pct.toFixed(1)}%`.padStart(10)
      );
    }
    console.log('');
  }

  // Key insights
  console.log('='.repeat(80));
  console.log('KEY INSIGHTS');
  console.log('='.repeat(80));

  const avgV20Error = results.reduce((sum, r) => sum + r.v20_error_pct, 0) / results.length;
  const avgV22Error = results.reduce((sum, r) => sum + r.v22_error_pct, 0) / results.length;

  const highV20Pass = byLevel.HIGH.filter((r) => r.v20_passes).length;
  const highV22Pass = byLevel.HIGH.filter((r) => r.v22_passes).length;
  const highV20Pct = byLevel.HIGH.length > 0 ? ((highV20Pass / byLevel.HIGH.length) * 100).toFixed(0) : '-';
  const highV22Pct = byLevel.HIGH.length > 0 ? ((highV22Pass / byLevel.HIGH.length) * 100).toFixed(0) : '-';

  console.log(`
1. OVERALL ACCURACY:
   - V20: ${v20PassRate}% pass rate, ${avgV20Error.toFixed(1)}% avg error
   - V22: ${v22PassRate}% pass rate, ${avgV22Error.toFixed(1)}% avg error
   - Net change: ${improvements} improved, ${regressions} regressed

2. HIGH CONFIDENCE WALLETS:
   - V20: ${highV20Pct}% pass rate
   - V22: ${highV22Pct}% pass rate

3. RECOMMENDATION:
   ${
     improvements > regressions
       ? '- V22 shows improvement - consider as new canonical'
       : regressions > improvements
         ? '- V22 shows regression - keep V20 as canonical'
         : '- V22 shows no net improvement - further investigation needed'
   }
`);

  // Save detailed results
  const timestamp = new Date().toISOString().slice(0, 10);
  const outputPath = `/tmp/v20-v22-comparison-${timestamp}.json`;
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        benchmark_set: benchmarks[0]?.benchmark_set,
        summary: {
          total: results.length,
          v20_pass_count: v20PassCount,
          v22_pass_count: v22PassCount,
          v20_pass_rate: Number(v20PassRate),
          v22_pass_rate: Number(v22PassRate),
          improvements,
          regressions,
          avg_v20_error: avgV20Error,
          avg_v22_error: avgV22Error,
        },
        by_confidence: {
          HIGH: {
            count: byLevel.HIGH.length,
            v20_pass: highV20Pass,
            v22_pass: highV22Pass,
          },
          MEDIUM: {
            count: byLevel.MEDIUM.length,
            v20_pass: byLevel.MEDIUM.filter((r) => r.v20_passes).length,
            v22_pass: byLevel.MEDIUM.filter((r) => r.v22_passes).length,
          },
          LOW: {
            count: byLevel.LOW.length,
            v20_pass: byLevel.LOW.filter((r) => r.v20_passes).length,
            v22_pass: byLevel.LOW.filter((r) => r.v22_passes).length,
          },
        },
        results: results.map((r) => ({
          wallet: r.wallet,
          ui_pnl: r.ui_pnl,
          v20_pnl: r.v20_pnl,
          v22_pnl: r.v22_pnl,
          v20_error_pct: r.v20_error_pct,
          v22_error_pct: r.v22_error_pct,
          v20_passes: r.v20_passes,
          v22_passes: r.v22_passes,
          improvement: r.improvement,
          regression: r.regression,
          confidence_level: r.confidence.confidence_level,
          confidence_score: r.confidence.confidence_score,
        })),
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

main(benchmarkSet).catch(console.error);
