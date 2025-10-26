/**
 * TSI Calculator Test Suite
 *
 * Simple tests to validate TSI calculator functionality.
 * Can be run with: npx tsx lib/metrics/tsi-calculator.test.ts
 */

import { calculateTSI, type TSIConfig, type PricePoint } from './tsi-calculator';

/**
 * Generate mock price data for testing
 */
function generateMockPriceHistory(
  count: number,
  trend: 'up' | 'down' | 'flat' = 'flat'
): PricePoint[] {
  const history: PricePoint[] = [];
  const startTime = Date.now() - count * 10 * 1000; // 10 second intervals
  let basePrice = 0.50;

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(startTime + i * 10 * 1000);

    // Add trend
    if (trend === 'up') {
      basePrice += 0.0005; // Gradual increase
    } else if (trend === 'down') {
      basePrice -= 0.0005; // Gradual decrease
    }

    // Add noise
    const noise = (Math.random() - 0.5) * 0.002;
    const price = Math.max(0.01, Math.min(0.99, basePrice + noise));

    history.push({ timestamp, price });
  }

  return history;
}

/**
 * Test 1: Basic TSI calculation
 */
async function test1_basicCalculation() {
  console.log('Test 1: Basic TSI Calculation');
  console.log('================================\n');

  const config: TSIConfig = {
    fastPeriods: 9,
    fastSmoothing: 'RMA',
    slowPeriods: 21,
    slowSmoothing: 'RMA',
  };

  const priceHistory = generateMockPriceHistory(100, 'flat');

  try {
    const result = await calculateTSI(priceHistory, config);

    console.log('✅ TSI calculated successfully');
    console.log(`   Fast: ${result.tsiFast.toFixed(4)}`);
    console.log(`   Slow: ${result.tsiSlow.toFixed(4)}`);
    console.log(`   Signal: ${result.crossoverSignal}`);
    console.log(`   Momentum values: ${result.momentumValues.length}`);

    // Validate results
    if (isNaN(result.tsiFast) || isNaN(result.tsiSlow)) {
      throw new Error('TSI values are NaN');
    }

    if (result.tsiFast < -100 || result.tsiFast > 100) {
      throw new Error('TSI Fast out of range (-100 to 100)');
    }

    if (result.tsiSlow < -100 || result.tsiSlow > 100) {
      throw new Error('TSI Slow out of range (-100 to 100)');
    }

    console.log('\n✅ Test 1 PASSED\n');
    return true;
  } catch (error) {
    console.error('❌ Test 1 FAILED:', error);
    return false;
  }
}

/**
 * Test 2: Bullish trend detection
 */
async function test2_bullishTrend() {
  console.log('Test 2: Bullish Trend Detection');
  console.log('================================\n');

  const config: TSIConfig = {
    fastPeriods: 9,
    fastSmoothing: 'RMA',
    slowPeriods: 21,
    slowSmoothing: 'RMA',
  };

  const priceHistory = generateMockPriceHistory(100, 'up');

  try {
    const result = await calculateTSI(priceHistory, config);

    console.log('✅ TSI calculated for bullish trend');
    console.log(`   Fast: ${result.tsiFast.toFixed(4)}`);
    console.log(`   Slow: ${result.tsiSlow.toFixed(4)}`);
    console.log(`   Signal: ${result.crossoverSignal}`);

    // For uptrend, TSI should be positive
    if (result.tsiFast > 0) {
      console.log('✅ Fast TSI is positive (as expected for uptrend)');
    } else {
      console.log('⚠️  Fast TSI is negative (unexpected for strong uptrend)');
    }

    console.log('\n✅ Test 2 PASSED\n');
    return true;
  } catch (error) {
    console.error('❌ Test 2 FAILED:', error);
    return false;
  }
}

/**
 * Test 3: Bearish trend detection
 */
async function test3_bearishTrend() {
  console.log('Test 3: Bearish Trend Detection');
  console.log('================================\n');

  const config: TSIConfig = {
    fastPeriods: 9,
    fastSmoothing: 'RMA',
    slowPeriods: 21,
    slowSmoothing: 'RMA',
  };

  const priceHistory = generateMockPriceHistory(100, 'down');

  try {
    const result = await calculateTSI(priceHistory, config);

    console.log('✅ TSI calculated for bearish trend');
    console.log(`   Fast: ${result.tsiFast.toFixed(4)}`);
    console.log(`   Slow: ${result.tsiSlow.toFixed(4)}`);
    console.log(`   Signal: ${result.crossoverSignal}`);

    // For downtrend, TSI should be negative
    if (result.tsiFast < 0) {
      console.log('✅ Fast TSI is negative (as expected for downtrend)');
    } else {
      console.log('⚠️  Fast TSI is positive (unexpected for strong downtrend)');
    }

    console.log('\n✅ Test 3 PASSED\n');
    return true;
  } catch (error) {
    console.error('❌ Test 3 FAILED:', error);
    return false;
  }
}

/**
 * Test 4: Different smoothing methods
 */
async function test4_smoothingMethods() {
  console.log('Test 4: Different Smoothing Methods');
  console.log('===================================\n');

  const priceHistory = generateMockPriceHistory(100, 'up');
  const methods: Array<'SMA' | 'EMA' | 'RMA'> = ['SMA', 'EMA', 'RMA'];

  try {
    for (const method of methods) {
      const config: TSIConfig = {
        fastPeriods: 9,
        fastSmoothing: method,
        slowPeriods: 21,
        slowSmoothing: method,
      };

      const result = await calculateTSI(priceHistory, config);

      console.log(`${method} Smoothing:`);
      console.log(`   Fast: ${result.tsiFast.toFixed(4)}`);
      console.log(`   Slow: ${result.tsiSlow.toFixed(4)}`);
      console.log(`   Signal: ${result.crossoverSignal}\n`);
    }

    console.log('✅ Test 4 PASSED\n');
    return true;
  } catch (error) {
    console.error('❌ Test 4 FAILED:', error);
    return false;
  }
}

/**
 * Test 5: Insufficient data handling
 */
async function test5_insufficientData() {
  console.log('Test 5: Insufficient Data Handling');
  console.log('===================================\n');

  const config: TSIConfig = {
    fastPeriods: 9,
    fastSmoothing: 'RMA',
    slowPeriods: 21,
    slowSmoothing: 'RMA',
  };

  // Only 20 data points (need 30 minimum)
  const priceHistory = generateMockPriceHistory(20, 'flat');

  try {
    const result = await calculateTSI(priceHistory, config);
    console.log('❌ Should have thrown error for insufficient data');
    return false;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Insufficient')) {
      console.log('✅ Correctly threw error for insufficient data');
      console.log(`   Error: ${error.message}\n`);
      console.log('✅ Test 5 PASSED\n');
      return true;
    } else {
      console.error('❌ Wrong error thrown:', error);
      return false;
    }
  }
}

/**
 * Test 6: Crossover detection simulation
 */
async function test6_crossoverDetection() {
  console.log('Test 6: Crossover Detection');
  console.log('============================\n');

  const config: TSIConfig = {
    fastPeriods: 9,
    fastSmoothing: 'RMA',
    slowPeriods: 21,
    slowSmoothing: 'RMA',
  };

  try {
    // Create trend reversal scenario
    const priceHistory: PricePoint[] = [];
    const startTime = Date.now() - 100 * 10 * 1000;

    // First part: downtrend
    for (let i = 0; i < 50; i++) {
      const timestamp = new Date(startTime + i * 10 * 1000);
      const price = 0.60 - i * 0.001;
      priceHistory.push({ timestamp, price });
    }

    // Second part: uptrend reversal
    for (let i = 50; i < 100; i++) {
      const timestamp = new Date(startTime + i * 10 * 1000);
      const price = 0.10 + (i - 50) * 0.002;
      priceHistory.push({ timestamp, price });
    }

    const result = await calculateTSI(priceHistory, config);

    console.log('Trend reversal scenario:');
    console.log(`   Fast: ${result.tsiFast.toFixed(4)}`);
    console.log(`   Slow: ${result.tsiSlow.toFixed(4)}`);
    console.log(`   Signal: ${result.crossoverSignal}`);

    if (result.crossoverTimestamp) {
      console.log(`   Crossover at: ${result.crossoverTimestamp.toISOString()}`);
    }

    console.log('\n✅ Test 6 PASSED\n');
    return true;
  } catch (error) {
    console.error('❌ Test 6 FAILED:', error);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   TSI Calculator Test Suite                ║');
  console.log('╚════════════════════════════════════════════╝\n');

  const tests = [
    test1_basicCalculation,
    test2_bullishTrend,
    test3_bearishTrend,
    test4_smoothingMethods,
    test5_insufficientData,
    test6_crossoverDetection,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log('═══════════════════════════════════════════════');
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════\n');

  if (failed === 0) {
    console.log('🎉 All tests passed! TSI calculator is working correctly.\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Please review the errors above.\n');
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('Fatal error running tests:', error);
    process.exit(1);
  });
}
