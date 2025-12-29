/**
 * Test V19b against ALL benchmark wallets (133 unique)
 * Uses most recent benchmark for each wallet
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import { calculateV19bPnL } from '../../lib/pnl/uiActivityEngineV19b';

interface TestResult {
  wallet: string;
  ui_pnl: number;
  benchmark_set: string;
  captured_at: string;
  v19b_pnl: number | null;
  delta_pct: number | null;
  delta_abs: number | null;
  error: string | null;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function median(arr: number[]): number {
  return percentile(arr, 50);
}

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   V19b TEST - ALL 133 BENCHMARK WALLETS                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Get most recent benchmark for each wallet
  const benchmarkQuery = `
    SELECT
      wallet,
      pnl_value as ui_pnl,
      benchmark_set,
      captured_at
    FROM pm_ui_pnl_benchmarks_v1
    WHERE (wallet, captured_at) IN (
      SELECT wallet, max(captured_at)
      FROM pm_ui_pnl_benchmarks_v1
      GROUP BY wallet
    )
    ORDER BY abs(pnl_value) DESC
  `;

  const result = await client.query({ query: benchmarkQuery, format: 'JSONEachRow' });
  const wallets = (await result.json()) as Array<{
    wallet: string;
    ui_pnl: number;
    benchmark_set: string;
    captured_at: string;
  }>;

  console.log(`Found ${wallets.length} unique wallets with benchmarks\n`);

  const results: TestResult[] = [];
  let processed = 0;
  let errors = 0;

  for (const { wallet, ui_pnl, benchmark_set, captured_at } of wallets) {
    processed++;
    process.stdout.write(`\r[${processed}/${wallets.length}] Processing... (${errors} errors)`);

    const testResult: TestResult = {
      wallet,
      ui_pnl,
      benchmark_set,
      captured_at,
      v19b_pnl: null,
      delta_pct: null,
      delta_abs: null,
      error: null,
    };

    try {
      const v19b = await calculateV19bPnL(wallet);
      testResult.v19b_pnl = v19b.total_pnl;
      testResult.delta_pct = ui_pnl !== 0 ? ((v19b.total_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100 : 0;
      testResult.delta_abs = v19b.total_pnl - ui_pnl;
    } catch (e: any) {
      testResult.error = e.message.slice(0, 100);
      errors++;
    }

    results.push(testResult);
  }

  console.log('\n\n' + '═'.repeat(100));
  console.log('V19b VALIDATION RESULTS');
  console.log('═'.repeat(100));

  // Stats
  const validResults = results.filter(r => r.delta_pct !== null);
  const absDeltas = validResults.map(r => Math.abs(r.delta_pct!));

  console.log(`\nTotal wallets: ${results.length}`);
  console.log(`Valid results: ${validResults.length}`);
  console.log(`Errors: ${errors}`);

  if (absDeltas.length > 0) {
    console.log(`\nV19b Accuracy Stats (Absolute % Error):`);
    console.log('─'.repeat(40));
    console.log(`  Median:  ${median(absDeltas).toFixed(1)}%`);
    console.log(`  Mean:    ${(absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length).toFixed(1)}%`);
    console.log(`  P95:     ${percentile(absDeltas, 95).toFixed(1)}%`);
    console.log(`  Min:     ${Math.min(...absDeltas).toFixed(1)}%`);
    console.log(`  Max:     ${Math.max(...absDeltas).toFixed(1)}%`);

    // Breakdown by error band
    const within1 = absDeltas.filter(d => d <= 1).length;
    const within5 = absDeltas.filter(d => d <= 5).length;
    const within10 = absDeltas.filter(d => d <= 10).length;
    const within20 = absDeltas.filter(d => d <= 20).length;
    const over50 = absDeltas.filter(d => d > 50).length;

    console.log(`\nAccuracy Breakdown:`);
    console.log('─'.repeat(40));
    console.log(`  ≤1% error:  ${within1} (${(within1/absDeltas.length*100).toFixed(0)}%)`);
    console.log(`  ≤5% error:  ${within5} (${(within5/absDeltas.length*100).toFixed(0)}%)`);
    console.log(`  ≤10% error: ${within10} (${(within10/absDeltas.length*100).toFixed(0)}%)`);
    console.log(`  ≤20% error: ${within20} (${(within20/absDeltas.length*100).toFixed(0)}%)`);
    console.log(`  >50% error: ${over50} (${(over50/absDeltas.length*100).toFixed(0)}%)`);
  }

  // Show best matches (lowest error)
  const sortedByAccuracy = [...validResults].sort((a, b) =>
    Math.abs(a.delta_pct!) - Math.abs(b.delta_pct!)
  );

  console.log('\n' + '─'.repeat(100));
  console.log('BEST MATCHES (lowest error):');
  console.log('─'.repeat(100));
  console.log('Wallet                                      | UI PnL        | V19b PnL      | Delta%');
  console.log('─'.repeat(100));

  for (const r of sortedByAccuracy.slice(0, 15)) {
    const ui = `$${r.ui_pnl.toLocaleString().padStart(12)}`;
    const v19b = r.v19b_pnl !== null ? `$${r.v19b_pnl.toLocaleString().padStart(12)}` : '         ERR';
    const delta = `${r.delta_pct!.toFixed(1)}%`.padStart(7);
    console.log(`${r.wallet} | ${ui} | ${v19b} | ${delta}`);
  }

  // Show worst matches (highest error)
  console.log('\n' + '─'.repeat(100));
  console.log('WORST MATCHES (highest error):');
  console.log('─'.repeat(100));

  for (const r of sortedByAccuracy.slice(-15).reverse()) {
    const ui = `$${r.ui_pnl.toLocaleString().padStart(12)}`;
    const v19b = r.v19b_pnl !== null ? `$${r.v19b_pnl.toLocaleString().padStart(12)}` : '         ERR';
    const delta = `${r.delta_pct!.toFixed(1)}%`.padStart(7);
    console.log(`${r.wallet} | ${ui} | ${v19b} | ${delta}`);
  }

  // Show errors
  const errorResults = results.filter(r => r.error !== null);
  if (errorResults.length > 0) {
    console.log('\n' + '─'.repeat(100));
    console.log(`ERRORS (${errorResults.length}):`);
    console.log('─'.repeat(100));
    for (const r of errorResults.slice(0, 10)) {
      console.log(`${r.wallet.slice(0, 42)} | ${r.error?.slice(0, 50)}`);
    }
  }
}

main().catch(console.error);
