/**
 * Experiment: Cross-Timestamp NegRisk Pairing for Trump Market (dd22)
 *
 * Tests hypothesis that Polymarket pairs NegRisk legs across time, not just same timestamp.
 * Uses Smart Money 1 wallet and the Trump condition (dd22472e...) as test case.
 *
 * Sweeps window sizes: 1s, 5s, 30s
 */

import {
  inferCrossTimestampNegRiskPairs,
  loadRawTradesForCondition,
  CrossTimestampNegRiskStats,
} from '../../lib/pnl/uiActivityEngineV16';

// Smart Money 1 - our problem wallet
const SMART_MONEY_1 = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

// Trump election condition (biggest impact for Smart Money 1)
const TRUMP_CONDITION = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';

// Second biggest market for comparison
const SECOND_CONDITION = 'c6485bb7ea46d7bb8b27c0e12a2ee866cf3f7df107a90cc3e0c4d56f70748b0c';

const WINDOW_SIZES = [1, 5, 30]; // seconds

async function runExperiment() {
  console.log('='.repeat(100));
  console.log('CROSS-TIMESTAMP NEGRISK PAIRING EXPERIMENT');
  console.log('='.repeat(100));
  console.log(`Wallet: Smart Money 1 (${SMART_MONEY_1.substring(0, 12)}...)`);
  console.log(`Condition: Trump (dd22472e...)`);
  console.log('');

  // Load trades for Trump condition
  console.log('Loading trades for Trump condition...');
  const startLoad = Date.now();
  const trades = await loadRawTradesForCondition(SMART_MONEY_1, TRUMP_CONDITION);
  console.log(`Loaded ${trades.length.toLocaleString()} trades in ${((Date.now() - startLoad) / 1000).toFixed(1)}s`);

  // Analyze trade distribution
  const idx0Buys = trades.filter((t) => t.outcome_index === 0 && t.side === 'buy');
  const idx0Sells = trades.filter((t) => t.outcome_index === 0 && t.side === 'sell');
  const idx1Buys = trades.filter((t) => t.outcome_index === 1 && t.side === 'buy');
  const idx1Sells = trades.filter((t) => t.outcome_index === 1 && t.side === 'sell');

  console.log('\nTrade distribution:');
  console.log(`  idx=0 buys:  ${idx0Buys.length.toLocaleString()} trades, ${idx0Buys.reduce((s, t) => s + t.qty, 0).toLocaleString()} qty`);
  console.log(`  idx=0 sells: ${idx0Sells.length.toLocaleString()} trades, ${idx0Sells.reduce((s, t) => s + t.qty, 0).toLocaleString()} qty`);
  console.log(`  idx=1 buys:  ${idx1Buys.length.toLocaleString()} trades, ${idx1Buys.reduce((s, t) => s + t.qty, 0).toLocaleString()} qty`);
  console.log(`  idx=1 sells: ${idx1Sells.length.toLocaleString()} trades, ${idx1Sells.reduce((s, t) => s + t.qty, 0).toLocaleString()} qty`);

  // Check for same-timestamp pairing (W=0)
  console.log('\n' + '-'.repeat(100));
  console.log('BASELINE: Same-timestamp pairing (V16 current behavior)');
  console.log('-'.repeat(100));

  const baseline = inferCrossTimestampNegRiskPairs(trades, 0);
  printStats('W = 0s (same timestamp)', baseline.debugStats);

  // Sweep window sizes
  console.log('\n' + '-'.repeat(100));
  console.log('CROSS-TIMESTAMP PAIRING SWEEP');
  console.log('-'.repeat(100));

  const results: { window: number; stats: CrossTimestampNegRiskStats }[] = [];

  for (const windowSec of WINDOW_SIZES) {
    const result = inferCrossTimestampNegRiskPairs(trades, windowSec);
    results.push({ window: windowSec, stats: result.debugStats });
    printStats(`W = ${windowSec}s`, result.debugStats);
  }

  // Summary comparison
  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY: Paired Quantity by Window Size');
  console.log('='.repeat(100));
  console.log('Window    | Paired Qty      | % of idx0 Sells | % of idx1 Buys | Pairs Found');
  console.log('-'.repeat(100));

  const allResults = [{ window: 0, stats: baseline.debugStats }, ...results];
  for (const r of allResults) {
    const pctIdx0 = r.stats.totalIdx0Sell > 0 ? (r.stats.pairedQty / r.stats.totalIdx0Sell * 100).toFixed(1) : '0.0';
    const pctIdx1 = r.stats.totalIdx1Buy > 0 ? (r.stats.pairedQty / r.stats.totalIdx1Buy * 100).toFixed(1) : '0.0';
    console.log(
      `W = ${r.window.toString().padStart(2)}s  | ${r.stats.pairedQty.toLocaleString().padStart(14)} | ${pctIdx0.padStart(14)}% | ${pctIdx1.padStart(13)}% | ${r.stats.pairsFound.toLocaleString().padStart(10)}`
    );
  }

  // Run for second condition for comparison
  console.log('\n' + '='.repeat(100));
  console.log('SECOND CONDITION COMPARISON (c6485bb7...)');
  console.log('='.repeat(100));

  const trades2 = await loadRawTradesForCondition(SMART_MONEY_1, SECOND_CONDITION);
  console.log(`Loaded ${trades2.length.toLocaleString()} trades for second condition`);

  if (trades2.length > 0) {
    console.log('\nWindow    | Paired Qty      | % of idx0 Sells | % of idx1 Buys | Pairs Found');
    console.log('-'.repeat(100));

    for (const windowSec of [0, ...WINDOW_SIZES]) {
      const result = inferCrossTimestampNegRiskPairs(trades2, windowSec);
      const pctIdx0 = result.debugStats.totalIdx0Sell > 0 ? (result.debugStats.pairedQty / result.debugStats.totalIdx0Sell * 100).toFixed(1) : '0.0';
      const pctIdx1 = result.debugStats.totalIdx1Buy > 0 ? (result.debugStats.pairedQty / result.debugStats.totalIdx1Buy * 100).toFixed(1) : '0.0';
      console.log(
        `W = ${windowSec.toString().padStart(2)}s  | ${result.debugStats.pairedQty.toLocaleString().padStart(14)} | ${pctIdx0.padStart(14)}% | ${pctIdx1.padStart(13)}% | ${result.debugStats.pairsFound.toLocaleString().padStart(10)}`
      );
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('EXPERIMENT COMPLETE');
  console.log('='.repeat(100));
}

function printStats(label: string, stats: CrossTimestampNegRiskStats) {
  console.log(`\n${label}:`);
  console.log(`  idx0 sells total:  ${stats.totalIdx0Sell.toLocaleString()}`);
  console.log(`  idx1 buys total:   ${stats.totalIdx1Buy.toLocaleString()}`);
  console.log(`  paired qty:        ${stats.pairedQty.toLocaleString()}`);
  console.log(`  unpaired idx0:     ${stats.unpairedIdx0.toLocaleString()}`);
  console.log(`  unpaired idx1:     ${stats.unpairedIdx1.toLocaleString()}`);
  console.log(`  pairs found:       ${stats.pairsFound.toLocaleString()}`);
}

runExperiment().catch(console.error);
