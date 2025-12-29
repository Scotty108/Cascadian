/**
 * ============================================================================
 * V23c FINAL BENCHMARK - TRADER_STRICT COHORT
 * ============================================================================
 *
 * PURPOSE: Verify V23c achieves 100% accuracy for TRADER_STRICT wallets.
 *
 * TRADER_STRICT Definition:
 * - No Split events (Splits == 0)
 * - No Merge events (Merges == 0)
 * - Not transfer-heavy (Incoming_Transfers_Value < $100)
 * - Inventory consistent (Net_Ledger ≈ Net_CLOB)
 *
 * HYPOTHESIS: After excluding imposters (wallets with non-CLOB token sources),
 *             V23c achieves 100% pass rate at 5% threshold.
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { classifyWalletStrict, isTraderStrict, TRADER_STRICT_THRESHOLDS } from '../../lib/pnl/walletClassifier';
import { calculateV23cPnL } from '../../lib/pnl/shadowLedgerV23c';

// ============================================================================
// Configuration
// ============================================================================

const BENCHMARK_SET = 'fresh_2025_12_04_alltime';
const ERROR_THRESHOLDS = [1.0, 2.0, 5.0];

// Known Makers from previous benchmark (from V23c report note field containing 'MAKER')
// These are wallets that were manually flagged as market makers
const KNOWN_MAKERS = new Set([
  '0xfc56e7250bd0e94a20c8e96e8a48c3e7a5b0f0cf', // frysty
  '0x1a8c8fd0a8557d21a7e35db3c3c5e5a5d4b9e76f', // Add other known makers
  // ... we'll detect them dynamically via high Split/Merge activity
]);

// ============================================================================
// Types
// ============================================================================

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
  note: string;
}

interface WalletResult {
  wallet: string;
  ui_pnl: number;
  v23c_pnl: number;
  error_pct: number;
  is_maker: boolean;
  is_trader_strict: boolean;
  non_trader_reasons: string[];
  inventory_mismatch: number;
  pass_1pct: boolean;
  pass_2pct: boolean;
  pass_5pct: boolean;
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
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                        V23c FINAL BENCHMARK: TRADER_STRICT COHORT                                    ║');
  console.log('║  GOAL: 100% Accuracy for Pure Traders                                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Benchmark Set: ${BENCHMARK_SET}`);
  console.log('');

  // Step 1: Load benchmark wallets
  console.log('═'.repeat(100));
  console.log('STEP 1: LOADING BENCHMARK WALLETS');
  console.log('═'.repeat(100));
  console.log('');

  const query = `
    SELECT
      wallet,
      pnl_value as ui_pnl,
      note
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${BENCHMARK_SET}'
    ORDER BY pnl_value DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const wallets: BenchmarkWallet[] = rows.map((r) => ({
    wallet: r.wallet,
    ui_pnl: Number(r.ui_pnl),
    note: r.note || '',
  }));

  console.log(`Loaded ${wallets.length} wallets from benchmark`);
  console.log('');

  // Step 2: Classify wallets and calculate V23c
  console.log('═'.repeat(100));
  console.log('STEP 2: CLASSIFYING WALLETS');
  console.log('═'.repeat(100));
  console.log('');

  console.log('TRADER_STRICT Thresholds:');
  console.log(`  - Max Inventory Mismatch: ${TRADER_STRICT_THRESHOLDS.INVENTORY_MISMATCH_MAX} tokens`);
  console.log(`  - Max Transfer-In Value: $${TRADER_STRICT_THRESHOLDS.TRANSFER_IN_VALUE_MAX}`);
  console.log(`  - Max Split Events: ${TRADER_STRICT_THRESHOLDS.SPLIT_EVENTS_MAX}`);
  console.log(`  - Max Merge Events: ${TRADER_STRICT_THRESHOLDS.MERGE_EVENTS_MAX}`);
  console.log('');

  const results: WalletResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    process.stdout.write(`\rProcessing wallet ${i + 1}/${wallets.length}: ${w.wallet.substring(0, 16)}...`);

    try {
      // Check TRADER_STRICT criteria
      const strictCheck = await isTraderStrict(w.wallet);

      // Calculate V23c PnL
      const v23cResult = await calculateV23cPnL(w.wallet, { useUIOracle: true });
      const v23c_pnl = v23cResult.totalPnl;
      const error = errorPct(v23c_pnl, w.ui_pnl);

      // Check if this is a heavy maker (many splits/merges)
      const hasManyMerges = strictCheck.activity.merge_count > 100;
      const hasManySplis = strictCheck.activity.split_count > 100;
      const is_heavy_maker = hasManyMerges || hasManySplis;

      results.push({
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v23c_pnl,
        error_pct: error,
        is_maker: is_heavy_maker,
        is_trader_strict: strictCheck.is_trader_strict,
        non_trader_reasons: is_heavy_maker ? ['Market Maker (>100 Splits/Merges)'] : strictCheck.reasons,
        inventory_mismatch: strictCheck.inventory.inventory_mismatch,
        pass_1pct: error < 1.0,
        pass_2pct: error < 2.0,
        pass_5pct: error < 5.0,
      });
    } catch (err: any) {
      results.push({
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v23c_pnl: 0,
        error_pct: 100,
        is_maker: false,
        is_trader_strict: false,
        non_trader_reasons: [`Error: ${err.message}`],
        inventory_mismatch: 0,
        pass_1pct: false,
        pass_2pct: false,
        pass_5pct: false,
      });
    }
  }

  console.log('\n');

  // Step 3: Analyze results
  console.log('═'.repeat(100));
  console.log('STEP 3: RESULTS');
  console.log('═'.repeat(100));
  console.log('');

  // Filter by category
  const makers = results.filter((r) => r.is_maker);
  const nonMakers = results.filter((r) => !r.is_maker);
  const traderStrict = nonMakers.filter((r) => r.is_trader_strict);
  const nonTraders = nonMakers.filter((r) => !r.is_trader_strict);

  console.log('WALLET CLASSIFICATION:');
  console.log(`  Total:          ${results.length}`);
  console.log(`  Makers:         ${makers.length} (excluded)`);
  console.log(`  Non-Makers:     ${nonMakers.length}`);
  console.log(`    TRADER_STRICT:  ${traderStrict.length}`);
  console.log(`    NON_TRADER:     ${nonTraders.length}`);
  console.log('');

  // Pass rates for TRADER_STRICT
  const strictPass1 = traderStrict.filter((r) => r.pass_1pct).length;
  const strictPass2 = traderStrict.filter((r) => r.pass_2pct).length;
  const strictPass5 = traderStrict.filter((r) => r.pass_5pct).length;

  console.log('TRADER_STRICT PASS RATES:');
  console.log(`  @ 1% threshold: ${strictPass1}/${traderStrict.length} = ${((strictPass1 / traderStrict.length) * 100).toFixed(1)}%`);
  console.log(`  @ 2% threshold: ${strictPass2}/${traderStrict.length} = ${((strictPass2 / traderStrict.length) * 100).toFixed(1)}%`);
  console.log(`  @ 5% threshold: ${strictPass5}/${traderStrict.length} = ${((strictPass5 / traderStrict.length) * 100).toFixed(1)}%`);
  console.log('');

  // Non-Maker pass rates (for comparison)
  const nonMakerPass1 = nonMakers.filter((r) => r.pass_1pct).length;
  const nonMakerPass2 = nonMakers.filter((r) => r.pass_2pct).length;
  const nonMakerPass5 = nonMakers.filter((r) => r.pass_5pct).length;

  console.log('NON-MAKER PASS RATES (for comparison):');
  console.log(`  @ 1% threshold: ${nonMakerPass1}/${nonMakers.length} = ${((nonMakerPass1 / nonMakers.length) * 100).toFixed(1)}%`);
  console.log(`  @ 2% threshold: ${nonMakerPass2}/${nonMakers.length} = ${((nonMakerPass2 / nonMakers.length) * 100).toFixed(1)}%`);
  console.log(`  @ 5% threshold: ${nonMakerPass5}/${nonMakers.length} = ${((nonMakerPass5 / nonMakers.length) * 100).toFixed(1)}%`);
  console.log('');

  // Step 4: Show TRADER_STRICT wallets
  console.log('═'.repeat(100));
  console.log('TRADER_STRICT WALLETS');
  console.log('═'.repeat(100));
  console.log('');

  console.log('| Wallet | UI PnL | V23c PnL | Error % | Pass@5% |');
  console.log('|--------|--------|----------|---------|---------|');
  for (const r of traderStrict.sort((a, b) => a.error_pct - b.error_pct)) {
    const pass = r.pass_5pct ? '✓ PASS' : '✗ FAIL';
    console.log(`| ${r.wallet.substring(0, 12)}... | ${formatPnL(r.ui_pnl).padStart(10)} | ${formatPnL(r.v23c_pnl).padStart(10)} | ${r.error_pct.toFixed(2).padStart(7)}% | ${pass} |`);
  }
  console.log('');

  // Step 5: Show NON_TRADER wallets (excluded imposters)
  console.log('═'.repeat(100));
  console.log('NON_TRADER WALLETS (EXCLUDED IMPOSTERS)');
  console.log('═'.repeat(100));
  console.log('');

  for (const r of nonTraders.sort((a, b) => b.inventory_mismatch - a.inventory_mismatch)) {
    console.log(`${r.wallet.substring(0, 16)}... | UI: ${formatPnL(r.ui_pnl)} | Error: ${r.error_pct.toFixed(1)}% | Inventory Gap: ${r.inventory_mismatch.toFixed(0)} tokens`);
    for (const reason of r.non_trader_reasons) {
      console.log(`   └─ ${reason}`);
    }
  }
  console.log('');

  // Step 6: Final verdict
  console.log('═'.repeat(100));
  console.log('FINAL VERDICT');
  console.log('═'.repeat(100));
  console.log('');

  const strictPassRate5 = traderStrict.length > 0 ? (strictPass5 / traderStrict.length) * 100 : 0;
  const is100Pct = strictPassRate5 === 100;

  if (is100Pct) {
    console.log('🎉 SUCCESS: V23c achieves 100% PASS RATE for TRADER_STRICT cohort!');
    console.log('');
    console.log('RECOMMENDATIONS:');
    console.log('  1. Deploy V23c as the production PnL engine for TRADER_STRICT wallets');
    console.log('  2. Flag NON_TRADER wallets as needing different PnL methodology');
    console.log('  3. Continue excluding MAKER wallets from Copy Trading');
  } else {
    const failingStrict = traderStrict.filter((r) => !r.pass_5pct);
    console.log(`⚠️ V23c achieves ${strictPassRate5.toFixed(1)}% for TRADER_STRICT (not 100%)`);
    console.log('');
    console.log(`${failingStrict.length} TRADER_STRICT wallets still failing:`);
    for (const r of failingStrict) {
      console.log(`  - ${r.wallet.substring(0, 16)}... | Error: ${r.error_pct.toFixed(2)}%`);
    }
    console.log('');
    console.log('These wallets need further investigation.');
  }

  console.log('');
  console.log('═'.repeat(100));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(100));
}

main().catch(console.error);
