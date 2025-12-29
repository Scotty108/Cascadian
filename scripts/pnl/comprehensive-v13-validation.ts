/**
 * V13 CLOB-Only Engine - Comprehensive Accuracy Summary
 *
 * Uses the same 8 UI-validated wallets from quick-v13-test.ts
 * to produce a clean accuracy report with statistical breakdown.
 *
 * V13 is frozen as the CLOB-only PnL engine. This script validates
 * its accuracy against known UI PnL values.
 */

import { createV13Engine } from '../../lib/pnl/uiActivityEngineV13';
import { clickhouse } from '../../lib/clickhouse/client';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface KnownWallet {
  wallet: string;
  ui_pnl: number;
  name: string;
}

interface ValidationResult {
  wallet: string;
  name: string;
  ui_pnl: number;
  v13_pnl: number;
  error_abs: number;
  error_pct: number | null;
  sign_mismatch: boolean;
  negrisk_count: number;
  clob_count: number;
  total_trades: number;
  status: 'pass' | 'fail' | 'no_data' | 'error';
}

// =============================================================================
// UI-VALIDATED WALLETS (from quick-v13-test.ts)
// =============================================================================

const UI_VALIDATED_WALLETS: KnownWallet[] = [
  { wallet: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', ui_pnl: -10000000, name: 'Active Trader (pure CLOB)' },
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.90, name: 'Theo (NegRisk)' },
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', ui_pnl: 22053934, name: 'Theo4 (whale)' },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.00, name: 'Small loss' },
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84, name: 'Small profit' },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', ui_pnl: 75507.94, name: 'Medium profit' },
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', ui_pnl: 332563, name: 'Smart money 1' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', ui_pnl: 216892, name: 'Smart money 2' },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// =============================================================================
// MAIN VALIDATION
// =============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('V13 ACCURACY SUMMARY - 8 UI VALIDATION WALLETS (CLOB ONLY)');
  console.log('='.repeat(70));
  console.log('Engine: V13 CLOB-Only (frozen)');
  console.log('Date: ' + new Date().toISOString().split('T')[0]);
  console.log('='.repeat(70));

  const engine = createV13Engine();
  const results: ValidationResult[] = [];

  // Process each wallet
  for (const w of UI_VALIDATED_WALLETS) {
    process.stdout.write(`\nProcessing ${w.name}...`);

    try {
      const result = await engine.compute(w.wallet);

      if (result.total_trades === 0) {
        results.push({
          wallet: w.wallet,
          name: w.name,
          ui_pnl: w.ui_pnl,
          v13_pnl: 0,
          error_abs: Math.abs(w.ui_pnl),
          error_pct: null,
          sign_mismatch: false,
          negrisk_count: 0,
          clob_count: 0,
          total_trades: 0,
          status: 'no_data',
        });
        console.log(' NO DATA');
        continue;
      }

      const errorAbs = Math.abs(result.realized_pnl - w.ui_pnl);
      const errorPct = w.ui_pnl === 0 ? null : (errorAbs / Math.max(1, Math.abs(w.ui_pnl))) * 100;
      const signMismatch = Math.sign(result.realized_pnl) !== Math.sign(w.ui_pnl) && errorAbs > 1;

      const status = signMismatch ? 'fail' : (errorPct !== null && errorPct < 25 ? 'pass' : 'fail');

      results.push({
        wallet: w.wallet,
        name: w.name,
        ui_pnl: w.ui_pnl,
        v13_pnl: result.realized_pnl,
        error_abs: errorAbs,
        error_pct: errorPct,
        sign_mismatch: signMismatch,
        negrisk_count: result.negrisk_acquisitions,
        clob_count: result.clob_trades,
        total_trades: result.total_trades,
        status,
      });

      console.log(` ${status.toUpperCase()} (${errorPct?.toFixed(1) || 'N/A'}%)`);

    } catch (err: any) {
      results.push({
        wallet: w.wallet,
        name: w.name,
        ui_pnl: w.ui_pnl,
        v13_pnl: 0,
        error_abs: Math.abs(w.ui_pnl),
        error_pct: null,
        sign_mismatch: false,
        negrisk_count: 0,
        clob_count: 0,
        total_trades: 0,
        status: 'error',
      });
      console.log(` ERROR: ${err.message.substring(0, 40)}`);
    }
  }

  // ==========================================================================
  // COMPUTE ACCURACY METRICS
  // ==========================================================================

  const withUIReference = results.filter(r => r.status !== 'no_data' && r.status !== 'error');
  const errorPcts = withUIReference.filter(r => r.error_pct !== null).map(r => r.error_pct!);
  const signMismatches = withUIReference.filter(r => r.sign_mismatch);

  const within5 = errorPcts.filter(e => e < 5).length;
  const within10 = errorPcts.filter(e => e < 10).length;
  const within20 = errorPcts.filter(e => e < 20).length;
  const within25 = errorPcts.filter(e => e < 25).length;

  // ==========================================================================
  // PRINT SUMMARY BLOCK
  // ==========================================================================

  console.log('\n' + '='.repeat(70));
  console.log('V13 ACCURACY SUMMARY - 8 UI VALIDATION WALLETS (CLOB ONLY)');
  console.log('='.repeat(70));
  console.log(`Wallets with UI reference: ${withUIReference.length}`);
  console.log(`Mean abs pct error:        ${mean(errorPcts).toFixed(1)}%`);
  console.log(`Median abs pct error:      ${median(errorPcts).toFixed(1)}%`);
  console.log(`Within 5%:                 ${within5} (${(within5 / errorPcts.length * 100).toFixed(1)}%)`);
  console.log(`Within 10%:                ${within10} (${(within10 / errorPcts.length * 100).toFixed(1)}%)`);
  console.log(`Within 20%:                ${within20} (${(within20 / errorPcts.length * 100).toFixed(1)}%)`);
  console.log(`Within 25%:                ${within25} (${(within25 / errorPcts.length * 100).toFixed(1)}%)`);
  console.log(`Sign mismatches:           ${signMismatches.length > 0 ? signMismatches.map(r => `${r.name} (${r.wallet.substring(0, 12)}...)`).join(', ') : 'None'}`);

  // ==========================================================================
  // PRINT PER-WALLET TABLE (SORTED BY ERROR % DESCENDING)
  // ==========================================================================

  console.log('\n' + '='.repeat(70));
  console.log('PER-WALLET RESULTS (sorted by error % descending)');
  console.log('='.repeat(70));
  console.log('| Name                       | UI PnL        | V13 PnL       | Error %  | Status |');
  console.log('|' + '-'.repeat(28) + '|' + '-'.repeat(15) + '|' + '-'.repeat(15) + '|' + '-'.repeat(10) + '|' + '-'.repeat(8) + '|');

  const sortedByError = [...results].sort((a, b) => {
    if (a.error_pct === null) return 1;
    if (b.error_pct === null) return -1;
    return b.error_pct - a.error_pct;
  });

  for (const r of sortedByError) {
    const name = r.name.substring(0, 26).padEnd(26);
    const uiPnl = ('$' + r.ui_pnl.toLocaleString()).padStart(13);
    const v13Pnl = ('$' + r.v13_pnl.toLocaleString()).padStart(13);
    const errPct = (r.error_pct !== null ? r.error_pct.toFixed(1) + '%' : 'N/A').padStart(8);
    const status = r.sign_mismatch ? 'SIGN!!' : r.status.toUpperCase().padStart(6);
    console.log(`| ${name} | ${uiPnl} | ${v13Pnl} | ${errPct} | ${status} |`);
  }

  // ==========================================================================
  // OPTIONAL: FETCH EXTRA REAL WALLETS (NO UI GROUND TRUTH)
  // ==========================================================================

  console.log('\n' + '='.repeat(70));
  console.log('EXTRA REAL WALLETS (NO UI GROUND TRUTH) - Top active traders');
  console.log('='.repeat(70));

  try {
    // Query for real active wallets from pm_trader_events_v2
    const extraQuery = `
      SELECT
        lower(trader_wallet) as wallet,
        count() as trade_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND lower(trader_wallet) NOT IN (${UI_VALIDATED_WALLETS.map(w => `'${w.wallet.toLowerCase()}'`).join(',')})
      GROUP BY trader_wallet
      HAVING count() > 1000
      ORDER BY count() DESC
      LIMIT 10
    `;

    const extraResult = await clickhouse.query({ query: extraQuery, format: 'JSONEachRow' });
    const extraWallets = (await extraResult.json()) as any[];

    if (extraWallets.length > 0) {
      console.log('| Wallet                                       | V13 PnL       | Trades   |');
      console.log('|' + '-'.repeat(46) + '|' + '-'.repeat(15) + '|' + '-'.repeat(10) + '|');

      for (const ew of extraWallets.slice(0, 10)) {
        try {
          const metrics = await engine.compute(ew.wallet);
          const walletStr = ew.wallet.padEnd(44);
          const pnlStr = ('$' + metrics.realized_pnl.toLocaleString()).padStart(13);
          const tradesStr = metrics.total_trades.toLocaleString().padStart(8);
          console.log(`| ${walletStr} | ${pnlStr} | ${tradesStr} |`);
        } catch {
          console.log(`| ${ew.wallet.padEnd(44)} | ERROR         |          |`);
        }
      }

      console.log('\nNote: These wallets have no UI PnL reference and are not included in accuracy stats.');
    } else {
      console.log('No additional wallets found with >1000 trades.');
    }
  } catch (err: any) {
    console.log('Could not fetch extra wallets: ' + err.message.substring(0, 50));
  }

  // ==========================================================================
  // FINAL SUMMARY
  // ==========================================================================

  console.log('\n' + '='.repeat(70));
  console.log('CONCLUSION');
  console.log('='.repeat(70));
  console.log(`V13 CLOB-only engine validated on ${withUIReference.length} wallets with UI reference.`);
  console.log(`Pass rate: ${within25}/${withUIReference.length} (${(within25 / withUIReference.length * 100).toFixed(0)}%) within 25% error.`);
  if (signMismatches.length > 0) {
    console.log(`Documented outliers: ${signMismatches.map(r => r.name).join(', ')}`);
  }
  console.log('='.repeat(70));
}

main().catch(console.error);
