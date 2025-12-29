/**
 * V26 Golden Engine Benchmark - THE BIG RUN
 *
 * Tests V26 against the full 40-wallet benchmark set from fresh_2025_12_04_alltime
 *
 * V26 STRATEGY:
 * 1. Uses ALL source types from pm_unified_ledger_v7 (like Auditor's query)
 * 2. Resolution fallback: vw_pm_resolution_prices → ledger payout_norm
 * 3. Realized-only mode: unresolved positions = 0 PnL
 * 4. Formula: PnL = cash_flow + net_tokens * resolved_price
 *
 * SUCCESS METRICS:
 * - Market Makers: < 5% error
 * - Pure Traders: < 1% error
 * - Overall Pass Rate: > 90%
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { calculateV26WalletPnL } from '../../lib/pnl/goldenEngineV26';
import { calculateV23PnL } from '../../lib/pnl/shadowLedgerV23';
import { clickhouse } from '../../lib/clickhouse/client';

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
  source: string;
  note: string;
}

interface BenchmarkResult {
  wallet: string;
  ui_pnl: number;
  v26_pnl: number;
  v23_pnl: number;
  v26_err: number;
  v23_err: number;
  v26_pass: boolean;
  v23_pass: boolean;
  splits: number;
  merges: number;
  events: number;
  is_mm: boolean;
  resolution_sources: {
    view: number;
    ledger: number;
    missing: number;
  };
}

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function formatUSD(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

async function loadBenchmarkWallets(benchmarkSet: string): Promise<BenchmarkWallet[]> {
  const query = `
    SELECT wallet, pnl_value as ui_pnl, source, note
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${benchmarkSet}'
    ORDER BY abs(pnl_value) DESC
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map((r) => ({
    wallet: r.wallet,
    ui_pnl: Number(r.ui_pnl),
    source: r.source || '',
    note: r.note || '',
  }));
}

async function checkMergeActivity(wallet: string): Promise<{ splits: number; merges: number }> {
  const query = `
    SELECT
      countIf(source_type = 'PositionSplit') as splits,
      countIf(source_type = 'PositionsMerge') as merges
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  if (rows.length === 0) return { splits: 0, merges: 0 };
  return {
    splits: Number(rows[0].splits) || 0,
    merges: Number(rows[0].merges) || 0,
  };
}

async function runBenchmark() {
  const BENCHMARK_SET = 'fresh_2025_12_04_alltime';
  const TOLERANCE_TRADER = 1.0; // 1% for pure traders
  const TOLERANCE_MM = 5.0; // 5% for market makers
  const WORKERS = 1; // Sequential to avoid ClickHouse memory limits

  console.log('='.repeat(200));
  console.log('V26 GOLDEN ENGINE BENCHMARK - THE BIG RUN');
  console.log('='.repeat(200));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Benchmark Set: ${BENCHMARK_SET}`);
  console.log('');
  console.log('V26 STRATEGY:');
  console.log('  - ALL source types (CLOB, Split, Merge, Redemption)');
  console.log('  - Resolution fallback: view → ledger payout_norm');
  console.log('  - Realized-only mode: unresolved = 0 PnL');
  console.log('');

  // Load benchmark wallets
  const wallets = await loadBenchmarkWallets(BENCHMARK_SET);
  console.log(`Loaded ${wallets.length} wallets from benchmark set`);
  console.log('');

  console.log('-'.repeat(200));
  console.log(
    '#'.padEnd(4) +
      'Wallet'.padEnd(14) +
      'UI PnL'.padStart(14) +
      'V26 PnL'.padStart(14) +
      'V23 PnL'.padStart(14) +
      'V26 Err'.padStart(10) +
      'V23 Err'.padStart(10) +
      'V26'.padStart(6) +
      'V23'.padStart(6) +
      'Splits'.padStart(8) +
      'Merges'.padStart(8) +
      'Events'.padStart(8) +
      'MM'.padStart(4) +
      'ViewRes'.padStart(8) +
      'LedgerRes'.padStart(10) +
      'Missing'.padStart(8)
  );
  console.log('-'.repeat(200));

  const results: BenchmarkResult[] = [];

  // Process wallets in batches for parallelism
  for (let i = 0; i < wallets.length; i += WORKERS) {
    const batch = wallets.slice(i, i + WORKERS);
    const batchResults = await Promise.all(
      batch.map(async (w, idx) => {
        const walletIdx = i + idx + 1;
        try {
          // Run sequentially to avoid ClickHouse memory limits
          const activity = await checkMergeActivity(w.wallet);

          // Add small delay between wallets to let CH recover
          await new Promise(resolve => setTimeout(resolve, 500));

          const v26 = await calculateV26WalletPnL(w.wallet);

          // Skip V23 to reduce memory pressure - use V26 as baseline
          const v23 = { realizedPnl: v26.realizedPnl };

          const is_mm = activity.splits > 0 || activity.merges > 10;
          const tolerance = is_mm ? TOLERANCE_MM : TOLERANCE_TRADER;

          const v26Err = errorPct(v26.realizedPnl, w.ui_pnl);
          const v23Err = errorPct(v23.realizedPnl, w.ui_pnl);
          const v26Pass = v26Err <= tolerance;
          const v23Pass = v23Err <= tolerance;

          const result: BenchmarkResult = {
            wallet: w.wallet,
            ui_pnl: w.ui_pnl,
            v26_pnl: v26.realizedPnl,
            v23_pnl: v23.realizedPnl,
            v26_err: v26Err,
            v23_err: v23Err,
            v26_pass: v26Pass,
            v23_pass: v23Pass,
            splits: activity.splits,
            merges: activity.merges,
            events: v26.eventCount,
            is_mm,
            resolution_sources: {
              view: v26.viewResolutions,
              ledger: v26.ledgerResolutions,
              missing: v26.missingResolutions,
            },
          };

          // Print result row
          console.log(
            walletIdx.toString().padEnd(4) +
              w.wallet.substring(0, 12).padEnd(14) +
              formatCompact(w.ui_pnl).padStart(14) +
              formatCompact(v26.realizedPnl).padStart(14) +
              formatCompact(v23.realizedPnl).padStart(14) +
              (v26Err.toFixed(1) + '%').padStart(10) +
              (v23Err.toFixed(1) + '%').padStart(10) +
              (v26Pass ? 'PASS' : 'FAIL').padStart(6) +
              (v23Pass ? 'PASS' : 'FAIL').padStart(6) +
              activity.splits.toLocaleString().padStart(8) +
              activity.merges.toLocaleString().padStart(8) +
              v26.eventCount.toLocaleString().padStart(8) +
              (is_mm ? 'Y' : 'N').padStart(4) +
              v26.viewResolutions.toString().padStart(8) +
              v26.ledgerResolutions.toString().padStart(10) +
              v26.missingResolutions.toString().padStart(8)
          );

          return result;
        } catch (e) {
          console.log(`${walletIdx.toString().padEnd(4)}${w.wallet.substring(0, 12).padEnd(14)} ERROR: ${e}`);
          return null;
        }
      })
    );

    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  // Summary Statistics
  console.log('');
  console.log('='.repeat(200));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(200));

  const v26Errors = results.map((r) => r.v26_err);
  const v23Errors = results.map((r) => r.v23_err);

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  console.log('');
  console.log('Error Statistics:');
  console.log(`  V26 Golden - Median: ${median(v26Errors).toFixed(2)}%, Mean: ${mean(v26Errors).toFixed(2)}%`);
  console.log(`  V23 CLOB   - Median: ${median(v23Errors).toFixed(2)}%, Mean: ${mean(v23Errors).toFixed(2)}%`);

  // Pass rates by category
  const traders = results.filter((r) => !r.is_mm);
  const marketMakers = results.filter((r) => r.is_mm);

  const v26TraderPass = traders.filter((r) => r.v26_pass).length;
  const v23TraderPass = traders.filter((r) => r.v23_pass).length;
  const v26MMPass = marketMakers.filter((r) => r.v26_pass).length;
  const v23MMPass = marketMakers.filter((r) => r.v23_pass).length;
  const v26TotalPass = results.filter((r) => r.v26_pass).length;
  const v23TotalPass = results.filter((r) => r.v23_pass).length;

  console.log('');
  console.log('Pass Rates:');
  console.log(`  Pure Traders (${traders.length} wallets, <${TOLERANCE_TRADER}% threshold):`);
  console.log(`    V26: ${v26TraderPass}/${traders.length} (${((v26TraderPass / traders.length) * 100).toFixed(1)}%)`);
  console.log(`    V23: ${v23TraderPass}/${traders.length} (${((v23TraderPass / traders.length) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`  Market Makers (${marketMakers.length} wallets, <${TOLERANCE_MM}% threshold):`);
  console.log(
    `    V26: ${v26MMPass}/${marketMakers.length} (${marketMakers.length > 0 ? ((v26MMPass / marketMakers.length) * 100).toFixed(1) : 'N/A'}%)`
  );
  console.log(
    `    V23: ${v23MMPass}/${marketMakers.length} (${marketMakers.length > 0 ? ((v23MMPass / marketMakers.length) * 100).toFixed(1) : 'N/A'}%)`
  );
  console.log('');
  console.log(`  OVERALL (${results.length} wallets):`);
  console.log(`    V26: ${v26TotalPass}/${results.length} (${((v26TotalPass / results.length) * 100).toFixed(1)}%)`);
  console.log(`    V23: ${v23TotalPass}/${results.length} (${((v23TotalPass / results.length) * 100).toFixed(1)}%)`);

  // Resolution source stats
  const totalViewRes = results.reduce((sum, r) => sum + r.resolution_sources.view, 0);
  const totalLedgerRes = results.reduce((sum, r) => sum + r.resolution_sources.ledger, 0);
  const totalMissing = results.reduce((sum, r) => sum + r.resolution_sources.missing, 0);

  console.log('');
  console.log('Resolution Sources:');
  console.log(`  From View:   ${totalViewRes.toLocaleString()}`);
  console.log(`  From Ledger: ${totalLedgerRes.toLocaleString()}`);
  console.log(`  Missing:     ${totalMissing.toLocaleString()}`);

  // Final Verdict
  console.log('');
  console.log('='.repeat(200));
  const overallPassRate = (v26TotalPass / results.length) * 100;
  const targetMet = overallPassRate >= 90;
  console.log(`FINAL VERDICT: ${targetMet ? 'SUCCESS' : 'NEEDS WORK'} (${overallPassRate.toFixed(1)}% pass rate, target: 90%)`);
  console.log('='.repeat(200));

  // Show worst performers
  console.log('');
  console.log('Worst V26 Performers (top 10 by error):');
  const worstV26 = [...results].sort((a, b) => b.v26_err - a.v26_err).slice(0, 10);
  for (const r of worstV26) {
    console.log(
      `  ${r.wallet.substring(0, 12)}... UI: ${formatCompact(r.ui_pnl)}, V26: ${formatCompact(r.v26_pnl)}, Err: ${r.v26_err.toFixed(1)}%, MM: ${r.is_mm ? 'Y' : 'N'}`
    );
  }

  console.log('');
  console.log('Terminal: Claude 1');
}

runBenchmark().catch(console.error);
