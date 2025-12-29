/**
 * Quick V13 Test on wallets that V12 validated
 */

import { createV13Engine } from '../../lib/pnl/uiActivityEngineV13';

// Key wallets from V12 validation with their known UI PnL
const TEST_WALLETS = [
  { wallet: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', ui_pnl: -10000000, name: 'Active Trader (pure CLOB)' },
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.90, name: 'Theo (NegRisk)' },
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', ui_pnl: 22053934, name: 'Theo4 (whale)' },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.00, name: 'Small loss' },
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84, name: 'Small profit' },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', ui_pnl: 75507.94, name: 'Medium profit' },
  /**
   * FAILING TEST CASE: Smart Money 1 – REQUIRES RECONCILIATION
   * -----------------------------------------------------------
   * V13: -$282,753 | UI: +$332,563 | Gap: ~$615K | Sign mismatch: YES
   *
   * UI snapshot: $332,566.88 as of 2025-12-03 (re-verified via polymarket.com/profile)
   *
   * Forensic analysis (scripts/pnl/forensic-smart-money-1.ts) shows:
   * - Top loser: dd22472e... (election market) - 10.7M shares @ ~$0.36, resolved $0 = -$3.875M
   * - Top winner: c6485bb7... (election market) - 9.05M shares @ ~$0.62, resolved $1 = +$3.4M
   * - Individual position ledgers appear mathematically correct
   *
   * Hypotheses to investigate:
   * 1. CLOB coverage gap: Are there on-chain settlements/redemptions not in pm_trader_events_v2?
   * 2. NegRisk cost basis: Does UI use $0.50 conceptual basis instead of CLOB prices?
   * 3. Unrealized vs realized: Is the UI number including unrealized positions we exclude?
   * 4. Time mismatch: Was the $332K snapshot from a different date than current data?
   *
   * Next action: Build condition-level reconciliation report to find which markets
   * contribute most to the $615K gap, then drill into those specific ledgers.
   *
   * STATUS: FAILING - Do not classify as "outlier" until root cause identified.
   */
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', ui_pnl: 332563, name: 'Smart money 1' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', ui_pnl: 216892, name: 'Smart money 2' },
];

async function main() {
  console.log('='.repeat(80));
  console.log('QUICK V13 TEST');
  console.log('='.repeat(80));

  const engine = createV13Engine();

  let passed = 0;
  let failed = 0;
  let noData = 0;

  for (const w of TEST_WALLETS) {
    console.log(`\n${w.name}: ${w.wallet.substring(0, 12)}...`);

    try {
      const result = await engine.compute(w.wallet);

      if (result.total_trades === 0) {
        console.log('  NO DATA');
        noData++;
        continue;
      }

      const errorPct = Math.abs(w.ui_pnl) > 0
        ? Math.abs(result.realized_pnl - w.ui_pnl) / Math.abs(w.ui_pnl) * 100
        : 0;
      const signMatch = (result.realized_pnl >= 0) === (w.ui_pnl >= 0);

      const status = errorPct < 25 && signMatch ? 'PASS' : 'FAIL';
      if (status === 'PASS') passed++;
      else failed++;

      console.log(`  UI:     $${w.ui_pnl.toLocaleString()}`);
      console.log(`  V13:    $${result.realized_pnl.toLocaleString()}`);
      console.log(`  Error:  ${errorPct.toFixed(1)}% ${signMatch ? '' : '[SIGN MISMATCH]'}`);
      console.log(`  Status: ${status}`);
      console.log(`  NegRisk: ${result.negrisk_acquisitions} | CLOB: ${result.clob_trades}`);

    } catch (err: any) {
      console.log(`  ERROR: ${err.message.substring(0, 60)}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${noData} no data`);
  console.log('='.repeat(80));
}

main().catch(console.error);
