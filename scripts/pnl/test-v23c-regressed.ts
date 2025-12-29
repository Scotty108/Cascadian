/**
 * ============================================================================
 * V23c QUICK TEST - REGRESSED WALLET
 * ============================================================================
 *
 * PURPOSE: Validate V23c (UI Oracle) hypothesis by testing on the wallet that
 *          regressed from V23 to V23b.
 *
 * HYPOTHESIS: The V23b "regression" was caused by using last_trade_price
 *             instead of pm_market_metadata.outcome_prices. V23c should fix
 *             this by using the same price oracle as the UI.
 *
 * REGRESSED WALLET: 0x94a428cfa4f84b264e01f70d93d02bc96cb36356
 * - UI PnL: +$4.29M
 * - V23:  +$4.33M (0.87% error) PASS
 * - V23b: +$4.33M (1.03% error) FAIL
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { calculateV23PnL } from '../../lib/pnl/shadowLedgerV23';
import { calculateV23bPnL } from '../../lib/pnl/shadowLedgerV23b';
import { calculateV23cPnL } from '../../lib/pnl/shadowLedgerV23c';
import { clickhouse } from '../../lib/clickhouse/client';

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
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                  V23c REGRESSED WALLET TEST                                           ║');
  console.log('║  HYPOTHESIS: V23c (UI Oracle) will fix the V23b regression                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  // Load the regressed wallet's UI PnL
  const regressedWallet = '0x94a428cfa4f84b264e01f70d93d02bc96cb36356';

  const query = `
    SELECT pnl_value
    FROM pm_ui_pnl_benchmarks_v1
    WHERE wallet = '${regressedWallet}'
      AND benchmark_set = 'fresh_2025_12_04_alltime'
    LIMIT 1
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    console.log('ERROR: Regressed wallet not found in benchmark table');
    process.exit(1);
  }

  const ui_pnl = Number(rows[0].pnl_value);

  console.log(`REGRESSED WALLET: ${regressedWallet}`);
  console.log(`UI PnL: ${formatPnL(ui_pnl)}`);
  console.log('');

  // Calculate V23
  console.log('Calculating V23...');
  const v23Result = await calculateV23PnL(regressedWallet);
  const v23_pnl = v23Result.totalPnl;
  const v23_error = errorPct(v23_pnl, ui_pnl);
  const v23_pass = v23_error < 1.0;

  // Calculate V23b
  console.log('Calculating V23b...');
  const v23bResult = await calculateV23bPnL(regressedWallet, { markToMarket: true });
  const v23b_pnl = v23bResult.totalPnl;
  const v23b_error = errorPct(v23b_pnl, ui_pnl);
  const v23b_pass = v23b_error < 1.0;

  // Calculate V23c
  console.log('Calculating V23c...');
  const v23cResult = await calculateV23cPnL(regressedWallet, { useUIOracle: true });
  const v23c_pnl = v23cResult.totalPnl;
  const v23c_error = errorPct(v23c_pnl, ui_pnl);
  const v23c_pass = v23c_error < 1.0;

  console.log('');
  console.log('═'.repeat(100));
  console.log('RESULTS');
  console.log('═'.repeat(100));
  console.log('');

  console.log(`| Engine | PnL | Error % | Pass (<1%) |`);
  console.log(`|--------|-----|---------|------------|`);
  console.log(`| V23 (baseline) | ${formatPnL(v23_pnl).padStart(10)} | ${v23_error.toFixed(2).padStart(7)}% | ${v23_pass ? 'PASS' : 'FAIL'} |`);
  console.log(`| V23b (last_trade_price) | ${formatPnL(v23b_pnl).padStart(10)} | ${v23b_error.toFixed(2).padStart(7)}% | ${v23b_pass ? 'PASS' : 'FAIL'} |`);
  console.log(`| V23c (UI oracle) | ${formatPnL(v23c_pnl).padStart(10)} | ${v23c_error.toFixed(2).padStart(7)}% | ${v23c_pass ? 'PASS' : 'FAIL'} |`);
  console.log('');

  // Diagnostic info
  console.log('═'.repeat(100));
  console.log('DIAGNOSTICS');
  console.log('═'.repeat(100));
  console.log('');
  console.log(`V23c UI Prices Loaded: ${v23cResult.uiPricesLoaded}`);
  console.log(`V23c Last Prices Loaded: ${v23cResult.lastPricesLoaded}`);
  console.log(`V23c Unresolved Conditions: ${v23cResult.unresolvedConditions}`);
  console.log('');

  // Verdict
  console.log('═'.repeat(100));
  console.log('VERDICT');
  console.log('═'.repeat(100));
  console.log('');

  if (v23c_pass && !v23b_pass) {
    console.log('✓ SUCCESS: V23c (UI Oracle) FIXES the V23b regression!');
    console.log('  The hypothesis is CONFIRMED: Using pm_market_metadata.outcome_prices');
    console.log('  as the price oracle matches the UI exactly.');
  } else if (v23c_pass && v23b_pass) {
    console.log('✓ BOTH PASS: V23c and V23b both pass for this wallet.');
    console.log('  Need to test other wallets to validate the hypothesis.');
  } else if (!v23c_pass && v23b_pass) {
    console.log('✗ REGRESSION: V23c made it worse! Need to investigate.');
  } else {
    console.log('✗ BOTH FAIL: Neither V23b nor V23c pass. Different root cause.');
    console.log(`  V23c error: ${v23c_error.toFixed(2)}%`);
    console.log(`  V23b error: ${v23b_error.toFixed(2)}%`);
    console.log(`  Improvement: ${(v23b_error - v23c_error).toFixed(2)}%`);
  }
  console.log('');

  console.log('═'.repeat(100));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(100));
}

main().catch(console.error);
