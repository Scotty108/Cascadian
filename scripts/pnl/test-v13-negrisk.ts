/**
 * Test V13 Engine on NegRisk traders
 *
 * V13 should properly account for NegRisk token acquisitions at $0.50 cost basis
 */

import { createV13Engine } from '../../lib/pnl/uiActivityEngineV13';

const TEST_WALLETS = [
  {
    address: '0x9d36c904930a7d06c5403f9e16996e919f586486',
    name: 'Theo (NegRisk heavy)',
    ui_pnl: -6139, // From comprehensive validation
  },
  {
    address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
    name: 'Active Trader (pure CLOB)',
    ui_pnl: -10000000,
  },
  {
    address: '0xdfe10ac1e7e63fb0048ae8eb07643d0ed51ec1a8',
    name: 'Near-perfect V12 match',
    ui_pnl: 4405,
  },
];

async function main() {
  console.log('='.repeat(80));
  console.log('V13 ENGINE TEST - NEGRISK INTEGRATION');
  console.log('='.repeat(80));

  const engine = createV13Engine();

  for (const w of TEST_WALLETS) {
    console.log('\n' + '-'.repeat(80));
    console.log(`Wallet: ${w.name}`);
    console.log(`Address: ${w.address}`);
    console.log('-'.repeat(80));

    try {
      const result = await engine.compute(w.address);

      console.log('\n=== Source Breakdown ===');
      console.log(`  CLOB trades:         ${result.clob_trades}`);
      console.log(`  NegRisk acquisitions: ${result.negrisk_acquisitions}`);
      console.log(`  CTF splits:          ${result.ctf_splits}`);
      console.log(`  CTF merges:          ${result.ctf_merges}`);
      console.log(`  Resolutions:         ${result.resolutions}`);

      console.log('\n=== PnL Results ===');
      console.log(`  V13 Realized PnL:  $${result.realized_pnl.toFixed(2)}`);
      console.log(`  Expected (UI):     $${w.ui_pnl.toFixed(2)}`);

      const error = Math.abs(result.realized_pnl - w.ui_pnl);
      const errorPct = Math.abs(w.ui_pnl) > 0 ? (error / Math.abs(w.ui_pnl)) * 100 : 0;
      const signMatch = (result.realized_pnl >= 0) === (w.ui_pnl >= 0);

      console.log(`  Error:             $${error.toFixed(2)} (${errorPct.toFixed(1)}%)`);
      console.log(`  Sign Match:        ${signMatch ? 'YES ✓' : 'NO ✗'}`);

      console.log('\n=== Volume ===');
      console.log(`  Volume Buys:  $${result.volume_buys.toFixed(2)}`);
      console.log(`  Volume Sells: $${result.volume_sells.toFixed(2)}`);
      console.log(`  Total Volume: $${result.volume_traded.toFixed(2)}`);

      console.log('\n=== Category Breakdown ===');
      for (const cat of result.by_category.slice(0, 5)) {
        console.log(
          `  ${cat.category.padEnd(20)} PnL: $${cat.realized_pnl.toFixed(2).padStart(12)} ` +
            `WinRate: ${(cat.win_rate * 100).toFixed(1)}% Trades: ${cat.trades_count}`
        );
      }

      console.log('\n=== Trade Returns Sample (last 5) ===');
      const lastTrades = result.trade_returns.slice(-5);
      for (const tr of lastTrades) {
        const sign = tr.pnl >= 0 ? '+' : '';
        console.log(
          `  ${tr.source.padEnd(12)} ${tr.side.padEnd(6)} ` +
            `${tr.category.padEnd(15)} qty=${tr.qty.toFixed(2).padStart(10)} ` +
            `@$${tr.price.toFixed(4)} PnL: ${sign}$${tr.pnl.toFixed(2)}`
        );
      }

      // Status
      if (errorPct < 5) {
        console.log('\n  STATUS: ✓ EXCELLENT (<5% error)');
      } else if (errorPct < 25) {
        console.log('\n  STATUS: ⚠ ACCEPTABLE (<25% error)');
      } else if (signMatch) {
        console.log('\n  STATUS: ⚠ POOR (>25% error but sign correct)');
      } else {
        console.log('\n  STATUS: ✗ FAIL (sign mismatch)');
      }
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('V13 TEST COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
