/**
 * V27 INVENTORY ENGINE BENCHMARK
 *
 * Tests V27 against the 40-wallet benchmark set from fresh_2025_12_04_alltime
 *
 * V27 STRATEGY:
 * - State machine processing ALL source types chronologically
 * - Tracks inventory, cost basis, and cash flow per (condition, outcome)
 * - V20 formula: PnL = cash_flow + (tokens * resolution_price)
 * - Resolution fallback: vw_pm_resolution_prices → ledger payout_norm
 *
 * WHY V27 EXISTS:
 * - V23 CLOB-only fails for wallets with PayoutRedemption activity
 * - V26 ALL-sources fails because it doesn't track cost basis properly
 * - V27 uses true accounting to handle ALL wallet types
 *
 * SUCCESS METRICS:
 * - Pure Traders: < 1% error
 * - Market Makers: < 5% error
 * - Overall Pass Rate: > 90%
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { calculateV27PnL, V27Result } from '../../lib/pnl/inventoryEngineV27';
import { calculateV23PnL } from '../../lib/pnl/shadowLedgerV23';
import { clickhouse } from '../../lib/clickhouse/client';

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
}

interface BenchmarkResult {
  wallet: string;
  ui_pnl: number;
  v27_pnl: number;
  v23_pnl: number;
  v27_err: number;
  v23_err: number;
  v27_pass: boolean;
  v23_pass: boolean;
  splits: number;
  merges: number;
  events: number;
  is_mm: boolean;
  source_breakdown: {
    clob: number;
    split: number;
    merge: number;
    redemption: number;
  };
}

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function formatUSD(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

async function loadBenchmarkWallets(): Promise<BenchmarkWallet[]> {
  const query = `
    SELECT wallet, pnl_value as ui_pnl
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = 'fresh_2025_12_04_alltime'
    ORDER BY abs(pnl_value) DESC
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map((r) => ({
    wallet: r.wallet,
    ui_pnl: Number(r.ui_pnl),
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
  const TOLERANCE_TRADER = 1.0; // 1% for pure traders
  const TOLERANCE_MM = 5.0; // 5% for market makers

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                                    V27 INVENTORY ENGINE BENCHMARK                                                                                                                                       ║');
  console.log('║  State Machine: Tracks Inventory, Cost Basis, Cash Flow per (condition, outcome)                                                                                                                                        ║');
  console.log('║  Formula: PnL = cash_flow + (tokens × resolution_price)                                                                                                                                                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  // Load benchmark wallets
  const wallets = await loadBenchmarkWallets();
  console.log(`Loaded ${wallets.length} wallets from benchmark set 'fresh_2025_12_04_alltime'`);
  console.log('');

  console.log('-'.repeat(180));
  console.log(
    '#'.padEnd(4) +
      'Wallet'.padEnd(16) +
      'UI PnL'.padStart(14) +
      'V27 PnL'.padStart(14) +
      'V23 PnL'.padStart(14) +
      'V27 Err'.padStart(10) +
      'V23 Err'.padStart(10) +
      'V27'.padStart(6) +
      'V23'.padStart(6) +
      'Splits'.padStart(8) +
      'Merges'.padStart(8) +
      'Events'.padStart(8) +
      'MM'.padStart(4) +
      'CLOB'.padStart(8) +
      'Split'.padStart(8) +
      'Merge'.padStart(8) +
      'Redeem'.padStart(8)
  );
  console.log('-'.repeat(180));

  const results: BenchmarkResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    try {
      // Classify wallet
      const activity = await checkMergeActivity(w.wallet);
      const is_mm = activity.splits > 0 || activity.merges > 10;
      const tolerance = is_mm ? TOLERANCE_MM : TOLERANCE_TRADER;

      // Add delay to avoid ClickHouse memory pressure
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Calculate V27 PnL
      const v27 = await calculateV27PnL(w.wallet);

      // Calculate V23 PnL for comparison
      await new Promise((resolve) => setTimeout(resolve, 200));
      const v23 = await calculateV23PnL(w.wallet);

      const v27Err = errorPct(v27.realizedPnl, w.ui_pnl);
      const v23Err = errorPct(v23.realizedPnl, w.ui_pnl);
      const v27Pass = v27Err <= tolerance;
      const v23Pass = v23Err <= tolerance;

      const result: BenchmarkResult = {
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v27_pnl: v27.realizedPnl,
        v23_pnl: v23.realizedPnl,
        v27_err: v27Err,
        v23_err: v23Err,
        v27_pass: v27Pass,
        v23_pass: v23Pass,
        splits: activity.splits,
        merges: activity.merges,
        events: v27.eventsProcessed,
        is_mm,
        source_breakdown: {
          clob: v27.clobCashFlow,
          split: v27.splitCashFlow,
          merge: v27.mergeCashFlow,
          redemption: v27.redemptionCashFlow,
        },
      };
      results.push(result);

      // Print result row
      const errStr27 = v27Err < 1 ? `${v27Err.toFixed(2)}%` : v27Err < 10 ? `${v27Err.toFixed(1)}%` : `${v27Err.toFixed(0)}%`;
      const errStr23 = v23Err < 1 ? `${v23Err.toFixed(2)}%` : v23Err < 10 ? `${v23Err.toFixed(1)}%` : `${v23Err.toFixed(0)}%`;

      console.log(
        (i + 1).toString().padEnd(4) +
          w.wallet.substring(0, 14).padEnd(16) +
          formatCompact(w.ui_pnl).padStart(14) +
          formatCompact(v27.realizedPnl).padStart(14) +
          formatCompact(v23.realizedPnl).padStart(14) +
          errStr27.padStart(10) +
          errStr23.padStart(10) +
          (v27Pass ? 'PASS' : 'FAIL').padStart(6) +
          (v23Pass ? 'PASS' : 'FAIL').padStart(6) +
          activity.splits.toLocaleString().padStart(8) +
          activity.merges.toLocaleString().padStart(8) +
          v27.eventsProcessed.toLocaleString().padStart(8) +
          (is_mm ? 'Y' : 'N').padStart(4) +
          formatCompact(v27.clobCashFlow).padStart(8) +
          formatCompact(v27.splitCashFlow).padStart(8) +
          formatCompact(v27.mergeCashFlow).padStart(8) +
          formatCompact(v27.redemptionCashFlow).padStart(8)
      );
    } catch (e) {
      console.log(`${(i + 1).toString().padEnd(4)}${w.wallet.substring(0, 14).padEnd(16)} ERROR: ${e}`);
    }
  }

  // Summary Statistics
  console.log('');
  console.log('='.repeat(180));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(180));

  const v27Errors = results.map((r) => r.v27_err);
  const v23Errors = results.map((r) => r.v23_err);

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  const mean = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  console.log('');
  console.log('Error Statistics:');
  console.log(`  V27 Inventory - Median: ${median(v27Errors).toFixed(2)}%, Mean: ${mean(v27Errors).toFixed(2)}%`);
  console.log(`  V23 CLOB-only - Median: ${median(v23Errors).toFixed(2)}%, Mean: ${mean(v23Errors).toFixed(2)}%`);

  // Pass rates by category
  const traders = results.filter((r) => !r.is_mm);
  const marketMakers = results.filter((r) => r.is_mm);

  const v27TraderPass = traders.filter((r) => r.v27_pass).length;
  const v23TraderPass = traders.filter((r) => r.v23_pass).length;
  const v27MMPass = marketMakers.filter((r) => r.v27_pass).length;
  const v23MMPass = marketMakers.filter((r) => r.v23_pass).length;
  const v27TotalPass = results.filter((r) => r.v27_pass).length;
  const v23TotalPass = results.filter((r) => r.v23_pass).length;

  console.log('');
  console.log('Pass Rates:');
  console.log(`  Pure Traders (${traders.length} wallets, <${TOLERANCE_TRADER}% threshold):`);
  console.log(`    V27: ${v27TraderPass}/${traders.length} (${traders.length > 0 ? ((v27TraderPass / traders.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log(`    V23: ${v23TraderPass}/${traders.length} (${traders.length > 0 ? ((v23TraderPass / traders.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log('');
  console.log(`  Market Makers (${marketMakers.length} wallets, <${TOLERANCE_MM}% threshold):`);
  console.log(`    V27: ${v27MMPass}/${marketMakers.length} (${marketMakers.length > 0 ? ((v27MMPass / marketMakers.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log(`    V23: ${v23MMPass}/${marketMakers.length} (${marketMakers.length > 0 ? ((v23MMPass / marketMakers.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log('');
  console.log(`  OVERALL (${results.length} wallets):`);
  console.log(`    V27: ${v27TotalPass}/${results.length} (${results.length > 0 ? ((v27TotalPass / results.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log(`    V23: ${v23TotalPass}/${results.length} (${results.length > 0 ? ((v23TotalPass / results.length) * 100).toFixed(1) : 'N/A'}%)`);

  // Cash flow breakdown
  const totalClobFlow = results.reduce((sum, r) => sum + r.source_breakdown.clob, 0);
  const totalSplitFlow = results.reduce((sum, r) => sum + r.source_breakdown.split, 0);
  const totalMergeFlow = results.reduce((sum, r) => sum + r.source_breakdown.merge, 0);
  const totalRedeemFlow = results.reduce((sum, r) => sum + r.source_breakdown.redemption, 0);

  console.log('');
  console.log('Cash Flow Breakdown (across all wallets):');
  console.log(`  CLOB:       ${formatUSD(totalClobFlow)}`);
  console.log(`  Split:      ${formatUSD(totalSplitFlow)}`);
  console.log(`  Merge:      ${formatUSD(totalMergeFlow)}`);
  console.log(`  Redemption: ${formatUSD(totalRedeemFlow)}`);

  // Final Verdict
  console.log('');
  console.log('='.repeat(180));
  const v27OverallPass = (v27TotalPass / results.length) * 100;
  const v23OverallPass = (v23TotalPass / results.length) * 100;
  const v27Success = v27OverallPass >= 90;

  if (v27Success) {
    console.log(`FINAL VERDICT: V27 SUCCESS - ${v27OverallPass.toFixed(1)}% pass rate (target: 90%)`);
  } else {
    console.log(`FINAL VERDICT: V27 NEEDS WORK - ${v27OverallPass.toFixed(1)}% pass rate (target: 90%)`);
  }
  console.log(`               V23 Comparison: ${v23OverallPass.toFixed(1)}% pass rate`);
  console.log('='.repeat(180));

  // Show improvement analysis
  console.log('');
  console.log('IMPROVEMENT ANALYSIS (V27 vs V23):');
  const improvements: { wallet: string; v23_err: number; v27_err: number; improvement: number }[] = [];
  const regressions: { wallet: string; v23_err: number; v27_err: number; regression: number }[] = [];

  for (const r of results) {
    const diff = r.v23_err - r.v27_err;
    if (diff > 1) {
      improvements.push({ wallet: r.wallet, v23_err: r.v23_err, v27_err: r.v27_err, improvement: diff });
    } else if (diff < -1) {
      regressions.push({ wallet: r.wallet, v23_err: r.v23_err, v27_err: r.v27_err, regression: -diff });
    }
  }

  improvements.sort((a, b) => b.improvement - a.improvement);
  regressions.sort((a, b) => b.regression - a.regression);

  console.log(`  Wallets improved: ${improvements.length}`);
  if (improvements.length > 0) {
    console.log('  Top 5 improvements:');
    for (const imp of improvements.slice(0, 5)) {
      console.log(`    ${imp.wallet.substring(0, 14)}... V23: ${imp.v23_err.toFixed(1)}% → V27: ${imp.v27_err.toFixed(1)}% (${imp.improvement.toFixed(1)}% better)`);
    }
  }

  console.log(`  Wallets regressed: ${regressions.length}`);
  if (regressions.length > 0) {
    console.log('  Top 5 regressions:');
    for (const reg of regressions.slice(0, 5)) {
      console.log(`    ${reg.wallet.substring(0, 14)}... V23: ${reg.v23_err.toFixed(1)}% → V27: ${reg.v27_err.toFixed(1)}% (${reg.regression.toFixed(1)}% worse)`);
    }
  }

  // Show worst V27 performers
  console.log('');
  console.log('Worst V27 Performers (top 10 by error):');
  const worstV27 = [...results].sort((a, b) => b.v27_err - a.v27_err).slice(0, 10);
  for (const r of worstV27) {
    console.log(
      `  ${r.wallet.substring(0, 14)}... UI: ${formatCompact(r.ui_pnl)}, V27: ${formatCompact(r.v27_pnl)}, Err: ${r.v27_err.toFixed(1)}%, MM: ${r.is_mm ? 'Y' : 'N'}, Events: ${r.events}`
    );
  }

  console.log('');
  console.log('Terminal: Claude 1');
}

runBenchmark().catch(console.error);
