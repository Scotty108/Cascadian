/**
 * V27b INVENTORY ENGINE BENCHMARK
 *
 * Tests V27b against the 40-wallet benchmark set from fresh_2025_12_04_alltime
 *
 * V27b STRATEGY (PURE INVENTORY MATH):
 * - NO global USDC sums (fixes V27's double-counting)
 * - Each trade realizes PnL = Revenue - CostOfGoodsSold
 * - PayoutRedemption = Final Sell (not double-counted)
 * - Average cost method for cost basis tracking
 *
 * WHY V27b EXISTS:
 * - V27 mixed Ledger Math (Sum USDC) with Inventory Math (Qty × Price)
 * - This caused 1000%+ errors for wallets with large redemptions
 * - V27b uses PURE inventory accounting: Revenue - COGS only
 *
 * SUCCESS METRICS:
 * - Market Makers (W4 category): < 5% error
 * - Redemption wallets: NO 500%+ errors
 * - Overall Pass Rate: > 80%
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { calculateV27bQuick, V27bQuickResult } from '../../lib/pnl/inventoryEngineV27b';
import { calculateV23PnL } from '../../lib/pnl/shadowLedgerV23';
import { clickhouse } from '../../lib/clickhouse/client';

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
}

interface BenchmarkResult {
  wallet: string;
  ui_pnl: number;
  v27b_pnl: number;
  v23_pnl: number;
  v27b_err: number;
  v23_err: number;
  v27b_pass: boolean;
  v23_pass: boolean;
  splits: number;
  merges: number;
  events: number;
  is_mm: boolean;
  redemptionCount: number;
  redemptionUSDC: number;
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

async function checkMergeActivity(wallet: string): Promise<{
  splits: number;
  merges: number;
  redemptionCount: number;
  redemptionUSDC: number;
}> {
  const query = `
    SELECT
      countIf(source_type = 'PositionSplit') as splits,
      countIf(source_type = 'PositionsMerge') as merges,
      countIf(source_type = 'PayoutRedemption') as redemptionCount,
      sumIf(abs(usdc_delta), source_type = 'PayoutRedemption') as redemptionUSDC
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  if (rows.length === 0) return { splits: 0, merges: 0, redemptionCount: 0, redemptionUSDC: 0 };
  return {
    splits: Number(rows[0].splits) || 0,
    merges: Number(rows[0].merges) || 0,
    redemptionCount: Number(rows[0].redemptionCount) || 0,
    redemptionUSDC: Number(rows[0].redemptionUSDC) || 0,
  };
}

async function runBenchmark() {
  const TOLERANCE_TRADER = 1.0; // 1% for pure traders
  const TOLERANCE_MM = 5.0; // 5% for market makers

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                                    V27b INVENTORY ENGINE BENCHMARK (PURE INVENTORY MATH)                                                                                                               ║');
  console.log('║  FIX: No global USDC sums. PnL = Revenue - COGS per trade. PayoutRedemption = Final Sell (not double-counted).                                                                                                          ║');
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
      'V27b PnL'.padStart(14) +
      'V23 PnL'.padStart(14) +
      'V27b Err'.padStart(10) +
      'V23 Err'.padStart(10) +
      'V27b'.padStart(6) +
      'V23'.padStart(6) +
      'Splits'.padStart(8) +
      'Merges'.padStart(8) +
      'Events'.padStart(8) +
      'MM'.padStart(4) +
      'RedCount'.padStart(10) +
      'RedUSDC'.padStart(12)
  );
  console.log('-'.repeat(180));

  const results: BenchmarkResult[] = [];
  let errorCount = 0;

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    try {
      // Classify wallet
      const activity = await checkMergeActivity(w.wallet);
      const is_mm = activity.splits > 0 || activity.merges > 10;
      const tolerance = is_mm ? TOLERANCE_MM : TOLERANCE_TRADER;

      // Add delay to avoid ClickHouse memory pressure
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Calculate V27b PnL
      let v27b: V27bQuickResult;
      try {
        v27b = await calculateV27bQuick(w.wallet);
      } catch (e) {
        console.log(`${(i + 1).toString().padEnd(4)}${w.wallet.substring(0, 14).padEnd(16)} V27b ERROR: ${e}`);
        errorCount++;
        continue;
      }

      // Calculate V23 PnL for comparison
      await new Promise((resolve) => setTimeout(resolve, 200));
      const v23 = await calculateV23PnL(w.wallet);

      const v27bErr = errorPct(v27b.totalPnl, w.ui_pnl);
      const v23Err = errorPct(v23.realizedPnl, w.ui_pnl);
      const v27bPass = v27bErr <= tolerance;
      const v23Pass = v23Err <= tolerance;

      const result: BenchmarkResult = {
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v27b_pnl: v27b.totalPnl,
        v23_pnl: v23.realizedPnl,
        v27b_err: v27bErr,
        v23_err: v23Err,
        v27b_pass: v27bPass,
        v23_pass: v23Pass,
        splits: activity.splits,
        merges: activity.merges,
        events: v27b.eventsProcessed,
        is_mm,
        redemptionCount: activity.redemptionCount,
        redemptionUSDC: activity.redemptionUSDC,
      };
      results.push(result);

      // Print result row
      const errStr27b = v27bErr < 1 ? `${v27bErr.toFixed(2)}%` : v27bErr < 10 ? `${v27bErr.toFixed(1)}%` : `${v27bErr.toFixed(0)}%`;
      const errStr23 = v23Err < 1 ? `${v23Err.toFixed(2)}%` : v23Err < 10 ? `${v23Err.toFixed(1)}%` : `${v23Err.toFixed(0)}%`;

      console.log(
        (i + 1).toString().padEnd(4) +
          w.wallet.substring(0, 14).padEnd(16) +
          formatCompact(w.ui_pnl).padStart(14) +
          formatCompact(v27b.totalPnl).padStart(14) +
          formatCompact(v23.realizedPnl).padStart(14) +
          errStr27b.padStart(10) +
          errStr23.padStart(10) +
          (v27bPass ? 'PASS' : 'FAIL').padStart(6) +
          (v23Pass ? 'PASS' : 'FAIL').padStart(6) +
          activity.splits.toLocaleString().padStart(8) +
          activity.merges.toLocaleString().padStart(8) +
          v27b.eventsProcessed.toLocaleString().padStart(8) +
          (is_mm ? 'Y' : 'N').padStart(4) +
          activity.redemptionCount.toLocaleString().padStart(10) +
          formatCompact(activity.redemptionUSDC).padStart(12)
      );
    } catch (e) {
      console.log(`${(i + 1).toString().padEnd(4)}${w.wallet.substring(0, 14).padEnd(16)} ERROR: ${e}`);
      errorCount++;
    }
  }

  // Summary Statistics
  console.log('');
  console.log('='.repeat(180));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(180));

  const v27bErrors = results.map((r) => r.v27b_err);
  const v23Errors = results.map((r) => r.v23_err);

  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  const mean = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  console.log('');
  console.log('Error Statistics:');
  console.log(`  V27b Inventory  - Median: ${median(v27bErrors).toFixed(2)}%, Mean: ${mean(v27bErrors).toFixed(2)}%`);
  console.log(`  V23 CLOB-only   - Median: ${median(v23Errors).toFixed(2)}%, Mean: ${mean(v23Errors).toFixed(2)}%`);

  // Pass rates by category
  const traders = results.filter((r) => !r.is_mm);
  const marketMakers = results.filter((r) => r.is_mm);

  const v27bTraderPass = traders.filter((r) => r.v27b_pass).length;
  const v23TraderPass = traders.filter((r) => r.v23_pass).length;
  const v27bMMPass = marketMakers.filter((r) => r.v27b_pass).length;
  const v23MMPass = marketMakers.filter((r) => r.v23_pass).length;
  const v27bTotalPass = results.filter((r) => r.v27b_pass).length;
  const v23TotalPass = results.filter((r) => r.v23_pass).length;

  console.log('');
  console.log('Pass Rates:');
  console.log(`  Pure Traders (${traders.length} wallets, <${TOLERANCE_TRADER}% threshold):`);
  console.log(`    V27b: ${v27bTraderPass}/${traders.length} (${traders.length > 0 ? ((v27bTraderPass / traders.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log(`    V23:  ${v23TraderPass}/${traders.length} (${traders.length > 0 ? ((v23TraderPass / traders.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log('');
  console.log(`  Market Makers (${marketMakers.length} wallets, <${TOLERANCE_MM}% threshold):`);
  console.log(`    V27b: ${v27bMMPass}/${marketMakers.length} (${marketMakers.length > 0 ? ((v27bMMPass / marketMakers.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log(`    V23:  ${v23MMPass}/${marketMakers.length} (${marketMakers.length > 0 ? ((v23MMPass / marketMakers.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log('');
  console.log(`  OVERALL (${results.length} wallets):`);
  console.log(`    V27b: ${v27bTotalPass}/${results.length} (${results.length > 0 ? ((v27bTotalPass / results.length) * 100).toFixed(1) : 'N/A'}%)`);
  console.log(`    V23:  ${v23TotalPass}/${results.length} (${results.length > 0 ? ((v23TotalPass / results.length) * 100).toFixed(1) : 'N/A'}%)`);

  // Redemption wallet analysis (KEY METRIC: No 500%+ errors)
  console.log('');
  console.log('REDEMPTION WALLET ANALYSIS (Key Success Metric):');
  const redemptionWallets = results.filter((r) => r.redemptionCount > 0);
  const largeRedemptions = redemptionWallets.filter((r) => r.redemptionUSDC > 1000000);
  const v27bLargeRedemptionErrors = largeRedemptions.map((r) => r.v27b_err);
  const v27b500PlusErrors = largeRedemptions.filter((r) => r.v27b_err >= 500);

  console.log(`  Wallets with redemptions: ${redemptionWallets.length}`);
  console.log(`  Wallets with large redemptions (>$1M): ${largeRedemptions.length}`);
  console.log(`  V27b large redemption errors: Median ${median(v27bLargeRedemptionErrors).toFixed(2)}%, Mean ${mean(v27bLargeRedemptionErrors).toFixed(2)}%`);
  console.log(`  V27b 500%+ errors on large redemptions: ${v27b500PlusErrors.length} (TARGET: 0)`);

  if (v27b500PlusErrors.length > 0) {
    console.log('  FAILED wallets (500%+ error):');
    for (const r of v27b500PlusErrors) {
      console.log(`    ${r.wallet.substring(0, 14)}... UI: ${formatCompact(r.ui_pnl)}, V27b: ${formatCompact(r.v27b_pnl)}, Err: ${r.v27b_err.toFixed(1)}%`);
    }
  }

  // Final Verdict
  console.log('');
  console.log('='.repeat(180));
  const v27bOverallPass = results.length > 0 ? (v27bTotalPass / results.length) * 100 : 0;
  const v23OverallPass = results.length > 0 ? (v23TotalPass / results.length) * 100 : 0;
  const v27bSuccess = v27bOverallPass >= 80 && v27b500PlusErrors.length === 0;

  const mmPassRate = marketMakers.length > 0 ? (v27bMMPass / marketMakers.length) * 100 : 100;

  console.log('SUCCESS CRITERIA CHECK:');
  console.log(`  ✓/✗ Market Makers < 5% error: ${mmPassRate >= 80 ? '✓' : '✗'} (${mmPassRate.toFixed(1)}% pass rate)`);
  console.log(`  ✓/✗ No 500%+ redemption errors: ${v27b500PlusErrors.length === 0 ? '✓' : '✗'} (${v27b500PlusErrors.length} failures)`);
  console.log(`  ✓/✗ Overall > 80% pass rate: ${v27bOverallPass >= 80 ? '✓' : '✗'} (${v27bOverallPass.toFixed(1)}%)`);
  console.log('');

  if (v27bSuccess) {
    console.log(`FINAL VERDICT: V27b SUCCESS - ${v27bOverallPass.toFixed(1)}% pass rate, 0 500%+ errors`);
  } else {
    console.log(`FINAL VERDICT: V27b NEEDS WORK - ${v27bOverallPass.toFixed(1)}% pass rate, ${v27b500PlusErrors.length} 500%+ errors`);
  }
  console.log(`               V23 Comparison: ${v23OverallPass.toFixed(1)}% pass rate`);
  console.log('='.repeat(180));

  // Show improvement analysis
  console.log('');
  console.log('IMPROVEMENT ANALYSIS (V27b vs V23):');
  const improvements: { wallet: string; v23_err: number; v27b_err: number; improvement: number }[] = [];
  const regressions: { wallet: string; v23_err: number; v27b_err: number; regression: number }[] = [];

  for (const r of results) {
    const diff = r.v23_err - r.v27b_err;
    if (diff > 1) {
      improvements.push({ wallet: r.wallet, v23_err: r.v23_err, v27b_err: r.v27b_err, improvement: diff });
    } else if (diff < -1) {
      regressions.push({ wallet: r.wallet, v23_err: r.v23_err, v27b_err: r.v27b_err, regression: -diff });
    }
  }

  improvements.sort((a, b) => b.improvement - a.improvement);
  regressions.sort((a, b) => b.regression - a.regression);

  console.log(`  Wallets improved: ${improvements.length}`);
  if (improvements.length > 0) {
    console.log('  Top 5 improvements:');
    for (const imp of improvements.slice(0, 5)) {
      console.log(`    ${imp.wallet.substring(0, 14)}... V23: ${imp.v23_err.toFixed(1)}% → V27b: ${imp.v27b_err.toFixed(1)}% (${imp.improvement.toFixed(1)}% better)`);
    }
  }

  console.log(`  Wallets regressed: ${regressions.length}`);
  if (regressions.length > 0) {
    console.log('  Top 5 regressions:');
    for (const reg of regressions.slice(0, 5)) {
      console.log(`    ${reg.wallet.substring(0, 14)}... V23: ${reg.v23_err.toFixed(1)}% → V27b: ${reg.v27b_err.toFixed(1)}% (${reg.regression.toFixed(1)}% worse)`);
    }
  }

  // Show worst V27b performers
  console.log('');
  console.log('Worst V27b Performers (top 10 by error):');
  const worstV27b = [...results].sort((a, b) => b.v27b_err - a.v27b_err).slice(0, 10);
  for (const r of worstV27b) {
    console.log(
      `  ${r.wallet.substring(0, 14)}... UI: ${formatCompact(r.ui_pnl)}, V27b: ${formatCompact(r.v27b_pnl)}, Err: ${r.v27b_err.toFixed(1)}%, MM: ${r.is_mm ? 'Y' : 'N'}, Events: ${r.events}, RedUSDC: ${formatCompact(r.redemptionUSDC)}`
    );
  }

  if (errorCount > 0) {
    console.log('');
    console.log(`⚠️  ${errorCount} wallets had errors and were excluded from statistics`);
  }

  console.log('');
  console.log('Terminal: Claude 1');
}

runBenchmark().catch(console.error);
