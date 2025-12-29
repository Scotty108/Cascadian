/**
 * ============================================================================
 * V23c UI ORACLE BENCHMARK
 * ============================================================================
 *
 * PURPOSE: Validate V23c (UI Price Oracle) on full 40-wallet benchmark set.
 *
 * HYPOTHESIS: Using pm_market_metadata.outcome_prices (same as UI) will achieve
 *             near-100% accuracy for trader wallets.
 *
 * COMPARISON:
 * - V23:  Uses $0.50 default for unresolved positions
 * - V23b: Uses last_trade_price for unresolved positions
 * - V23c: Uses pm_market_metadata.outcome_prices for unresolved positions
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV23PnL } from '../../lib/pnl/shadowLedgerV23';
import { calculateV23bPnL } from '../../lib/pnl/shadowLedgerV23b';
import { calculateV23cPnL } from '../../lib/pnl/shadowLedgerV23c';
import { isMarketMaker, getActivityCounts } from '../../lib/pnl/walletClassifier';

// ============================================================================
// Types
// ============================================================================

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
}

interface BenchmarkResult {
  wallet: string;
  ui_pnl: number;
  v23_pnl: number;
  v23b_pnl: number;
  v23c_pnl: number;
  v23_error_pct: number;
  v23b_error_pct: number;
  v23c_error_pct: number;
  v23_pass: boolean;
  v23b_pass: boolean;
  v23c_pass: boolean;
  is_maker: boolean;
  unresolvedConditions: number;
  uiPricesLoaded: number;
  verdict: string;
}

// ============================================================================
// Helpers
// ============================================================================

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function formatPnL(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ============================================================================
// Data Loading
// ============================================================================

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

// ============================================================================
// Benchmark
// ============================================================================

async function benchmarkWallet(
  wallet: string,
  ui_pnl: number
): Promise<BenchmarkResult> {
  // Get activity counts for maker detection
  const activity = await getActivityCounts(wallet);
  const is_maker = isMarketMaker(activity);

  // Calculate V23 (baseline)
  const v23Result = await calculateV23PnL(wallet);
  const v23_pnl = v23Result.totalPnl;
  const v23_error_pct = errorPct(v23_pnl, ui_pnl);
  const v23_pass = !is_maker && v23_error_pct < 1.0;

  // Calculate V23b (Mark-to-Market with last_trade_price)
  const v23bResult = await calculateV23bPnL(wallet, { markToMarket: true });
  const v23b_pnl = v23bResult.totalPnl;
  const v23b_error_pct = errorPct(v23b_pnl, ui_pnl);
  const v23b_pass = !is_maker && v23b_error_pct < 1.0;

  // Calculate V23c (UI Oracle with pm_market_metadata.outcome_prices)
  const v23cResult = await calculateV23cPnL(wallet, { useUIOracle: true });
  const v23c_pnl = v23cResult.totalPnl;
  const v23c_error_pct = errorPct(v23c_pnl, ui_pnl);
  const v23c_pass = !is_maker && v23c_error_pct < 1.0;

  // Determine verdict
  let verdict: string;
  if (is_maker) {
    verdict = 'MAKER';
  } else if (v23c_pass && v23b_pass && v23_pass) {
    verdict = 'PASS_ALL';
  } else if (v23c_pass && !v23b_pass) {
    verdict = 'V23C_FIXES_V23B'; // V23c fixed V23b regression/failure
  } else if (v23c_pass && !v23_pass) {
    verdict = 'V23C_FIXES_V23'; // V23c fixed V23 failure
  } else if (!v23c_pass && v23b_pass) {
    verdict = 'V23C_REGRESSED'; // V23c made it worse
  } else if (v23c_pass) {
    verdict = 'V23C_PASS';
  } else {
    verdict = 'FAIL_ALL';
  }

  return {
    wallet,
    ui_pnl,
    v23_pnl,
    v23b_pnl,
    v23c_pnl,
    v23_error_pct,
    v23b_error_pct,
    v23c_error_pct,
    v23_pass,
    v23b_pass,
    v23c_pass,
    is_maker,
    unresolvedConditions: v23cResult.unresolvedConditions,
    uiPricesLoaded: v23cResult.uiPricesLoaded,
    verdict,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                  V23c UI ORACLE BENCHMARK                                             ║');
  console.log('║  MISSION: Validate V23c (pm_market_metadata.outcome_prices) achieves near-100% accuracy               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  // Load wallets
  const wallets = await loadBenchmarkWallets();
  console.log(`Loaded ${wallets.length} wallets from benchmark set 'fresh_2025_12_04_alltime'`);
  console.log('');

  // Run benchmark
  const results: BenchmarkResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    process.stdout.write(`\r[${i + 1}/${wallets.length}] ${w.wallet.substring(0, 16)}...`);

    try {
      const result = await benchmarkWallet(w.wallet, w.ui_pnl);
      results.push(result);
    } catch (err: any) {
      console.log(`\n  Error: ${err.message}`);
    }
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nCompleted ${results.length} wallets in ${elapsedSec}s`);
  console.log('');

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log('');

  const nonMaker = results.filter((r) => !r.is_maker);
  const makerCount = results.filter((r) => r.is_maker).length;

  const v23PassCount = nonMaker.filter((r) => r.v23_pass).length;
  const v23bPassCount = nonMaker.filter((r) => r.v23b_pass).length;
  const v23cPassCount = nonMaker.filter((r) => r.v23c_pass).length;

  const v23PassRate = (v23PassCount / nonMaker.length) * 100;
  const v23bPassRate = (v23bPassCount / nonMaker.length) * 100;
  const v23cPassRate = (v23cPassCount / nonMaker.length) * 100;

  console.log('PASS RATES (excludes MAKERs):');
  console.log('');
  console.log(`| Engine | Pass | Total | Pass Rate | Avg Error |`);
  console.log(`|--------|------|-------|-----------|-----------|`);

  const v23AvgErr = (nonMaker.reduce((s, r) => s + r.v23_error_pct, 0) / nonMaker.length).toFixed(2);
  const v23bAvgErr = (nonMaker.reduce((s, r) => s + r.v23b_error_pct, 0) / nonMaker.length).toFixed(2);
  const v23cAvgErr = (nonMaker.reduce((s, r) => s + r.v23c_error_pct, 0) / nonMaker.length).toFixed(2);

  console.log(`| V23 (baseline)       | ${String(v23PassCount).padStart(4)} | ${String(nonMaker.length).padStart(5)} | ${v23PassRate.toFixed(1).padStart(8)}% | ${v23AvgErr.padStart(8)}% |`);
  console.log(`| V23b (last_trade)    | ${String(v23bPassCount).padStart(4)} | ${String(nonMaker.length).padStart(5)} | ${v23bPassRate.toFixed(1).padStart(8)}% | ${v23bAvgErr.padStart(8)}% |`);
  console.log(`| V23c (UI oracle)     | ${String(v23cPassCount).padStart(4)} | ${String(nonMaker.length).padStart(5)} | ${v23cPassRate.toFixed(1).padStart(8)}% | ${v23cAvgErr.padStart(8)}% |`);
  console.log('');
  console.log(`MAKERs (excluded): ${makerCount}`);
  console.log('');

  // Count verdicts
  const verdictCounts: Record<string, number> = {};
  for (const r of results) {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
  }

  console.log('VERDICT DISTRIBUTION:');
  console.log('');
  for (const [verdict, count] of Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict.padEnd(20)}: ${count}`);
  }
  console.log('');

  // ============================================================================
  // SUCCESS CRITERIA
  // ============================================================================
  console.log('═'.repeat(100));
  console.log('SUCCESS CRITERIA');
  console.log('═'.repeat(100));
  console.log('');

  const v23cFixesV23b = results.filter((r) => r.verdict === 'V23C_FIXES_V23B').length;
  const v23cRegressed = results.filter((r) => r.verdict === 'V23C_REGRESSED').length;
  const failAll = results.filter((r) => r.verdict === 'FAIL_ALL').length;

  const criteria = [
    {
      name: 'V23c PASS RATE > V23b',
      pass: v23cPassRate > v23bPassRate,
      detail: `${v23cPassRate.toFixed(1)}% vs ${v23bPassRate.toFixed(1)}%`,
    },
    {
      name: 'NO V23c REGRESSIONS',
      pass: v23cRegressed === 0,
      detail: `${v23cRegressed} wallets regressed`,
    },
    {
      name: 'V23c FIXES V23b REGRESSION',
      pass: v23cFixesV23b > 0 || v23cRegressed === 0,
      detail: v23cFixesV23b > 0 ? `${v23cFixesV23b} wallets fixed` : 'No V23b regressions to fix',
    },
    {
      name: 'V23c AVG ERROR < 1%',
      pass: parseFloat(v23cAvgErr) < 1.0,
      detail: `${v23cAvgErr}% average error`,
    },
  ];

  let allPass = true;
  for (const c of criteria) {
    const status = c.pass ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${status}: ${c.name} - ${c.detail}`);
    if (!c.pass) allPass = false;
  }
  console.log('');

  if (allPass) {
    console.log('  ✓✓✓ ALL SUCCESS CRITERIA MET - V23c IS READY FOR PRODUCTION ✓✓✓');
  } else {
    console.log('  ✗✗✗ SOME CRITERIA FAILED - NEEDS INVESTIGATION ✗✗✗');
  }
  console.log('');

  // ============================================================================
  // DETAILED RESULTS - V23c FIXES
  // ============================================================================
  if (v23cFixesV23b > 0) {
    console.log('═'.repeat(100));
    console.log('V23c FIXES V23b REGRESSION');
    console.log('═'.repeat(100));
    console.log('');

    const fixed = results.filter((r) => r.verdict === 'V23C_FIXES_V23B');
    for (const r of fixed) {
      console.log(`  ${r.wallet}`);
      console.log(`    UI PnL: ${formatPnL(r.ui_pnl)}`);
      console.log(`    V23b: ${formatPnL(r.v23b_pnl)} (${r.v23b_error_pct.toFixed(2)}% error) FAIL`);
      console.log(`    V23c: ${formatPnL(r.v23c_pnl)} (${r.v23c_error_pct.toFixed(2)}% error) PASS`);
      console.log(`    UI Prices: ${r.uiPricesLoaded} | Unresolved: ${r.unresolvedConditions}`);
      console.log('');
    }
  }

  // ============================================================================
  // DETAILED RESULTS - REGRESSIONS
  // ============================================================================
  if (v23cRegressed > 0) {
    console.log('═'.repeat(100));
    console.log('V23c REGRESSIONS (CRITICAL!)');
    console.log('═'.repeat(100));
    console.log('');

    const regressed = results.filter((r) => r.verdict === 'V23C_REGRESSED');
    for (const r of regressed) {
      console.log(`  ${r.wallet}`);
      console.log(`    UI PnL: ${formatPnL(r.ui_pnl)}`);
      console.log(`    V23b: ${formatPnL(r.v23b_pnl)} (${r.v23b_error_pct.toFixed(2)}% error) PASS`);
      console.log(`    V23c: ${formatPnL(r.v23c_pnl)} (${r.v23c_error_pct.toFixed(2)}% error) FAIL`);
      console.log(`    UI Prices: ${r.uiPricesLoaded} | Unresolved: ${r.unresolvedConditions}`);
      console.log('');
    }
  }

  // ============================================================================
  // DETAILED RESULTS - FAIL ALL
  // ============================================================================
  if (failAll > 0) {
    console.log('═'.repeat(100));
    console.log('FAIL ALL (needs further investigation)');
    console.log('═'.repeat(100));
    console.log('');

    const failedAll = results.filter((r) => r.verdict === 'FAIL_ALL');
    for (const r of failedAll) {
      console.log(`  ${r.wallet}`);
      console.log(`    UI PnL: ${formatPnL(r.ui_pnl)}`);
      console.log(`    V23:  ${formatPnL(r.v23_pnl)} (${r.v23_error_pct.toFixed(2)}% error)`);
      console.log(`    V23b: ${formatPnL(r.v23b_pnl)} (${r.v23b_error_pct.toFixed(2)}% error)`);
      console.log(`    V23c: ${formatPnL(r.v23c_pnl)} (${r.v23c_error_pct.toFixed(2)}% error)`);
      console.log(`    UI Prices: ${r.uiPricesLoaded} | Unresolved: ${r.unresolvedConditions}`);
      console.log('');
    }
  }

  // ============================================================================
  // FULL RESULTS TABLE
  // ============================================================================
  console.log('═'.repeat(100));
  console.log('FULL RESULTS');
  console.log('═'.repeat(100));
  console.log('');

  console.log('| Wallet | UI PnL | V23 Err | V23b Err | V23c Err | Verdict |');
  console.log('|--------|--------|---------|----------|----------|---------|');

  for (const r of results.sort((a, b) => a.v23c_error_pct - b.v23c_error_pct)) {
    const walletShort = r.wallet.substring(0, 10) + '...';
    console.log(
      `| ${walletShort} | ${formatPnL(r.ui_pnl).padStart(10)} | ${r.v23_error_pct.toFixed(2).padStart(6)}% | ${r.v23b_error_pct.toFixed(2).padStart(7)}% | ${r.v23c_error_pct.toFixed(2).padStart(7)}% | ${r.verdict} |`
    );
  }
  console.log('');

  // ============================================================================
  // FOOTER
  // ============================================================================
  console.log('═'.repeat(100));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(100));
}

main().catch(console.error);
