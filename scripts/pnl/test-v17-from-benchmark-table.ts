/**
 * V17 Test Against Benchmark Table
 *
 * Reads UI PnL benchmarks from pm_ui_pnl_benchmarks_v1 and tests V17 engine.
 * This is the proper way to run benchmark tests - no hardcoded values.
 *
 * Usage:
 *   npx tsx scripts/pnl/test-v17-from-benchmark-table.ts [benchmark_set]
 *
 * Examples:
 *   npx tsx scripts/pnl/test-v17-from-benchmark-table.ts                        # uses default
 *   npx tsx scripts/pnl/test-v17-from-benchmark-table.ts 50_wallet_v1_legacy    # specific set
 *   npx tsx scripts/pnl/test-v17-from-benchmark-table.ts 50_wallet_v2_20251203  # fresh set
 */

import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';
import { clickhouse } from '../../lib/clickhouse/client';

interface BenchmarkRow {
  wallet: string;
  pnl_value: number;
  note: string;
  captured_at: string;
}

interface Result {
  wallet: string;
  ui_pnl: number;
  note: string;
  v17_realized: number;
  v17_unrealized: number;
  v17_total: number;
  error_pct: number;
  sign_match: boolean;
  positions: number;
}

async function loadBenchmarks(benchmarkSet: string): Promise<BenchmarkRow[]> {
  const query = `
    SELECT wallet, pnl_value, note, captured_at
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${benchmarkSet}'
    ORDER BY wallet
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as BenchmarkRow[];
}

async function listBenchmarkSets(): Promise<void> {
  const query = `
    SELECT
      benchmark_set,
      count() as wallet_count,
      min(captured_at) as captured_at,
      source
    FROM pm_ui_pnl_benchmarks_v1
    GROUP BY benchmark_set, source
    ORDER BY captured_at DESC
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('Available benchmark sets:');
  console.log('-'.repeat(80));
  for (const r of rows) {
    console.log(`  ${r.benchmark_set.padEnd(30)} | ${r.wallet_count} wallets | ${r.captured_at} | ${r.source}`);
  }
  console.log('-'.repeat(80));
}

async function main() {
  const args = process.argv.slice(2);
  const benchmarkSet = args[0] || '50_wallet_v1_legacy';

  console.log('='.repeat(120));
  console.log('V17 TEST FROM BENCHMARK TABLE');
  console.log('='.repeat(120));

  // List available sets
  await listBenchmarkSets();
  console.log('');
  console.log(`Using benchmark set: ${benchmarkSet}`);
  console.log('');

  // Load benchmarks
  const benchmarks = await loadBenchmarks(benchmarkSet);

  if (benchmarks.length === 0) {
    console.error(`No benchmarks found for set: ${benchmarkSet}`);
    console.log('Run: npx tsx scripts/pnl/seed-ui-benchmarks-from-file.ts <json_file>');
    process.exit(1);
  }

  console.log(`Loaded ${benchmarks.length} wallets from benchmark table`);
  console.log(`Captured at: ${benchmarks[0]?.captured_at}`);
  console.log('');

  const engine = createV17Engine();
  const results: Result[] = [];
  let processed = 0;

  for (const b of benchmarks) {
    processed++;
    process.stdout.write(`[${processed}/${benchmarks.length}] ${b.wallet.substring(0, 12)}...`);
    const startTime = Date.now();

    try {
      const v17Result = await engine.compute(b.wallet);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      const v17_realized = v17Result.realized_pnl;
      const v17_unrealized = v17Result.unrealized_pnl;
      const v17_total = v17_realized + v17_unrealized;

      const error_pct = Math.abs(b.pnl_value) > 0.01
        ? (Math.abs(v17_realized - b.pnl_value) / Math.abs(b.pnl_value)) * 100
        : 0;
      const sign_match = (v17_realized >= 0) === (b.pnl_value >= 0);

      results.push({
        wallet: b.wallet,
        ui_pnl: b.pnl_value,
        note: b.note,
        v17_realized,
        v17_unrealized,
        v17_total,
        error_pct,
        sign_match,
        positions: v17Result.positions_count,
      });

      console.log(` ${elapsed}s | ${v17Result.positions_count} pos | ${error_pct.toFixed(0)}% err`);
    } catch (err: any) {
      console.log(` ERROR: ${err.message.substring(0, 50)}`);
      results.push({
        wallet: b.wallet,
        ui_pnl: b.pnl_value,
        note: b.note,
        v17_realized: 0,
        v17_unrealized: 0,
        v17_total: 0,
        error_pct: 100,
        sign_match: false,
        positions: 0,
      });
    }
  }

  // Sort by error
  const sorted = [...results].sort((a, b) => a.error_pct - b.error_pct);

  // Results table - top 15 best
  console.log('');
  console.log('='.repeat(120));
  console.log('TOP 15 BEST (lowest error)');
  console.log('='.repeat(120));
  console.log('Wallet           | UI PnL           | V17 Realized     | Error %  | Sign | Note');
  console.log('-'.repeat(120));

  for (const r of sorted.slice(0, 15)) {
    const signStr = r.sign_match ? 'OK' : 'X';
    console.log(
      `${r.wallet.substring(0, 14)}... | $${r.ui_pnl.toLocaleString().padStart(14)} | $${r.v17_realized.toLocaleString().padStart(14)} | ${r.error_pct.toFixed(1).padStart(7)}% | ${signStr.padStart(4)} | ${r.note.substring(0, 20)}`
    );
  }

  // Bottom 10 worst
  console.log('');
  console.log('='.repeat(120));
  console.log('TOP 10 WORST (highest error)');
  console.log('='.repeat(120));
  console.log('Wallet           | UI PnL           | V17 Realized     | Error %  | Sign | Note');
  console.log('-'.repeat(120));

  for (const r of sorted.slice(-10).reverse()) {
    const signStr = r.sign_match ? 'OK' : 'X';
    console.log(
      `${r.wallet.substring(0, 14)}... | $${r.ui_pnl.toLocaleString().padStart(14)} | $${r.v17_realized.toLocaleString().padStart(14)} | ${r.error_pct.toFixed(1).padStart(7)}% | ${signStr.padStart(4)} | ${r.note.substring(0, 20)}`
    );
  }

  // Summary statistics
  console.log('');
  console.log('='.repeat(120));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(120));

  const validResults = results.filter((r) => r.positions > 0);
  const noData = results.filter((r) => r.positions === 0);

  console.log(`Benchmark set:     ${benchmarkSet}`);
  console.log(`Total wallets:     ${results.length}`);
  console.log(`With data:         ${validResults.length}`);
  console.log(`No data:           ${noData.length}`);

  // Sign match rate
  const signMatches = validResults.filter((r) => r.sign_match).length;
  console.log(`Sign match rate:   ${signMatches}/${validResults.length} (${((signMatches / validResults.length) * 100).toFixed(1)}%)`);

  // Error statistics
  if (validResults.length > 0) {
    const errors = validResults.map((r) => r.error_pct);
    const avgErr = errors.reduce((s, e) => s + e, 0) / errors.length;
    const sortedErrors = [...errors].sort((a, b) => a - b);
    const medianErr = sortedErrors[Math.floor(sortedErrors.length / 2)];
    const minErr = Math.min(...errors);
    const maxErr = Math.max(...errors);

    console.log('');
    console.log('Error distribution:');
    console.log(`  Min:     ${minErr.toFixed(1)}%`);
    console.log(`  Median:  ${medianErr.toFixed(1)}%`);
    console.log(`  Mean:    ${avgErr.toFixed(1)}%`);
    console.log(`  Max:     ${maxErr.toFixed(1)}%`);
  }

  // Pass rates at thresholds
  console.log('');
  console.log('Pass rates (error < threshold AND sign match):');
  const thresholds = [5, 10, 15, 25, 50, 100];
  for (const thresh of thresholds) {
    const passes = validResults.filter((r) => r.error_pct < thresh && r.sign_match).length;
    console.log(`  <${thresh.toString().padStart(3)}%: ${passes}/${validResults.length} (${((passes / validResults.length) * 100).toFixed(1)}%)`);
  }

  console.log('');
  console.log('='.repeat(120));
  console.log('TEST COMPLETE');
  console.log('='.repeat(120));
}

main().catch(console.error);
