/**
 * ============================================================================
 * V23b MARK-TO-MARKET BENCHMARK
 * ============================================================================
 *
 * PURPOSE: Validate V23b Mark-to-Market fixes UNKNOWN wallets without
 *          regressing PASS wallets.
 *
 * SUCCESS CRITERIA:
 * 1. NO REGRESSION: All V23 PASS wallets must still pass V23b
 * 2. FIX UNKNOWNS: V23b should convert some UNKNOWN wallets to PASS
 * 3. PASS RATE: Should be higher than V23's 51.3%
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV23PnL } from '../../lib/pnl/shadowLedgerV23';
import { calculateV23bPnL } from '../../lib/pnl/shadowLedgerV23b';
import { classifyWallet, isMarketMaker, getActivityCounts } from '../../lib/pnl/walletClassifier';

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
  v23_error_pct: number;
  v23b_error_pct: number;
  v23_pass: boolean;
  v23b_pass: boolean;
  is_maker: boolean;
  unresolvedConditions: number;
  lastPricesLoaded: number;
  verdict: 'PASS_BOTH' | 'FIX_BY_V23B' | 'REGRESSED' | 'FAIL_BOTH' | 'MAKER';
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

  // Calculate V23b (Mark-to-Market)
  const v23bResult = await calculateV23bPnL(wallet, { markToMarket: true });
  const v23b_pnl = v23bResult.totalPnl;
  const v23b_error_pct = errorPct(v23b_pnl, ui_pnl);
  const v23b_pass = !is_maker && v23b_error_pct < 1.0;

  // Determine verdict
  let verdict: BenchmarkResult['verdict'];
  if (is_maker) {
    verdict = 'MAKER';
  } else if (v23_pass && v23b_pass) {
    verdict = 'PASS_BOTH';
  } else if (!v23_pass && v23b_pass) {
    verdict = 'FIX_BY_V23B';
  } else if (v23_pass && !v23b_pass) {
    verdict = 'REGRESSED';
  } else {
    verdict = 'FAIL_BOTH';
  }

  return {
    wallet,
    ui_pnl,
    v23_pnl,
    v23b_pnl,
    v23_error_pct,
    v23b_error_pct,
    v23_pass,
    v23b_pass,
    is_maker,
    unresolvedConditions: v23bResult.unresolvedConditions,
    lastPricesLoaded: v23bResult.lastPricesLoaded,
    verdict,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                  V23b MARK-TO-MARKET BENCHMARK                                        ║');
  console.log('║  MISSION: Validate V23b fixes UNKNOWN wallets without regressing PASS wallets                         ║');
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

  // Count verdicts
  const verdictCounts = {
    PASS_BOTH: results.filter((r) => r.verdict === 'PASS_BOTH').length,
    FIX_BY_V23B: results.filter((r) => r.verdict === 'FIX_BY_V23B').length,
    REGRESSED: results.filter((r) => r.verdict === 'REGRESSED').length,
    FAIL_BOTH: results.filter((r) => r.verdict === 'FAIL_BOTH').length,
    MAKER: results.filter((r) => r.verdict === 'MAKER').length,
  };

  const nonMaker = results.filter((r) => !r.is_maker);
  const v23PassRate = (nonMaker.filter((r) => r.v23_pass).length / nonMaker.length) * 100;
  const v23bPassRate = (nonMaker.filter((r) => r.v23b_pass).length / nonMaker.length) * 100;

  console.log('| Verdict     | Count | Description                                    |');
  console.log('|-------------|-------|------------------------------------------------|');
  console.log(`| PASS_BOTH   | ${String(verdictCounts.PASS_BOTH).padStart(5)} | Both V23 and V23b pass (no change needed)     |`);
  console.log(`| FIX_BY_V23B | ${String(verdictCounts.FIX_BY_V23B).padStart(5)} | V23 failed, V23b fixed (IMPROVEMENT)          |`);
  console.log(`| REGRESSED   | ${String(verdictCounts.REGRESSED).padStart(5)} | V23 passed, V23b failed (REGRESSION - BAD!)   |`);
  console.log(`| FAIL_BOTH   | ${String(verdictCounts.FAIL_BOTH).padStart(5)} | Both fail (needs investigation)               |`);
  console.log(`| MAKER       | ${String(verdictCounts.MAKER).padStart(5)} | Market Maker (excluded from pass rate)        |`);
  console.log('');

  console.log('PASS RATES (excludes MAKERs):');
  console.log(`  V23 (baseline):      ${v23PassRate.toFixed(1)}%`);
  console.log(`  V23b (Mark-to-Market): ${v23bPassRate.toFixed(1)}%`);
  console.log(`  Improvement:          ${(v23bPassRate - v23PassRate).toFixed(1)}%`);
  console.log('');

  // ============================================================================
  // SUCCESS CRITERIA CHECK
  // ============================================================================
  console.log('═'.repeat(100));
  console.log('SUCCESS CRITERIA');
  console.log('═'.repeat(100));
  console.log('');

  const criteria = [
    {
      name: 'NO REGRESSION',
      pass: verdictCounts.REGRESSED === 0,
      detail: `${verdictCounts.REGRESSED} wallets regressed`,
    },
    {
      name: 'FIX UNKNOWNS',
      pass: verdictCounts.FIX_BY_V23B > 0,
      detail: `${verdictCounts.FIX_BY_V23B} wallets fixed by Mark-to-Market`,
    },
    {
      name: 'IMPROVE PASS RATE',
      pass: v23bPassRate > v23PassRate,
      detail: `${v23PassRate.toFixed(1)}% -> ${v23bPassRate.toFixed(1)}%`,
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
    console.log('  ✓✓✓ ALL SUCCESS CRITERIA MET - V23b IS READY FOR PRODUCTION ✓✓✓');
  } else {
    console.log('  ✗✗✗ SOME CRITERIA FAILED - NEEDS INVESTIGATION ✗✗✗');
  }
  console.log('');

  // ============================================================================
  // DETAILED RESULTS
  // ============================================================================
  if (verdictCounts.REGRESSED > 0) {
    console.log('═'.repeat(100));
    console.log('REGRESSED WALLETS (CRITICAL - NEEDS INVESTIGATION)');
    console.log('═'.repeat(100));
    console.log('');

    const regressed = results.filter((r) => r.verdict === 'REGRESSED');
    for (const r of regressed) {
      console.log(`  ${r.wallet}`);
      console.log(`    UI PnL: ${formatPnL(r.ui_pnl)}`);
      console.log(`    V23:  ${formatPnL(r.v23_pnl)} (${r.v23_error_pct.toFixed(2)}% error) PASS`);
      console.log(`    V23b: ${formatPnL(r.v23b_pnl)} (${r.v23b_error_pct.toFixed(2)}% error) FAIL`);
      console.log(`    Unresolved: ${r.unresolvedConditions} | Last Prices: ${r.lastPricesLoaded}`);
      console.log('');
    }
  }

  if (verdictCounts.FIX_BY_V23B > 0) {
    console.log('═'.repeat(100));
    console.log('FIXED BY V23b (IMPROVEMENTS)');
    console.log('═'.repeat(100));
    console.log('');

    const fixed = results.filter((r) => r.verdict === 'FIX_BY_V23B');
    for (const r of fixed) {
      console.log(`  ${r.wallet}`);
      console.log(`    UI PnL: ${formatPnL(r.ui_pnl)}`);
      console.log(`    V23:  ${formatPnL(r.v23_pnl)} (${r.v23_error_pct.toFixed(2)}% error) FAIL`);
      console.log(`    V23b: ${formatPnL(r.v23b_pnl)} (${r.v23b_error_pct.toFixed(2)}% error) PASS`);
      console.log(`    Unresolved: ${r.unresolvedConditions} | Last Prices: ${r.lastPricesLoaded}`);
      console.log('');
    }
  }

  // ============================================================================
  // FOOTER
  // ============================================================================
  console.log('═'.repeat(100));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(100));
}

main().catch(console.error);
