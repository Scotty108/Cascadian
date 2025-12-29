/**
 * Classify V19s validation failures into actionable buckets
 *
 * Buckets:
 * 1. BENCHMARK_DRIFT - Open positions where price moved since benchmark capture
 * 2. INPUT_DATA_GAP - No V6 data, missing condition_ids, or zero positions
 * 3. ENGINE_BUG - Realized-only wallets with significant error (needs investigation)
 *
 * Usage:
 *   npx tsx scripts/pnl/classify-v19s-failures.ts
 *   npx tsx scripts/pnl/classify-v19s-failures.ts --benchmark-set <set_id>
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import { createV19sEngine } from '../../lib/pnl/uiActivityEngineV19s';

interface Benchmark {
  wallet: string;
  ui_pnl: number;
  benchmark_set: string;
  captured_at: string;
}

type FailureBucket = 'BENCHMARK_DRIFT' | 'INPUT_DATA_GAP' | 'ENGINE_BUG' | 'PASS';

interface ClassifiedResult {
  wallet: string;
  ui_pnl: number;
  v19s_pnl: number;
  delta_pct: number;
  bucket: FailureBucket;
  reason: string;
  resolved: number;
  synthetic: number;
  open: number;
  v6_rows: number;
  benchmark_set: string;
  captured_at: string;
}

const ERROR_THRESHOLD_PCT = 10; // 10% error threshold for "significant"

async function getV6RowCount(client: ReturnType<typeof getClickHouseClient>, wallet: string): Promise<number> {
  const result = await client.query({
    query: `
      SELECT count() as cnt
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as Array<{ cnt: string }>;
  return Number(rows[0]?.cnt || 0);
}

async function main() {
  const client = getClickHouseClient();

  // Parse arguments
  const args = process.argv.slice(2);
  let targetBenchmarkSet: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--benchmark-set' && args[i + 1]) {
      targetBenchmarkSet = args[i + 1];
      i++;
    }
  }

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   V19s FAILURE CLASSIFICATION                                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Load benchmarks
  let benchmarkQuery: string;
  if (targetBenchmarkSet) {
    benchmarkQuery = `
      SELECT DISTINCT
        lower(wallet) as wallet,
        pnl_value as ui_pnl,
        benchmark_set,
        toString(captured_at) as captured_at
      FROM pm_ui_pnl_benchmarks_v1
      WHERE pnl_value IS NOT NULL
        AND benchmark_set = '${targetBenchmarkSet}'
      ORDER BY wallet
    `;
  } else {
    benchmarkQuery = `
      SELECT DISTINCT
        lower(wallet) as wallet,
        pnl_value as ui_pnl,
        benchmark_set,
        toString(captured_at) as captured_at
      FROM pm_ui_pnl_benchmarks_v1
      WHERE pnl_value IS NOT NULL
      ORDER BY wallet
    `;
  }

  const benchmarkResult = await client.query({ query: benchmarkQuery, format: 'JSONEachRow' });
  const benchmarks = (await benchmarkResult.json()) as Benchmark[];

  console.log(`Found ${benchmarks.length} unique wallets with benchmarks\n`);

  const engine = createV19sEngine();
  const results: ClassifiedResult[] = [];

  for (let i = 0; i < benchmarks.length; i++) {
    const b = benchmarks[i];
    process.stdout.write(`\r[${i + 1}/${benchmarks.length}] Classifying...`);

    try {
      const v19s = await engine.compute(b.wallet);
      const v6Rows = await getV6RowCount(client, b.wallet);

      const delta_pct =
        b.ui_pnl !== 0
          ? ((v19s.total_pnl - b.ui_pnl) / Math.abs(b.ui_pnl)) * 100
          : v19s.total_pnl === 0
            ? 0
            : 100;

      const absError = Math.abs(delta_pct);
      let bucket: FailureBucket;
      let reason: string;

      if (absError <= ERROR_THRESHOLD_PCT) {
        // Within threshold - PASS
        bucket = 'PASS';
        reason = `Error ${delta_pct.toFixed(1)}% within ${ERROR_THRESHOLD_PCT}% threshold`;
      } else if (v6Rows === 0 || v19s.positions_count === 0) {
        // No V6 data or no positions - INPUT_DATA_GAP
        bucket = 'INPUT_DATA_GAP';
        reason = v6Rows === 0 ? 'No V6 CLOB rows' : 'Zero positions from V6';
      } else if (v19s.open_positions > 0) {
        // Has open positions - likely BENCHMARK_DRIFT
        bucket = 'BENCHMARK_DRIFT';
        const openPct = ((v19s.open_positions / v19s.positions_count) * 100).toFixed(0);
        reason = `${v19s.open_positions} open positions (${openPct}%), prices may have moved`;
      } else {
        // Realized-only with significant error - ENGINE_BUG
        bucket = 'ENGINE_BUG';
        reason = `Realized-only wallet with ${delta_pct.toFixed(1)}% error, needs investigation`;
      }

      results.push({
        wallet: b.wallet,
        ui_pnl: b.ui_pnl,
        v19s_pnl: v19s.total_pnl,
        delta_pct,
        bucket,
        reason,
        resolved: v19s.resolutions,
        synthetic: v19s.synthetic_resolutions,
        open: v19s.open_positions,
        v6_rows: v6Rows,
        benchmark_set: b.benchmark_set,
        captured_at: b.captured_at,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        wallet: b.wallet,
        ui_pnl: b.ui_pnl,
        v19s_pnl: 0,
        delta_pct: NaN,
        bucket: 'INPUT_DATA_GAP',
        reason: `Error: ${msg}`,
        resolved: 0,
        synthetic: 0,
        open: 0,
        v6_rows: 0,
        benchmark_set: b.benchmark_set,
        captured_at: b.captured_at,
      });
    }
  }

  console.log('\n\n');

  // Summary by bucket
  const byBucket = {
    PASS: results.filter((r) => r.bucket === 'PASS'),
    BENCHMARK_DRIFT: results.filter((r) => r.bucket === 'BENCHMARK_DRIFT'),
    INPUT_DATA_GAP: results.filter((r) => r.bucket === 'INPUT_DATA_GAP'),
    ENGINE_BUG: results.filter((r) => r.bucket === 'ENGINE_BUG'),
  };

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('CLASSIFICATION SUMMARY');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  console.log(`Total wallets: ${results.length}\n`);

  console.log('Bucket Breakdown:');
  console.log('────────────────────────────────────────');
  console.log(`  ✓ PASS:            ${byBucket.PASS.length} (${Math.round((byBucket.PASS.length / results.length) * 100)}%)`);
  console.log(`  ⏳ BENCHMARK_DRIFT: ${byBucket.BENCHMARK_DRIFT.length} (${Math.round((byBucket.BENCHMARK_DRIFT.length / results.length) * 100)}%)`);
  console.log(`  📭 INPUT_DATA_GAP:  ${byBucket.INPUT_DATA_GAP.length} (${Math.round((byBucket.INPUT_DATA_GAP.length / results.length) * 100)}%)`);
  console.log(`  🐛 ENGINE_BUG:      ${byBucket.ENGINE_BUG.length} (${Math.round((byBucket.ENGINE_BUG.length / results.length) * 100)}%)`);

  // Show ENGINE_BUG cases (these need investigation)
  if (byBucket.ENGINE_BUG.length > 0) {
    console.log('\n════════════════════════════════════════════════════════════════════════════════════════════════════');
    console.log('🐛 ENGINE_BUG CASES (need investigation)');
    console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
    console.log('Wallet                                      | UI PnL        | V19s PnL      | Delta%  | R/S/O | V6 Rows');
    console.log('────────────────────────────────────────────────────────────────────────────────────────────────────────────');

    for (const r of byBucket.ENGINE_BUG.slice(0, 20)) {
      const uiStr = ('$' + r.ui_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })).padStart(13);
      const v19sStr = ('$' + r.v19s_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })).padStart(13);
      const pctStr = (r.delta_pct >= 0 ? '+' : '') + r.delta_pct.toFixed(1) + '%';
      const status = `${r.resolved}/${r.synthetic}/${r.open}`;
      console.log(`${r.wallet} | ${uiStr} | ${v19sStr} | ${pctStr.padStart(7)} | ${status.padEnd(5)} | ${r.v6_rows}`);
    }
  }

  // Show INPUT_DATA_GAP cases
  if (byBucket.INPUT_DATA_GAP.length > 0) {
    console.log('\n════════════════════════════════════════════════════════════════════════════════════════════════════');
    console.log('📭 INPUT_DATA_GAP CASES');
    console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');

    for (const r of byBucket.INPUT_DATA_GAP.slice(0, 10)) {
      console.log(`${r.wallet}: ${r.reason}`);
    }
    if (byBucket.INPUT_DATA_GAP.length > 10) {
      console.log(`... and ${byBucket.INPUT_DATA_GAP.length - 10} more`);
    }
  }

  // Show BENCHMARK_DRIFT summary
  if (byBucket.BENCHMARK_DRIFT.length > 0) {
    console.log('\n════════════════════════════════════════════════════════════════════════════════════════════════════');
    console.log('⏳ BENCHMARK_DRIFT CASES (expected - prices moved since capture)');
    console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');

    const driftByError = {
      mild: byBucket.BENCHMARK_DRIFT.filter((r) => Math.abs(r.delta_pct) <= 20).length,
      moderate: byBucket.BENCHMARK_DRIFT.filter((r) => Math.abs(r.delta_pct) > 20 && Math.abs(r.delta_pct) <= 50).length,
      severe: byBucket.BENCHMARK_DRIFT.filter((r) => Math.abs(r.delta_pct) > 50).length,
    };

    console.log(`  10-20% error: ${driftByError.mild}`);
    console.log(`  20-50% error: ${driftByError.moderate}`);
    console.log(`  >50% error:   ${driftByError.severe}`);
    console.log('\n  (These should improve with snapshot prices at capture time)');
  }

  // Actionable summary
  console.log('\n════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('ACTIONABLE SUMMARY');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');

  console.log(`\n✅ ${byBucket.PASS.length} wallets are within ${ERROR_THRESHOLD_PCT}% - no action needed`);

  if (byBucket.BENCHMARK_DRIFT.length > 0) {
    console.log(`\n⏳ ${byBucket.BENCHMARK_DRIFT.length} wallets have open positions - need snapshot prices to validate accurately`);
  }

  if (byBucket.INPUT_DATA_GAP.length > 0) {
    console.log(`\n📭 ${byBucket.INPUT_DATA_GAP.length} wallets have no V6 data - check if they traded via different mechanism (FPMM, etc)`);
  }

  if (byBucket.ENGINE_BUG.length > 0) {
    console.log(`\n🐛 ${byBucket.ENGINE_BUG.length} wallets are realized-only with large error - these need investigation:`);
    for (const r of byBucket.ENGINE_BUG.slice(0, 5)) {
      console.log(`   - ${r.wallet} (${r.delta_pct.toFixed(1)}% error)`);
    }
  }
}

main().catch(console.error);
