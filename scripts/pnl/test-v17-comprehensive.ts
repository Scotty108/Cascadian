/**
 * V17 Comprehensive Test - All Known Wallets with UI PnL Data
 *
 * Consolidates all wallets from various test files that have known UI PnL values.
 * Tests V17 engine against all of them.
 */

import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

// Consolidated list of all wallets with known UI PnL values
// Sources: Various test files in scripts/pnl/ and scripts/
const ALL_WALLETS = [
  // From test-v17-vs-ui-eight-wallets.ts (8 wallets)
  { wallet: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', ui_pnl: -10000000, name: 'Active Trader' },
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.90, name: 'Theo (NegRisk)' },
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', ui_pnl: 22053934, name: 'Theo4 (whale)' },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.00, name: 'Small loss' },
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84, name: 'Small profit' },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', ui_pnl: 75507.94, name: 'Medium profit' },
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', ui_pnl: 332563, name: 'Smart money 1' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', ui_pnl: 216892, name: 'Smart money 2' },

  // From legacy formula tests (4 wallets)
  { wallet: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663, name: 'Legacy 1' },
  { wallet: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492, name: 'Legacy 2' },
  { wallet: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, name: 'Legacy 3' },
  { wallet: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171, name: 'Legacy 4' },

  // From verify-against-polymarket-ui.ts
  { wallet: '0x5656c2f3c326ba19c3691f91229e0edfbf1591eb', ui_pnl: -70.98, name: 'Small neg' },

  // From test-extended-benchmark.ts
  { wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', ui_pnl: -294.61, name: 'Extended 1' },

  // From test-v13-negrisk.ts
  { wallet: '0xdfe10ac1e7e63fb0048ae8eb07643d0ed51ec1a8', ui_pnl: -500, name: 'NegRisk test' }, // approximate

  // From test-golden-wallets.ts
  { wallet: '0xc5d563a36ae78145c45a50134d48a1215220f80a', ui_pnl: 0, name: 'TopTrader1 (unknown)' },
  { wallet: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', ui_pnl: 0, name: 'TopTrader2 (unknown)' },
];

// Filter to only wallets with known non-zero UI PnL
const TESTABLE_WALLETS = ALL_WALLETS.filter(w => w.ui_pnl !== 0);

interface Result {
  name: string;
  wallet: string;
  ui_pnl: number;
  v17_realized: number;
  v17_unrealized: number;
  v17_total: number;
  error_realized_pct: number;
  error_total_pct: number;
  sign_match: boolean;
  positions: number;
  markets: number;
}

async function main() {
  console.log('='.repeat(150));
  console.log('V17 COMPREHENSIVE TEST - ALL KNOWN WALLETS');
  console.log('='.repeat(150));
  console.log(`Total wallets with known UI PnL: ${TESTABLE_WALLETS.length}`);
  console.log('');

  const engine = createV17Engine();
  const results: Result[] = [];

  for (const w of TESTABLE_WALLETS) {
    process.stdout.write(`Processing ${w.name.padEnd(20)}...`);
    const startTime = Date.now();

    try {
      const v17Result = await engine.compute(w.wallet);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      const v17_realized = v17Result.realized_pnl;
      const v17_unrealized = v17Result.unrealized_pnl;
      const v17_total = v17_realized + v17_unrealized;

      const error_realized_pct = (Math.abs(v17_realized - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;
      const error_total_pct = (Math.abs(v17_total - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;
      const sign_match = (v17_realized >= 0) === (w.ui_pnl >= 0);

      results.push({
        name: w.name,
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v17_realized,
        v17_unrealized,
        v17_total,
        error_realized_pct,
        error_total_pct,
        sign_match,
        positions: v17Result.positions_count,
        markets: v17Result.markets_traded,
      });

      console.log(` Done in ${elapsed}s (${v17Result.positions_count} positions)`);
    } catch (err: any) {
      console.log(` ERROR: ${err.message}`);
      results.push({
        name: w.name,
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v17_realized: 0,
        v17_unrealized: 0,
        v17_total: 0,
        error_realized_pct: 100,
        error_total_pct: 100,
        sign_match: false,
        positions: 0,
        markets: 0,
      });
    }
  }

  // Results table
  console.log('');
  console.log('='.repeat(150));
  console.log('RESULTS');
  console.log('='.repeat(150));
  console.log(
    'Wallet           | UI PnL           | V17 Realized     | V17 Total        | Err(Rlz) | Err(Tot) | Sign | Positions'
  );
  console.log('-'.repeat(150));

  for (const r of results) {
    const signStr = r.sign_match ? 'YES' : 'NO';
    console.log(
      `${r.name.substring(0, 16).padEnd(16)} | $${r.ui_pnl.toLocaleString().padStart(14)} | $${r.v17_realized.toLocaleString().padStart(14)} | $${r.v17_total.toLocaleString().padStart(14)} | ${r.error_realized_pct.toFixed(1).padStart(7)}% | ${r.error_total_pct.toFixed(1).padStart(7)}% | ${signStr.padStart(4)} | ${r.positions.toString().padStart(9)}`
    );
  }

  // Summary statistics
  console.log('');
  console.log('='.repeat(150));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(150));

  // Sign match rate
  const signMatches = results.filter(r => r.sign_match).length;
  console.log(`Sign match rate: ${signMatches}/${results.length} (${((signMatches / results.length) * 100).toFixed(1)}%)`);

  // Pass rates at various thresholds
  const thresholds = [5, 10, 15, 25, 50];
  console.log('');
  console.log('Pass rates (error < threshold AND sign match):');
  for (const thresh of thresholds) {
    const passRlz = results.filter(r => r.error_realized_pct < thresh && r.sign_match).length;
    const passTot = results.filter(r => r.error_total_pct < thresh && r.sign_match).length;
    console.log(`  <${thresh.toString().padStart(2)}%: Realized ${passRlz}/${results.length} | Total ${passTot}/${results.length}`);
  }

  // Error statistics
  const validResults = results.filter(r => r.positions > 0);
  if (validResults.length > 0) {
    const avgErrRlz = validResults.reduce((s, r) => s + r.error_realized_pct, 0) / validResults.length;
    const avgErrTot = validResults.reduce((s, r) => s + r.error_total_pct, 0) / validResults.length;
    const medianErrRlz = [...validResults].sort((a, b) => a.error_realized_pct - b.error_realized_pct)[Math.floor(validResults.length / 2)].error_realized_pct;
    const medianErrTot = [...validResults].sort((a, b) => a.error_total_pct - b.error_total_pct)[Math.floor(validResults.length / 2)].error_total_pct;

    console.log('');
    console.log('Error statistics (wallets with data):');
    console.log(`  Realized - Avg: ${avgErrRlz.toFixed(1)}%, Median: ${medianErrRlz.toFixed(1)}%`);
    console.log(`  Total    - Avg: ${avgErrTot.toFixed(1)}%, Median: ${medianErrTot.toFixed(1)}%`);
  }

  // Wallets with no data
  const noData = results.filter(r => r.positions === 0);
  if (noData.length > 0) {
    console.log('');
    console.log(`Wallets with no data: ${noData.length}`);
    for (const r of noData) {
      console.log(`  - ${r.name} (${r.wallet.substring(0, 12)}...)`);
    }
  }

  // Best and worst performers
  const sorted = [...validResults].sort((a, b) => a.error_realized_pct - b.error_realized_pct);
  console.log('');
  console.log('Best performers (lowest realized error):');
  for (const r of sorted.slice(0, 3)) {
    console.log(`  ${r.name}: ${r.error_realized_pct.toFixed(1)}% error`);
  }

  console.log('');
  console.log('Worst performers (highest realized error):');
  for (const r of sorted.slice(-3).reverse()) {
    console.log(`  ${r.name}: ${r.error_realized_pct.toFixed(1)}% error`);
  }

  console.log('');
  console.log('='.repeat(150));
  console.log('TEST COMPLETE');
  console.log('='.repeat(150));
}

main().catch(console.error);
