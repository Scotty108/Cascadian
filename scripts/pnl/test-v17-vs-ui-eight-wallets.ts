/**
 * V17 vs UI PnL Comparison - 8 Test Wallets
 *
 * Compares V17 engine output against hand-collected UI PnL values.
 * Tests both "realized only" and "realized + unrealized" to determine
 * which metric the UI is closer to.
 */

import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

const TEST_WALLETS = [
  { wallet: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', ui_pnl: -10000000, name: 'Active Trader' },
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.90, name: 'Theo (NegRisk)' },
  { wallet: '0x56687bf447db6ffa42ffe2120c0099214e372dbba5e9', ui_pnl: 22053934, name: 'Theo4 (whale)' },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.00, name: 'Small loss' },
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84, name: 'Small profit' },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', ui_pnl: 75507.94, name: 'Medium profit' },
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', ui_pnl: 332563, name: 'Smart money 1' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', ui_pnl: 216892, name: 'Smart money 2' },
];

interface ComparisonResult {
  name: string;
  wallet: string;
  ui_pnl: number;
  v17_realized: number;
  v17_unrealized: number;
  v17_total: number;
  realized_abs_diff: number;
  realized_pct_error: number;
  total_abs_diff: number;
  total_pct_error: number;
}

async function main() {
  console.log('='.repeat(140));
  console.log('V17 vs UI PNL COMPARISON - 8 TEST WALLETS');
  console.log('='.repeat(140));
  console.log('');

  const engine = createV17Engine();
  const results: ComparisonResult[] = [];

  for (const w of TEST_WALLETS) {
    console.log(`Processing ${w.name}...`);
    const startTime = Date.now();

    const v17Result = await engine.compute(w.wallet);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const v17_realized = v17Result.realized_pnl;
    const v17_unrealized = v17Result.unrealized_pnl;
    const v17_total = v17_realized + v17_unrealized;

    const realized_abs_diff = Math.abs(v17_realized - w.ui_pnl);
    const realized_pct_error = (Math.abs(v17_realized - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;

    const total_abs_diff = Math.abs(v17_total - w.ui_pnl);
    const total_pct_error = (Math.abs(v17_total - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;

    results.push({
      name: w.name,
      wallet: w.wallet,
      ui_pnl: w.ui_pnl,
      v17_realized,
      v17_unrealized,
      v17_total,
      realized_abs_diff,
      realized_pct_error,
      total_abs_diff,
      total_pct_error,
    });

    console.log(`  Done in ${elapsed}s`);
  }

  // Table 1: V17 Realized Only vs UI
  console.log('');
  console.log('='.repeat(140));
  console.log('TABLE 1: V17 REALIZED ONLY vs UI');
  console.log('='.repeat(140));
  console.log(
    'Wallet           | UI PnL           | V17 Realized     | Abs Diff         | Pct Error  | Sign Match'
  );
  console.log('-'.repeat(140));

  for (const r of results) {
    const signMatch = (r.v17_realized >= 0) === (r.ui_pnl >= 0) ? 'YES' : 'NO';
    console.log(
      `${r.name.substring(0, 16).padEnd(16)} | $${r.ui_pnl.toLocaleString().padStart(14)} | $${r.v17_realized.toLocaleString().padStart(14)} | $${r.realized_abs_diff.toLocaleString().padStart(14)} | ${r.realized_pct_error.toFixed(1).padStart(9)}% | ${signMatch}`
    );
  }

  // Table 2: V17 Total (Realized + Unrealized) vs UI
  console.log('');
  console.log('='.repeat(140));
  console.log('TABLE 2: V17 TOTAL (REALIZED + UNREALIZED) vs UI');
  console.log('='.repeat(140));
  console.log(
    'Wallet           | UI PnL           | V17 Total        | Abs Diff         | Pct Error  | Sign Match'
  );
  console.log('-'.repeat(140));

  for (const r of results) {
    const signMatch = (r.v17_total >= 0) === (r.ui_pnl >= 0) ? 'YES' : 'NO';
    console.log(
      `${r.name.substring(0, 16).padEnd(16)} | $${r.ui_pnl.toLocaleString().padStart(14)} | $${r.v17_total.toLocaleString().padStart(14)} | $${r.total_abs_diff.toLocaleString().padStart(14)} | ${r.total_pct_error.toFixed(1).padStart(9)}% | ${signMatch}`
    );
  }

  // Summary statistics
  console.log('');
  console.log('='.repeat(140));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(140));

  // Realized only stats
  const realizedErrors = results.map((r) => r.realized_pct_error);
  const avgRealizedError = realizedErrors.reduce((a, b) => a + b, 0) / realizedErrors.length;
  const medianRealizedError = realizedErrors.sort((a, b) => a - b)[Math.floor(realizedErrors.length / 2)];
  const maxRealizedError = Math.max(...realizedErrors);

  console.log('V17 Realized Only vs UI:');
  console.log(`  Average error:  ${avgRealizedError.toFixed(1)}%`);
  console.log(`  Median error:   ${medianRealizedError.toFixed(1)}%`);
  console.log(`  Max error:      ${maxRealizedError.toFixed(1)}%`);

  // Total stats
  const totalErrors = results.map((r) => r.total_pct_error);
  const avgTotalError = totalErrors.reduce((a, b) => a + b, 0) / totalErrors.length;
  const medianTotalError = [...totalErrors].sort((a, b) => a - b)[Math.floor(totalErrors.length / 2)];
  const maxTotalError = Math.max(...totalErrors);

  console.log('');
  console.log('V17 Total (Realized + Unrealized) vs UI:');
  console.log(`  Average error:  ${avgTotalError.toFixed(1)}%`);
  console.log(`  Median error:   ${medianTotalError.toFixed(1)}%`);
  console.log(`  Max error:      ${maxTotalError.toFixed(1)}%`);

  // Which is closer?
  console.log('');
  console.log('-'.repeat(140));
  let realizedWins = 0;
  let totalWins = 0;
  for (const r of results) {
    if (r.realized_pct_error < r.total_pct_error) {
      realizedWins++;
    } else {
      totalWins++;
    }
  }
  console.log(`Realized closer to UI: ${realizedWins}/${results.length} wallets`);
  console.log(`Total closer to UI:    ${totalWins}/${results.length} wallets`);

  // Pass/fail at 25% threshold
  console.log('');
  console.log('-'.repeat(140));
  const realizedPasses = results.filter(
    (r) => r.realized_pct_error < 25 && (r.v17_realized >= 0) === (r.ui_pnl >= 0)
  );
  const totalPasses = results.filter(
    (r) => r.total_pct_error < 25 && (r.v17_total >= 0) === (r.ui_pnl >= 0)
  );

  console.log(`Pass rate at 25% threshold (same sign required):`);
  console.log(`  Realized: ${realizedPasses.length}/${results.length}`);
  console.log(`  Total:    ${totalPasses.length}/${results.length}`);

  console.log('');
  console.log('='.repeat(140));
  console.log('COMPARISON COMPLETE');
  console.log('='.repeat(140));
}

main().catch(console.error);
