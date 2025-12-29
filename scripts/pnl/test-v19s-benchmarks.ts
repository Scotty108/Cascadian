/**
 * Test V19s (Synthetic + Mark-to-Market) against Playwright benchmark table
 *
 * V19s uses:
 * - pm_unified_ledger_v6 (CLOB trades with condition_id mapping)
 * - pm_token_to_condition_map_v5 (category enrichment)
 * - vw_pm_resolution_prices (resolution prices)
 * - Gamma API or snapshot prices (mark-to-market pricing)
 * - Synthetic resolution for prices at extremes (>=0.99 or <=0.01)
 *
 * NOTE: V9 ledger was tested 2024-12-16 but produces incorrect PnL (regression).
 *
 * When --benchmark-set is provided, uses snapshot prices from that set.
 * Otherwise uses live Gamma prices.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import { createV19sEngine, type PriceSource } from '../../lib/pnl/uiActivityEngineV19s';

interface Benchmark {
  wallet: string;
  ui_pnl: number;
  benchmark_set: string;
  captured_at: string;
}

interface MarketPrice {
  conditionId: string;
  prices: number[];
}

async function loadSnapshotPrices(
  client: ReturnType<typeof getClickHouseClient>,
  benchmarkSet: string
): Promise<Map<string, MarketPrice>> {
  const query = `
    SELECT
      condition_id,
      outcome_index,
      gamma_price
    FROM pm_benchmark_price_snapshots
    WHERE benchmark_set_id = '${benchmarkSet}'
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as Array<{
    condition_id: string;
    outcome_index: number;
    gamma_price: number;
  }>;

  // Group by condition_id
  const priceMap = new Map<string, MarketPrice>();
  for (const row of rows) {
    const cid = row.condition_id.toLowerCase();
    if (!priceMap.has(cid)) {
      priceMap.set(cid, { conditionId: cid, prices: [] });
    }
    const entry = priceMap.get(cid)!;
    entry.prices[row.outcome_index] = row.gamma_price;
  }

  return priceMap;
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
  console.log('║   V19s TEST - BENCHMARK WALLETS (V6 Ledger + MTM + Synthetic)              ║');
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

  // Try to load snapshot prices if benchmark set specified
  let priceSource: PriceSource = 'live';
  if (targetBenchmarkSet) {
    const snapshotPrices = await loadSnapshotPrices(client, targetBenchmarkSet);
    if (snapshotPrices.size > 0) {
      console.log(`Using snapshot prices from benchmark_set: ${targetBenchmarkSet}`);
      console.log(`  Loaded ${snapshotPrices.size} condition prices\n`);
      priceSource = snapshotPrices;
    } else {
      console.log(`No snapshot prices found for ${targetBenchmarkSet}, using live Gamma API\n`);
    }
  } else {
    console.log('Using live Gamma API prices (no --benchmark-set specified)\n');
  }

  console.log(`Found ${benchmarks.length} unique wallets with benchmarks\n`);

  // Create engine and set price source
  const engine = createV19sEngine();
  engine.setPriceSource(priceSource);

  const results: Array<{
    wallet: string;
    ui_pnl: number;
    v19s_pnl: number;
    delta_pct: number;
    resolved: number;
    synthetic: number;
    open: number;
    error?: string;
  }> = [];

  let errorCount = 0;

  for (let i = 0; i < benchmarks.length; i++) {
    const b = benchmarks[i];
    process.stdout.write(`\r[${i + 1}/${benchmarks.length}] Processing... (${errorCount} errors)`);

    try {
      const v19s = await engine.compute(b.wallet);

      const delta_pct = b.ui_pnl !== 0
        ? ((v19s.total_pnl - b.ui_pnl) / Math.abs(b.ui_pnl)) * 100
        : (v19s.total_pnl === 0 ? 0 : 100);

      results.push({
        wallet: b.wallet,
        ui_pnl: b.ui_pnl,
        v19s_pnl: v19s.total_pnl,
        delta_pct,
        resolved: v19s.resolutions,
        synthetic: v19s.synthetic_resolutions,
        open: v19s.open_positions,
      });
    } catch (err: unknown) {
      errorCount++;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        wallet: b.wallet,
        ui_pnl: b.ui_pnl,
        v19s_pnl: 0,
        delta_pct: NaN,
        resolved: 0,
        synthetic: 0,
        open: 0,
        error: msg,
      });
    }
  }

  console.log('\n');

  // Calculate stats
  const valid = results.filter((r) => !r.error && !isNaN(r.delta_pct));
  const errors = results.filter((r) => r.error);
  const absDeltas = valid.map((r) => Math.abs(r.delta_pct)).sort((a, b) => a - b);

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('V19s VALIDATION RESULTS');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  console.log(`Total wallets: ${benchmarks.length}`);
  console.log(`Valid results: ${valid.length}`);
  console.log(`Errors: ${errors.length}`);

  if (valid.length > 0) {
    const median = absDeltas[Math.floor(absDeltas.length / 2)];
    const mean = absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length;
    const p95 = absDeltas[Math.floor(absDeltas.length * 0.95)];

    console.log('\nV19s Accuracy Stats (Absolute % Error):');
    console.log('────────────────────────────────────────');
    console.log(`  Median:  ${median.toFixed(1)}%`);
    console.log(`  Mean:    ${mean.toFixed(1)}%`);
    console.log(`  P95:     ${p95.toFixed(1)}%`);
    console.log(`  Min:     ${absDeltas[0].toFixed(1)}%`);
    console.log(`  Max:     ${absDeltas[absDeltas.length - 1].toFixed(1)}%`);

    // Breakdown by accuracy tier
    const tier1 = valid.filter((r) => Math.abs(r.delta_pct) <= 1).length;
    const tier5 = valid.filter((r) => Math.abs(r.delta_pct) <= 5).length;
    const tier10 = valid.filter((r) => Math.abs(r.delta_pct) <= 10).length;
    const tier20 = valid.filter((r) => Math.abs(r.delta_pct) <= 20).length;
    const bad = valid.filter((r) => Math.abs(r.delta_pct) > 50).length;

    console.log('\nAccuracy Breakdown:');
    console.log('────────────────────────────────────────');
    console.log(`  ≤1% error:  ${tier1} (${Math.round(tier1 / valid.length * 100)}%)`);
    console.log(`  ≤5% error:  ${tier5} (${Math.round(tier5 / valid.length * 100)}%)`);
    console.log(`  ≤10% error: ${tier10} (${Math.round(tier10 / valid.length * 100)}%)`);
    console.log(`  ≤20% error: ${tier20} (${Math.round(tier20 / valid.length * 100)}%)`);
    console.log(`  >50% error: ${bad} (${Math.round(bad / valid.length * 100)}%)`);

    // Breakdown by position status
    const realizedOnly = valid.filter((r) => r.open === 0);
    const hasOpen = valid.filter((r) => r.open > 0);

    console.log('\nPosition Status Breakdown:');
    console.log('────────────────────────────────────────');
    console.log(`  Realized-only wallets: ${realizedOnly.length}`);
    if (realizedOnly.length > 0) {
      const realizedDeltas = realizedOnly.map((r) => Math.abs(r.delta_pct)).sort((a, b) => a - b);
      const realizedMedian = realizedDeltas[Math.floor(realizedDeltas.length / 2)];
      const realizedTier5 = realizedOnly.filter((r) => Math.abs(r.delta_pct) <= 5).length;
      console.log(`    Median error: ${realizedMedian.toFixed(1)}%`);
      console.log(`    ≤5% error: ${realizedTier5} (${Math.round(realizedTier5 / realizedOnly.length * 100)}%)`);
    }

    console.log(`  Wallets with open positions: ${hasOpen.length}`);
    if (hasOpen.length > 0) {
      const openDeltas = hasOpen.map((r) => Math.abs(r.delta_pct)).sort((a, b) => a - b);
      const openMedian = openDeltas[Math.floor(openDeltas.length / 2)];
      const openTier5 = hasOpen.filter((r) => Math.abs(r.delta_pct) <= 5).length;
      console.log(`    Median error: ${openMedian.toFixed(1)}%`);
      console.log(`    ≤5% error: ${openTier5} (${Math.round(openTier5 / hasOpen.length * 100)}%)`);
    }
  }

  // Show best and worst
  const sorted = valid.sort((a, b) => Math.abs(a.delta_pct) - Math.abs(b.delta_pct));

  console.log('\n────────────────────────────────────────────────────────────────────────────────────────────────────');
  console.log('BEST MATCHES (lowest error):');
  console.log('────────────────────────────────────────────────────────────────────────────────────────────────────');
  console.log('Wallet                                      | UI PnL        | V19s PnL      | Delta%  | R/S/O');
  console.log('────────────────────────────────────────────────────────────────────────────────────────────────────');
  for (const r of sorted.slice(0, 15)) {
    const uiStr = ('$' + r.ui_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })).padStart(13);
    const v19sStr = ('$' + r.v19s_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })).padStart(13);
    const pctStr = (r.delta_pct >= 0 ? '+' : '') + r.delta_pct.toFixed(1) + '%';
    const status = `${r.resolved}/${r.synthetic}/${r.open}`;
    console.log(`${r.wallet} | ${uiStr} | ${v19sStr} | ${pctStr.padStart(7)} | ${status}`);
  }

  console.log('\n────────────────────────────────────────────────────────────────────────────────────────────────────');
  console.log('WORST MATCHES (highest error):');
  console.log('────────────────────────────────────────────────────────────────────────────────────────────────────');
  for (const r of sorted.slice(-15).reverse()) {
    const uiStr = ('$' + r.ui_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })).padStart(13);
    const v19sStr = ('$' + r.v19s_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })).padStart(13);
    const pctStr = (r.delta_pct >= 0 ? '+' : '') + r.delta_pct.toFixed(1) + '%';
    const status = `${r.resolved}/${r.synthetic}/${r.open}`;
    console.log(`${r.wallet} | ${uiStr} | ${v19sStr} | ${pctStr.padStart(7)} | ${status}`);
  }

  if (errors.length > 0) {
    console.log('\n────────────────────────────────────────────────────────────────────────────────────────────────────');
    console.log('ERRORS:');
    console.log('────────────────────────────────────────────────────────────────────────────────────────────────────');
    for (const e of errors.slice(0, 5)) {
      console.log(`${e.wallet}: ${e.error}`);
    }
  }
}

main().catch(console.error);
