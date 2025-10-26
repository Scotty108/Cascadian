/**
 * TSI Calculator Usage Examples
 *
 * This file demonstrates how to use the TSI calculator in various scenarios.
 * These examples show real-world usage patterns for:
 * - Calculating TSI for a single market
 * - Batch processing multiple markets
 * - Custom configurations for backtesting
 * - Integration with trading signal generation
 *
 * @module lib/metrics/tsi-calculator.example
 */

import {
  calculateTSI,
  calculateAndSaveTSI,
  calculateTSIBatch,
  loadTSIConfig,
  fetchPriceHistory,
  type TSIConfig,
  type TSIResult,
  type PricePoint,
} from './tsi-calculator';

/**
 * Example 1: Basic TSI Calculation
 *
 * Calculate TSI for a single market using the active configuration.
 */
async function example1_basicCalculation() {
  console.log('=== Example 1: Basic TSI Calculation ===\n');

  const marketId = '0x1234567890abcdef1234567890abcdef12345678';

  // Load active configuration from Supabase
  const config = await loadTSIConfig();
  console.log('Active TSI Configuration:', config);

  // Fetch 60 minutes of price history
  const priceHistory = await fetchPriceHistory(marketId, 60);
  console.log(`Fetched ${priceHistory.length} price points`);

  // Calculate TSI
  const result = await calculateTSI(priceHistory, config);

  console.log('\nTSI Results:');
  console.log(`  Fast Line: ${result.tsiFast.toFixed(2)}`);
  console.log(`  Slow Line: ${result.tsiSlow.toFixed(2)}`);
  console.log(`  Signal: ${result.crossoverSignal}`);

  if (result.crossoverTimestamp) {
    console.log(`  Crossover Time: ${result.crossoverTimestamp.toISOString()}`);
  }

  // Interpret the signal
  if (result.crossoverSignal === 'BULLISH') {
    console.log('\n✅ ENTRY SIGNAL: Fast crossed above slow');
    console.log('   Momentum is turning positive - consider entry if conviction is high');
  } else if (result.crossoverSignal === 'BEARISH') {
    console.log('\n❌ EXIT SIGNAL: Fast crossed below slow');
    console.log('   Momentum is turning negative - consider exiting position');
  } else {
    console.log('\n⏸️  NEUTRAL: No crossover detected');
    console.log('   Hold current position or wait for signal');
  }

  return result;
}

/**
 * Example 2: Calculate and Save to Database
 *
 * One-step function that calculates TSI and saves to ClickHouse.
 */
async function example2_calculateAndSave() {
  console.log('\n=== Example 2: Calculate and Save ===\n');

  const marketId = '0x1234567890abcdef1234567890abcdef12345678';

  // Calculate and save in one call
  const result = await calculateAndSaveTSI(marketId, 60);

  console.log('TSI calculated and saved to ClickHouse!');
  console.log(`  Fast: ${result.tsiFast.toFixed(2)}`);
  console.log(`  Slow: ${result.tsiSlow.toFixed(2)}`);
  console.log(`  Signal: ${result.crossoverSignal}`);

  return result;
}

/**
 * Example 3: Batch Processing Multiple Markets
 *
 * Process TSI for many markets in parallel with automatic batching.
 */
async function example3_batchProcessing() {
  console.log('\n=== Example 3: Batch Processing ===\n');

  const marketIds = [
    '0x1234567890abcdef1234567890abcdef12345678',
    '0xabcdef1234567890abcdef1234567890abcdef12',
    '0x7890abcdef1234567890abcdef1234567890abcd',
    // ... add more market IDs
  ];

  console.log(`Processing ${marketIds.length} markets...`);

  // Calculate TSI for all markets in batches
  const results = await calculateTSIBatch(marketIds, 60);

  console.log(`\nProcessed ${results.size} markets successfully`);

  // Analyze results
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;

  for (const [marketId, result] of results) {
    if (result.crossoverSignal === 'BULLISH') {
      bullishCount++;
      console.log(`\n✅ ${marketId.slice(0, 10)}... - BULLISH`);
      console.log(`   TSI Fast: ${result.tsiFast.toFixed(2)}, Slow: ${result.tsiSlow.toFixed(2)}`);
    } else if (result.crossoverSignal === 'BEARISH') {
      bearishCount++;
    } else {
      neutralCount++;
    }
  }

  console.log('\nSummary:');
  console.log(`  Bullish signals: ${bullishCount}`);
  console.log(`  Bearish signals: ${bearishCount}`);
  console.log(`  Neutral: ${neutralCount}`);

  return results;
}

/**
 * Example 4: Custom Configuration for Backtesting
 *
 * Test different smoothing methods and periods to find optimal settings.
 */
async function example4_customConfiguration() {
  console.log('\n=== Example 4: Custom Configuration ===\n');

  const marketId = '0x1234567890abcdef1234567890abcdef12345678';

  // Fetch price history once
  const priceHistory = await fetchPriceHistory(marketId, 60);

  // Test different configurations
  const configurations: TSIConfig[] = [
    {
      // Austin's default (RMA)
      fastPeriods: 9,
      fastSmoothing: 'RMA',
      slowPeriods: 21,
      slowSmoothing: 'RMA',
    },
    {
      // More responsive (EMA)
      fastPeriods: 9,
      fastSmoothing: 'EMA',
      slowPeriods: 21,
      slowSmoothing: 'EMA',
    },
    {
      // Simple (SMA)
      fastPeriods: 9,
      fastSmoothing: 'SMA',
      slowPeriods: 21,
      slowSmoothing: 'SMA',
    },
    {
      // Faster periods
      fastPeriods: 5,
      fastSmoothing: 'RMA',
      slowPeriods: 13,
      slowSmoothing: 'RMA',
    },
  ];

  console.log(`Testing ${configurations.length} different configurations...\n`);

  for (const [index, config] of configurations.entries()) {
    const result = await calculateTSI(priceHistory, config);

    console.log(`Configuration ${index + 1}:`);
    console.log(`  Method: ${config.fastSmoothing} (${config.fastPeriods}/${config.slowPeriods})`);
    console.log(`  Fast: ${result.tsiFast.toFixed(2)}, Slow: ${result.tsiSlow.toFixed(2)}`);
    console.log(`  Signal: ${result.crossoverSignal}\n`);
  }
}

/**
 * Example 5: Real-Time Monitoring
 *
 * Monitor a market for TSI crossovers in real-time.
 */
async function example5_realTimeMonitoring() {
  console.log('\n=== Example 5: Real-Time Monitoring ===\n');

  const marketId = '0x1234567890abcdef1234567890abcdef12345678';
  const config = await loadTSIConfig();

  let previousSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';

  console.log('Monitoring market for TSI crossovers...');
  console.log('Press Ctrl+C to stop\n');

  // Monitor every 30 seconds
  const interval = setInterval(async () => {
    try {
      const priceHistory = await fetchPriceHistory(marketId, 60);
      const result = await calculateTSI(priceHistory, config);

      // Check for signal changes
      if (result.crossoverSignal !== previousSignal) {
        const timestamp = new Date().toISOString();

        if (result.crossoverSignal === 'BULLISH') {
          console.log(`\n[${timestamp}] 🚀 BULLISH CROSSOVER DETECTED!`);
          console.log(`   Fast: ${result.tsiFast.toFixed(2)} crossed above Slow: ${result.tsiSlow.toFixed(2)}`);
          console.log('   → Consider ENTRY if conviction ≥ 0.9');
        } else if (result.crossoverSignal === 'BEARISH') {
          console.log(`\n[${timestamp}] ⚠️  BEARISH CROSSOVER DETECTED!`);
          console.log(`   Fast: ${result.tsiFast.toFixed(2)} crossed below Slow: ${result.tsiSlow.toFixed(2)}`);
          console.log('   → Consider EXIT to free up capital');
        }

        previousSignal = result.crossoverSignal;
      }
    } catch (error) {
      console.error('Error monitoring market:', error);
    }
  }, 30000); // 30 seconds

  // Run for 5 minutes then stop
  setTimeout(() => {
    clearInterval(interval);
    console.log('\nMonitoring stopped');
  }, 300000);
}

/**
 * Example 6: Integration with Trading Signals
 *
 * Combine TSI with directional conviction for complete trading signal.
 */
async function example6_tradingSignalIntegration() {
  console.log('\n=== Example 6: Trading Signal Integration ===\n');

  const marketId = '0x1234567890abcdef1234567890abcdef12345678';

  // Calculate TSI
  const result = await calculateAndSaveTSI(marketId, 60);

  // Mock conviction data (in production, this would come from directional-conviction.ts)
  const mockConviction = {
    directionalConviction: 0.92, // 92% conviction
    eliteConsensus: 0.88,
    dominantSide: 'YES' as const,
  };

  console.log('TSI Analysis:');
  console.log(`  Fast Line: ${result.tsiFast.toFixed(2)}`);
  console.log(`  Slow Line: ${result.tsiSlow.toFixed(2)}`);
  console.log(`  Crossover: ${result.crossoverSignal}`);

  console.log('\nConviction Analysis:');
  console.log(`  Overall Conviction: ${(mockConviction.directionalConviction * 100).toFixed(1)}%`);
  console.log(`  Elite Consensus: ${(mockConviction.eliteConsensus * 100).toFixed(1)}%`);
  console.log(`  Dominant Side: ${mockConviction.dominantSide}`);

  // Generate trading signal
  console.log('\n📊 Trading Signal:');

  if (
    result.crossoverSignal === 'BULLISH' &&
    mockConviction.directionalConviction >= 0.9
  ) {
    console.log('  Type: ENTRY');
    console.log(`  Direction: ${mockConviction.dominantSide}`);
    console.log('  Strength: STRONG');
    console.log('  Confidence: VERY HIGH');
    console.log('\n  ✅ EXECUTE: Enter position on dominant side');
  } else if (result.crossoverSignal === 'BEARISH') {
    console.log('  Type: EXIT');
    console.log('  Strength: MODERATE');
    console.log('\n  ⚠️  EXECUTE: Exit current position to preserve capital velocity');
  } else if (result.crossoverSignal === 'BULLISH') {
    console.log('  Type: POTENTIAL ENTRY');
    console.log('  Strength: WEAK');
    console.log(
      `  Issue: Conviction too low (${(mockConviction.directionalConviction * 100).toFixed(1)}% < 90%)`
    );
    console.log('\n  ⏸️  HOLD: Wait for higher conviction');
  } else {
    console.log('  Type: HOLD');
    console.log('  Strength: NEUTRAL');
    console.log('\n  ⏸️  WAIT: No signal at this time');
  }
}

/**
 * Example 7: Working with Manual Price Data
 *
 * Calculate TSI using manually provided price data (useful for testing).
 */
async function example7_manualPriceData() {
  console.log('\n=== Example 7: Manual Price Data ===\n');

  // Create sample price history (simulating a bullish trend)
  const priceHistory: PricePoint[] = [];
  const startTime = Date.now() - 60 * 60 * 1000; // 1 hour ago
  const basePrice = 0.50;

  for (let i = 0; i < 360; i++) {
    // 360 data points (10-second intervals)
    const timestamp = new Date(startTime + i * 10 * 1000);
    // Simulate upward trend with noise
    const trend = i * 0.0001; // Gradual increase
    const noise = (Math.random() - 0.5) * 0.005; // Random noise ±0.25%
    const price = basePrice + trend + noise;

    priceHistory.push({ timestamp, price });
  }

  console.log(`Created ${priceHistory.length} simulated price points`);
  console.log(`  Start Price: ${priceHistory[0].price.toFixed(4)}`);
  console.log(`  End Price: ${priceHistory[priceHistory.length - 1].price.toFixed(4)}`);

  // Use Austin's default configuration
  const config: TSIConfig = {
    fastPeriods: 9,
    fastSmoothing: 'RMA',
    slowPeriods: 21,
    slowSmoothing: 'RMA',
  };

  const result = await calculateTSI(priceHistory, config);

  console.log('\nTSI Results:');
  console.log(`  Fast Line: ${result.tsiFast.toFixed(2)}`);
  console.log(`  Slow Line: ${result.tsiSlow.toFixed(2)}`);
  console.log(`  Signal: ${result.crossoverSignal}`);

  // Analyze momentum
  const avgMomentum =
    result.momentumValues.reduce((sum, m) => sum + m, 0) / result.momentumValues.length;
  console.log(`  Average Momentum: ${avgMomentum.toFixed(6)}`);
}

/**
 * Main execution
 *
 * Run examples based on command line argument.
 */
async function main() {
  const example = process.argv[2] || '1';

  try {
    switch (example) {
      case '1':
        await example1_basicCalculation();
        break;
      case '2':
        await example2_calculateAndSave();
        break;
      case '3':
        await example3_batchProcessing();
        break;
      case '4':
        await example4_customConfiguration();
        break;
      case '5':
        await example5_realTimeMonitoring();
        break;
      case '6':
        await example6_tradingSignalIntegration();
        break;
      case '7':
        await example7_manualPriceData();
        break;
      case 'all':
        await example1_basicCalculation();
        await example2_calculateAndSave();
        await example3_batchProcessing();
        await example4_customConfiguration();
        await example6_tradingSignalIntegration();
        await example7_manualPriceData();
        break;
      default:
        console.log('Unknown example. Use: 1, 2, 3, 4, 5, 6, 7, or all');
    }
  } catch (error) {
    console.error('Error running example:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

/**
 * To run these examples:
 *
 * # Run a specific example
 * npx tsx lib/metrics/tsi-calculator.example.ts 1
 * npx tsx lib/metrics/tsi-calculator.example.ts 2
 *
 * # Run all examples
 * npx tsx lib/metrics/tsi-calculator.example.ts all
 */
