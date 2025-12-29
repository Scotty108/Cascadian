/**
 * Quick V16 Test - Aggregate NegRisk Pairing
 */

import { createV16Engine } from '../../lib/pnl/uiActivityEngineV16';

const TEST_WALLETS = [
  { wallet: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', ui_pnl: -10000000, name: 'Active Trader (pure CLOB)' },
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.90, name: 'Theo (NegRisk)' },
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', ui_pnl: 22053934, name: 'Theo4 (whale)' },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.00, name: 'Small loss' },
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84, name: 'Small profit' },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', ui_pnl: 75507.94, name: 'Medium profit' },
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', ui_pnl: 332563, name: 'Smart money 1' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', ui_pnl: 216892, name: 'Smart money 2' },
];

async function main() {
  console.log('='.repeat(80));
  console.log('QUICK V16 TEST (Aggregate NegRisk Pairing)');
  console.log('='.repeat(80));

  const engine = createV16Engine();

  let passed = 0;
  let failed = 0;
  let noData = 0;

  for (const w of TEST_WALLETS) {
    console.log(`\n${w.name}: ${w.wallet.substring(0, 12)}...`);
    const startTime = Date.now();

    try {
      const result = await engine.compute(w.wallet);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

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

      console.log(`  UI:      $${w.ui_pnl.toLocaleString()}`);
      console.log(`  V16:     $${result.realized_pnl.toLocaleString()}`);
      console.log(`  Error:   ${errorPct.toFixed(1)}% ${signMatch ? '' : '[SIGN MISMATCH]'}`);
      console.log(`  Status:  ${status}`);
      console.log(`  Filtered: ${result.negrisk_sell_legs_filtered.toLocaleString()} NegRisk sells | Trades: ${result.total_trades} | Time: ${elapsed}s`);

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
