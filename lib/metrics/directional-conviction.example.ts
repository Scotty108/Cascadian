/**
 * Directional Conviction Calculator - Example Usage
 *
 * This file demonstrates how to use the directional conviction calculator
 * in conjunction with the TSI calculator for Austin's momentum strategy.
 */

import { calculateAndSaveTSI } from './tsi-calculator';
import {
  calculateDirectionalConviction,
  calculateBothSides,
  calculateConvictionBatch,
  getConvictionThreshold,
  type ConvictionResult,
} from './directional-conviction';

/**
 * Example 1: Basic Conviction Calculation
 *
 * Calculate conviction for a single market and side.
 */
async function example1_basicCalculation() {
  console.log('\n=== Example 1: Basic Conviction Calculation ===\n');

  const result = await calculateDirectionalConviction({
    marketId: '0x123...', // Replace with real market ID
    conditionId: '0xabc...', // Replace with real condition ID
    side: 'YES',
    lookbackHours: 24,
  });

  console.log('Directional Conviction Result:');
  console.log(`  Overall conviction: ${(result.directionalConviction * 100).toFixed(1)}%`);
  console.log(`  Elite consensus: ${(result.eliteConsensusPct * 100).toFixed(1)}%`);
  console.log(`  Category specialist consensus: ${(result.categorySpecialistPct * 100).toFixed(1)}%`);
  console.log(`  Omega-weighted consensus: ${(result.omegaWeightedConsensus * 100).toFixed(1)}%`);
  console.log(`  Meets entry threshold: ${result.meetsEntryThreshold ? 'YES ✓' : 'NO ✗'}`);
  console.log('\nSupporting Data:');
  console.log(`  Elite wallets on YES: ${result.eliteWalletsOnSide} / ${result.eliteWalletsCount}`);
  console.log(`  Specialists on YES: ${result.specialistsOnSide} / ${result.specialistsCount}`);
  console.log(`  Total omega weight: ${result.totalOmegaWeight.toFixed(2)}`);
}

/**
 * Example 2: Integration with TSI for Trading Signals
 *
 * Combine TSI crossover detection with directional conviction
 * to generate entry/exit signals.
 */
async function example2_tsiIntegration() {
  console.log('\n=== Example 2: TSI + Conviction Integration ===\n');

  const marketId = '0x123...'; // Replace with real market ID
  const conditionId = '0xabc...'; // Replace with real condition ID

  // Calculate both TSI and conviction in parallel
  const [tsi, yesConviction, noConviction] = await Promise.all([
    calculateAndSaveTSI(marketId, 60), // 60 minutes of price history
    calculateDirectionalConviction({
      marketId,
      conditionId,
      side: 'YES',
      lookbackHours: 24,
    }),
    calculateDirectionalConviction({
      marketId,
      conditionId,
      side: 'NO',
      lookbackHours: 24,
    }),
  ]);

  console.log('TSI Analysis:');
  console.log(`  Fast line: ${tsi.tsiFast.toFixed(2)}`);
  console.log(`  Slow line: ${tsi.tsiSlow.toFixed(2)}`);
  console.log(`  Crossover signal: ${tsi.crossoverSignal}`);

  console.log('\nConviction Analysis:');
  console.log(`  YES conviction: ${(yesConviction.directionalConviction * 100).toFixed(1)}%`);
  console.log(`  NO conviction: ${(noConviction.directionalConviction * 100).toFixed(1)}%`);

  // Austin's Strategy: ENTRY signal
  if (tsi.crossoverSignal === 'BULLISH' && yesConviction.meetsEntryThreshold) {
    console.log('\n🎯 ENTRY SIGNAL DETECTED!');
    console.log('  Condition: Bullish TSI crossover + high YES conviction');
    console.log('  Action: Consider entering YES position');
    console.log(`  Elite consensus: ${(yesConviction.eliteConsensusPct * 100).toFixed(1)}% on YES`);
  } else if (tsi.crossoverSignal === 'BULLISH' && noConviction.meetsEntryThreshold) {
    console.log('\n🎯 ENTRY SIGNAL DETECTED!');
    console.log('  Condition: Bullish TSI crossover + high NO conviction');
    console.log('  Action: Consider entering NO position');
    console.log(`  Elite consensus: ${(noConviction.eliteConsensusPct * 100).toFixed(1)}% on NO`);
  }

  // Austin's Strategy: EXIT signal
  if (tsi.crossoverSignal === 'BEARISH') {
    console.log('\n🚪 EXIT SIGNAL DETECTED!');
    console.log('  Condition: Bearish TSI crossover');
    console.log('  Action: Exit position to free up capital');
    console.log('  Note: Do NOT wait for elite wallets to exit');
  }

  // HOLD signal
  if (tsi.crossoverSignal === 'NEUTRAL') {
    console.log('\n⏸️  HOLD SIGNAL');
    console.log('  Condition: No crossover detected');
    console.log('  Action: Monitor for crossover or conviction changes');
  }
}

/**
 * Example 3: Compare Both Sides
 *
 * Calculate conviction for both YES and NO to determine
 * which side has stronger smart money alignment.
 */
async function example3_compareSides() {
  console.log('\n=== Example 3: Compare YES vs NO Conviction ===\n');

  const marketId = '0x123...'; // Replace with real market ID
  const conditionId = '0xabc...'; // Replace with real condition ID

  const both = await calculateBothSides(marketId, conditionId, 24);

  console.log('YES Side:');
  console.log(`  Conviction: ${(both.YES.directionalConviction * 100).toFixed(1)}%`);
  console.log(`  Elite wallets: ${both.YES.eliteWalletsOnSide} / ${both.YES.eliteWalletsCount}`);
  console.log(`  Specialists: ${both.YES.specialistsOnSide} / ${both.YES.specialistsCount}`);

  console.log('\nNO Side:');
  console.log(`  Conviction: ${(both.NO.directionalConviction * 100).toFixed(1)}%`);
  console.log(`  Elite wallets: ${both.NO.eliteWalletsOnSide} / ${both.NO.eliteWalletsCount}`);
  console.log(`  Specialists: ${both.NO.specialistsOnSide} / ${both.NO.specialistsCount}`);

  // Determine stronger side
  if (both.YES.directionalConviction > both.NO.directionalConviction) {
    const diff = both.YES.directionalConviction - both.NO.directionalConviction;
    console.log(`\n→ Smart money favors YES (${(diff * 100).toFixed(1)}% stronger)`);
  } else if (both.NO.directionalConviction > both.YES.directionalConviction) {
    const diff = both.NO.directionalConviction - both.YES.directionalConviction;
    console.log(`\n→ Smart money favors NO (${(diff * 100).toFixed(1)}% stronger)`);
  } else {
    console.log('\n→ Smart money is evenly split');
  }
}

/**
 * Example 4: Batch Processing Multiple Markets
 *
 * Calculate conviction for multiple markets in parallel.
 * Useful for screening many opportunities at once.
 */
async function example4_batchProcessing() {
  console.log('\n=== Example 4: Batch Conviction Screening ===\n');

  // List of markets to analyze
  const markets = [
    { marketId: '0x123...', conditionId: '0xabc...', side: 'YES' as const },
    { marketId: '0x456...', conditionId: '0xdef...', side: 'YES' as const },
    { marketId: '0x789...', conditionId: '0xghi...', side: 'NO' as const },
  ];

  console.log(`Analyzing ${markets.length} markets...\n`);

  const results = await calculateConvictionBatch(markets, 5); // Process 5 at a time

  // Filter for high-conviction opportunities
  const highConviction = Array.from(results.entries())
    .filter(([_, result]) => result.meetsEntryThreshold)
    .sort((a, b) => b[1].directionalConviction - a[1].directionalConviction);

  console.log(`Found ${highConviction.length} high-conviction opportunities:\n`);

  for (const [marketId, result] of highConviction) {
    console.log(`Market: ${marketId}`);
    console.log(`  Conviction: ${(result.directionalConviction * 100).toFixed(1)}%`);
    console.log(`  Side: ${result.side}`);
    console.log(`  Elite consensus: ${(result.eliteConsensusPct * 100).toFixed(1)}%`);
    console.log(`  Elite wallets: ${result.eliteWalletsOnSide} / ${result.eliteWalletsCount}`);
    console.log('');
  }

  // Show low-conviction markets
  const lowConviction = Array.from(results.entries())
    .filter(([_, result]) => !result.meetsEntryThreshold)
    .sort((a, b) => b[1].directionalConviction - a[1].directionalConviction);

  console.log(`\n${lowConviction.length} markets below threshold:\n`);

  for (const [marketId, result] of lowConviction.slice(0, 3)) {
    console.log(`Market: ${marketId}`);
    console.log(`  Conviction: ${(result.directionalConviction * 100).toFixed(1)}%`);
    console.log(`  Missing threshold by: ${((0.9 - result.directionalConviction) * 100).toFixed(1)}%`);
    console.log('');
  }
}

/**
 * Example 5: Real-Time Signal Generation
 *
 * Simulate a real-time trading signal generator that combines
 * TSI crossovers with conviction checks.
 */
async function example5_realTimeSignals() {
  console.log('\n=== Example 5: Real-Time Signal Generation ===\n');

  const marketId = '0x123...'; // Replace with real market ID
  const conditionId = '0xabc...'; // Replace with real condition ID

  // Simulated loop (in production, this would run every 60 seconds)
  console.log('Monitoring market for signals...\n');

  const tsi = await calculateAndSaveTSI(marketId, 60);
  const [yesConviction, noConviction] = await Promise.all([
    calculateDirectionalConviction({ marketId, conditionId, side: 'YES' }),
    calculateDirectionalConviction({ marketId, conditionId, side: 'NO' }),
  ]);

  // Signal generation logic
  if (tsi.crossoverSignal === 'BULLISH') {
    console.log('📈 Bullish TSI Crossover Detected');

    if (yesConviction.meetsEntryThreshold) {
      generateEntrySignal('YES', tsi, yesConviction);
    } else if (noConviction.meetsEntryThreshold) {
      generateEntrySignal('NO', tsi, noConviction);
    } else {
      console.log('  ⚠️  Low conviction - no entry signal generated');
      console.log(`  YES conviction: ${(yesConviction.directionalConviction * 100).toFixed(1)}%`);
      console.log(`  NO conviction: ${(noConviction.directionalConviction * 100).toFixed(1)}%`);
    }
  } else if (tsi.crossoverSignal === 'BEARISH') {
    console.log('📉 Bearish TSI Crossover Detected');
    generateExitSignal(tsi);
  } else {
    console.log('⏸️  No crossover - monitoring...');
    console.log(`  TSI Fast: ${tsi.tsiFast.toFixed(2)}`);
    console.log(`  TSI Slow: ${tsi.tsiSlow.toFixed(2)}`);
    console.log(`  YES conviction: ${(yesConviction.directionalConviction * 100).toFixed(1)}%`);
    console.log(`  NO conviction: ${(noConviction.directionalConviction * 100).toFixed(1)}%`);
  }
}

/**
 * Generate ENTRY signal
 */
function generateEntrySignal(
  side: 'YES' | 'NO',
  tsi: any,
  conviction: ConvictionResult
) {
  console.log(`\n🎯 ENTRY SIGNAL GENERATED`);
  console.log(`  Direction: ${side}`);
  console.log(`  TSI Fast: ${tsi.tsiFast.toFixed(2)}`);
  console.log(`  TSI Slow: ${tsi.tsiSlow.toFixed(2)}`);
  console.log(`  Conviction: ${(conviction.directionalConviction * 100).toFixed(1)}%`);
  console.log(`  Elite consensus: ${(conviction.eliteConsensusPct * 100).toFixed(1)}%`);
  console.log(`  Elite wallets: ${conviction.eliteWalletsOnSide} / ${conviction.eliteWalletsCount}`);
  console.log(`  Specialists: ${conviction.specialistsOnSide} / ${conviction.specialistsCount}`);

  // In production, this would:
  // 1. Save to momentum_trading_signals table
  // 2. Send webhook notification
  // 3. Update UI dashboard
  // 4. Log to monitoring system
}

/**
 * Generate EXIT signal
 */
function generateExitSignal(tsi: any) {
  console.log(`\n🚪 EXIT SIGNAL GENERATED`);
  console.log(`  Reason: Bearish TSI crossover`);
  console.log(`  TSI Fast: ${tsi.tsiFast.toFixed(2)}`);
  console.log(`  TSI Slow: ${tsi.tsiSlow.toFixed(2)}`);
  console.log(`  Action: Exit position to free capital`);

  // In production, same actions as entry signal
}

/**
 * Example 6: Custom Conviction Threshold
 *
 * Demonstrate how to use custom conviction thresholds
 * for different risk tolerances.
 */
async function example6_customThreshold() {
  console.log('\n=== Example 6: Custom Conviction Thresholds ===\n');

  const marketId = '0x123...';
  const conditionId = '0xabc...';

  const conviction = await calculateDirectionalConviction({
    marketId,
    conditionId,
    side: 'YES',
  });

  const currentThreshold = getConvictionThreshold();
  console.log(`Current threshold: ${(currentThreshold * 100).toFixed(0)}%`);
  console.log(`Market conviction: ${(conviction.directionalConviction * 100).toFixed(1)}%`);

  // Test different thresholds
  const thresholds = [0.75, 0.85, 0.9, 0.95];

  console.log('\nSignal status at different thresholds:');
  for (const threshold of thresholds) {
    const meetsThreshold = conviction.directionalConviction >= threshold;
    const status = meetsThreshold ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${(threshold * 100).toFixed(0)}%: ${status}`);
  }

  console.log('\nRisk Tolerance Recommendations:');
  console.log('  Conservative (95%): Very few signals, highest confidence');
  console.log('  Moderate (90%): Austin\'s default, balanced');
  console.log('  Aggressive (85%): More signals, higher risk');
  console.log('  Very Aggressive (75%): Many signals, use with caution');
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('='.repeat(60));
  console.log('DIRECTIONAL CONVICTION CALCULATOR - EXAMPLES');
  console.log('='.repeat(60));

  try {
    // Uncomment to run specific examples:

    // await example1_basicCalculation();
    // await example2_tsiIntegration();
    // await example3_compareSides();
    // await example4_batchProcessing();
    // await example5_realTimeSignals();
    // await example6_customThreshold();

    console.log('\nNote: Examples use placeholder market IDs.');
    console.log('Replace with real market/condition IDs to run.');
  } catch (error) {
    console.error('Error running examples:', error);
  }

  console.log('\n' + '='.repeat(60));
}

// Export for use in other files
export {
  example1_basicCalculation,
  example2_tsiIntegration,
  example3_compareSides,
  example4_batchProcessing,
  example5_realTimeSignals,
  example6_customThreshold,
};

// Run if executed directly
if (require.main === module) {
  runAllExamples();
}
