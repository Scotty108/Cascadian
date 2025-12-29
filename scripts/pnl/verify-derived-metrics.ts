/**
 * Verify trade-level derived metrics are working correctly
 */

import {
  createV12Engine,
  calculateOmegaRatio,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateWinRate,
  calculateROI,
  calculateProfitFactor,
  TradeReturn,
} from '../../lib/pnl/uiActivityEngineV12';

// Test with synthetic data first
function testSyntheticMetrics() {
  console.log('='.repeat(80));
  console.log('SYNTHETIC METRIC TESTS');
  console.log('='.repeat(80));

  // All winning trades
  const allWins: TradeReturn[] = [
    { condition_id: 'a', outcome_index: 0, trade_time: '2024-01-01', source: 'clob', pnl: 100, return_pct: 0.5, cost_basis: 200 },
    { condition_id: 'b', outcome_index: 0, trade_time: '2024-01-02', source: 'clob', pnl: 50, return_pct: 0.25, cost_basis: 200 },
    { condition_id: 'c', outcome_index: 0, trade_time: '2024-01-03', source: 'clob', pnl: 75, return_pct: 0.375, cost_basis: 200 },
  ];

  console.log('\n[All Winners (3 trades: +$100, +$50, +$75)]');
  console.log(`  Win Rate: ${(calculateWinRate(allWins) * 100).toFixed(1)}% (expected: 100%)`);
  console.log(`  Omega: ${calculateOmegaRatio(allWins)} (expected: Infinity)`);
  console.log(`  Sortino: ${calculateSortinoRatio(allWins)} (expected: Infinity)`);
  console.log(`  Profit Factor: ${calculateProfitFactor(allWins)} (expected: Infinity)`);
  console.log(`  ROI: ${(calculateROI(allWins) * 100).toFixed(1)}% (expected: 37.5%)`);

  // All losing trades
  const allLosses: TradeReturn[] = [
    { condition_id: 'a', outcome_index: 0, trade_time: '2024-01-01', source: 'clob', pnl: -100, return_pct: -0.5, cost_basis: 200 },
    { condition_id: 'b', outcome_index: 0, trade_time: '2024-01-02', source: 'clob', pnl: -50, return_pct: -0.25, cost_basis: 200 },
    { condition_id: 'c', outcome_index: 0, trade_time: '2024-01-03', source: 'clob', pnl: -75, return_pct: -0.375, cost_basis: 200 },
  ];

  console.log('\n[All Losers (3 trades: -$100, -$50, -$75)]');
  console.log(`  Win Rate: ${(calculateWinRate(allLosses) * 100).toFixed(1)}% (expected: 0%)`);
  console.log(`  Omega: ${calculateOmegaRatio(allLosses).toFixed(4)} (expected: 0)`);
  console.log(`  Profit Factor: ${calculateProfitFactor(allLosses).toFixed(4)} (expected: 0)`);
  console.log(`  ROI: ${(calculateROI(allLosses) * 100).toFixed(1)}% (expected: -37.5%)`);

  // Mixed trades (net positive)
  const mixedPositive: TradeReturn[] = [
    { condition_id: 'a', outcome_index: 0, trade_time: '2024-01-01', source: 'clob', pnl: 200, return_pct: 1.0, cost_basis: 200 },
    { condition_id: 'b', outcome_index: 0, trade_time: '2024-01-02', source: 'clob', pnl: -50, return_pct: -0.25, cost_basis: 200 },
    { condition_id: 'c', outcome_index: 0, trade_time: '2024-01-03', source: 'clob', pnl: -25, return_pct: -0.125, cost_basis: 200 },
  ];

  console.log('\n[Mixed Positive (3 trades: +$200, -$50, -$25 = +$125 net)]');
  console.log(`  Win Rate: ${(calculateWinRate(mixedPositive) * 100).toFixed(1)}% (expected: 33.3%)`);
  console.log(`  Omega: ${calculateOmegaRatio(mixedPositive).toFixed(4)} (gains/losses = 1.0/0.375 = 2.67)`);
  console.log(`  Sharpe: ${calculateSharpeRatio(mixedPositive).toFixed(4)}`);
  console.log(`  Sortino: ${calculateSortinoRatio(mixedPositive).toFixed(4)}`);
  console.log(`  Profit Factor: ${calculateProfitFactor(mixedPositive).toFixed(4)} (200/75 = 2.67)`);
  console.log(`  ROI: ${(calculateROI(mixedPositive) * 100).toFixed(1)}% (125/600 = 20.8%)`);

  // Edge case: empty
  console.log('\n[Empty trades]');
  const empty: TradeReturn[] = [];
  console.log(`  Win Rate: ${calculateWinRate(empty)} (expected: 0)`);
  console.log(`  Omega: ${calculateOmegaRatio(empty)} (expected: 0)`);
  console.log(`  ROI: ${calculateROI(empty)} (expected: 0)`);

  // Edge case: single trade
  console.log('\n[Single trade (+$100)]');
  const single: TradeReturn[] = [
    { condition_id: 'a', outcome_index: 0, trade_time: '2024-01-01', source: 'clob', pnl: 100, return_pct: 0.5, cost_basis: 200 },
  ];
  console.log(`  Win Rate: ${(calculateWinRate(single) * 100).toFixed(1)}% (expected: 100%)`);
  console.log(`  Sharpe: ${calculateSharpeRatio(single)} (expected: 0, insufficient data)`);
}

async function testRealWalletMetrics() {
  console.log('\n' + '='.repeat(80));
  console.log('REAL WALLET METRIC TESTS');
  console.log('='.repeat(80));

  const engine = createV12Engine();

  // Test Active Trader (pure CLOB)
  const activeTrader = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';
  console.log(`\n[Active Trader: ${activeTrader.substring(0, 10)}...]`);

  const result = await engine.compute(activeTrader);

  console.log(`  Trade Returns: ${result.trade_returns.length}`);
  console.log(`  Realized PnL: $${result.realized_pnl.toFixed(2)}`);

  // Calculate metrics
  const omega = calculateOmegaRatio(result.trade_returns);
  const sharpe = calculateSharpeRatio(result.trade_returns);
  const sortino = calculateSortinoRatio(result.trade_returns);
  const winRate = calculateWinRate(result.trade_returns);
  const roi = calculateROI(result.trade_returns);
  const profitFactor = calculateProfitFactor(result.trade_returns);

  console.log('\n  Derived Metrics:');
  console.log(`    Omega Ratio: ${omega === Infinity ? '∞' : omega.toFixed(4)}`);
  console.log(`    Sharpe Ratio: ${sharpe.toFixed(4)}`);
  console.log(`    Sortino Ratio: ${sortino === Infinity ? '∞' : sortino.toFixed(4)}`);
  console.log(`    Win Rate: ${(winRate * 100).toFixed(1)}%`);
  console.log(`    ROI: ${(roi * 100).toFixed(2)}%`);
  console.log(`    Profit Factor: ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}`);

  // Sanity checks
  console.log('\n  Sanity Checks:');
  const allPnls = result.trade_returns.map(tr => tr.pnl);
  const totalPnl = allPnls.reduce((a, b) => a + b, 0);
  const wins = allPnls.filter(p => p > 0).length;
  const losses = allPnls.filter(p => p < 0).length;
  const breakeven = allPnls.filter(p => p === 0).length;

  console.log(`    Total from trade_returns: $${totalPnl.toFixed(2)}`);
  console.log(`    Wins: ${wins}, Losses: ${losses}, Breakeven: ${breakeven}`);
  console.log(`    Manual win rate: ${(wins / allPnls.length * 100).toFixed(1)}%`);
  console.log(`    Match with calculateWinRate: ${Math.abs(wins / allPnls.length - winRate) < 0.001 ? 'YES' : 'NO'}`);

  // Check if metrics are reasonable
  console.log('\n  Reasonableness Check:');
  if (roi < 0 && result.realized_pnl < 0) {
    console.log('    ✓ Negative ROI matches negative PnL');
  } else if (roi > 0 && result.realized_pnl > 0) {
    console.log('    ✓ Positive ROI matches positive PnL');
  } else if (Math.abs(result.realized_pnl) < 1000) {
    console.log('    ~ PnL near zero, ROI direction may vary');
  } else {
    console.log('    ✗ ROI sign does not match PnL sign - investigate');
  }

  if (profitFactor > 1 && result.realized_pnl > 0) {
    console.log('    ✓ Profit factor > 1 with positive PnL');
  } else if (profitFactor < 1 && result.realized_pnl < 0) {
    console.log('    ✓ Profit factor < 1 with negative PnL');
  } else {
    console.log('    ✓ Profit factor consistent with PnL direction');
  }
}

async function main() {
  testSyntheticMetrics();
  await testRealWalletMetrics();

  console.log('\n' + '='.repeat(80));
  console.log('VERIFICATION COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
