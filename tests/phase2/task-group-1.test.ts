#!/usr/bin/env npx tsx
/**
 * Task Group 1: Wallet Metrics Calculation Engine
 *
 * 6 focused tests validating metric calculation formulas:
 * 1. P&L composition (realized + unrealized = total)
 * 2. Unrealized payout (from payout vectors)
 * 3. Win rate (winning markets / total markets)
 * 4. Sharpe ratio (risk-adjusted returns)
 * 5. Omega ratio (gain/loss ratio)
 * 6. Activity metrics (trade and market counts)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  calculateRealizedPnL,
  calculateUnrealizedPayout,
  calculateWinRate,
  calculateSharpeRatio,
  calculateOmegaRatio,
  getActivityMetrics,
  type MetricsCalculatorOptions
} from '../../lib/clickhouse/metrics-calculator';

const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const BASELINE_PNL = -27558.71;
const DATE_START = '2022-06-01';

// Test utilities
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  actual?: any;
  expected?: any;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (error: any) {
    results.push({
      name,
      passed: false,
      error: error.message,
      actual: error.actual,
      expected: error.expected
    });
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    if (error.expected !== undefined && error.actual !== undefined) {
      console.log(`    Expected: ${error.expected}`);
      console.log(`    Actual: ${error.actual}`);
    }
  }
}

function assert(condition: boolean, message: string, actual?: any, expected?: any) {
  if (!condition) {
    const err = new Error(message);
    (err as any).actual = actual;
    (err as any).expected = expected;
    throw err;
  }
}

function assertAlmostEqual(actual: number, expected: number, tolerance: number, message: string) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    const err = new Error(
      `${message}: expected ≈${expected} (±${tolerance}), got ${actual}`
    );
    (err as any).actual = actual;
    (err as any).expected = expected;
    throw err;
  }
}

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK GROUP 1: WALLET METRICS CALCULATION ENGINE');
  console.log('═'.repeat(100) + '\n');

  try {
    // Test 1: P&L Composition (Realized + Unrealized = Total)
    console.log('Test 1: P&L composition (realized + unrealized = total)\n');
    await test('Should calculate metrics that sum to total P&L baseline -$27,558.71', async () => {
      const options: MetricsCalculatorOptions = {
        wallet: BASELINE_WALLET,
        dateStart: DATE_START,
        dateEnd: '2025-11-10'
      };

      const realized = await calculateRealizedPnL(ch, options);
      const unrealized = await calculateUnrealizedPayout(ch, options);
      const total = realized + unrealized;

      // Total should equal baseline (within $0.1 tolerance for numerical precision)
      assertAlmostEqual(
        total,
        BASELINE_PNL,
        0.1,
        `Total P&L should match baseline`
      );

      console.log(`    Realized P&L: $${realized.toFixed(2)}`);
      console.log(`    Unrealized Payout: $${unrealized.toFixed(2)}`);
      console.log(`    Total P&L: $${total.toFixed(2)} (Expected: $${BASELINE_PNL.toFixed(2)})`);
    });

    // Test 2: Unrealized Payout Calculation
    console.log('\nTest 2: Unrealized payout calculation (from market_resolutions_final)\n');
    await test('Should calculate unrealized payout using payout vectors', async () => {
      const options: MetricsCalculatorOptions = {
        wallet: BASELINE_WALLET,
        dateStart: DATE_START,
        dateEnd: '2025-11-10'
      };

      const unrealizedPayout = await calculateUnrealizedPayout(ch, options);

      // Should be a valid number
      assert(typeof unrealizedPayout === 'number', 'Unrealized payout should be a number');

      // Sanity check
      assert(
        unrealizedPayout >= -1000000,
        `Unrealized payout should be >= -1M (sanity check), got ${unrealizedPayout}`
      );

      console.log(`    Unrealized payout: $${unrealizedPayout.toFixed(2)}`);
    });

    // Test 3: Win Rate Calculation
    console.log('\nTest 3: Win rate calculation (winning markets / total markets)\n');
    await test('Should calculate win rate between 0 and 1', async () => {
      const options: MetricsCalculatorOptions = {
        wallet: BASELINE_WALLET,
        dateStart: DATE_START,
        dateEnd: '2025-11-10'
      };

      const winRate = await calculateWinRate(ch, options);

      // Win rate should be in [0, 1]
      assert(
        winRate >= 0 && winRate <= 1,
        `Win rate should be between 0 and 1, got ${winRate}`
      );

      console.log(`    Win rate: ${(winRate * 100).toFixed(1)}% (${winRate.toFixed(4)})`);
    });

    // Test 4: Sharpe Ratio Calculation
    console.log('\nTest 4: Sharpe ratio calculation (annualized return / return volatility)\n');
    await test('Should calculate Sharpe ratio with valid range [-5, 10]', async () => {
      const options: MetricsCalculatorOptions = {
        wallet: BASELINE_WALLET,
        dateStart: DATE_START,
        dateEnd: '2025-11-10'
      };

      const sharpe = await calculateSharpeRatio(ch, options);

      if (sharpe !== null) {
        // Sharpe should be in reasonable range
        assert(
          sharpe >= -5 && sharpe <= 10,
          `Sharpe ratio should be between -5 and 10, got ${sharpe}`,
          sharpe,
          'range [-5, 10]'
        );
        console.log(`    Sharpe ratio: ${sharpe.toFixed(4)}`);
      } else {
        console.log(`    Sharpe ratio: NULL (insufficient data or zero volatility)`);
      }
    });

    // Test 5: Omega Ratio Calculation
    console.log('\nTest 5: Omega ratio calculation (sum(gains) / sum(losses))\n');
    await test('Should calculate Omega ratio with proper division by zero handling', async () => {
      const options: MetricsCalculatorOptions = {
        wallet: BASELINE_WALLET,
        dateStart: DATE_START,
        dateEnd: '2025-11-10'
      };

      const omega = await calculateOmegaRatio(ch, options);

      if (omega !== null) {
        // Omega should be >= 0
        assert(
          omega >= 0,
          `Omega ratio should be >= 0, got ${omega}`,
          omega,
          '≥ 0'
        );
        console.log(`    Omega ratio: ${omega.toFixed(4)}`);
      } else {
        console.log(`    Omega ratio: NULL (no gains, no losses, or division by zero)`);
      }
    });

    // Test 6: Activity Metrics
    console.log('\nTest 6: Activity metrics (trade and market counts)\n');
    await test('Should calculate activity metrics (trades and markets)', async () => {
      const options: MetricsCalculatorOptions = {
        wallet: BASELINE_WALLET,
        dateStart: DATE_START,
        dateEnd: '2025-11-10'
      };

      const { total_trades, markets_traded } = await getActivityMetrics(ch, options);

      // Should have positive counts
      assert(
        total_trades > 0,
        `Total trades should be > 0, got ${total_trades}`
      );

      assert(
        markets_traded > 0 && markets_traded <= total_trades,
        `Markets traded should be > 0 and <= total trades (${total_trades}), got ${markets_traded}`
      );

      console.log(`    Total trades: ${total_trades}`);
      console.log(`    Markets traded: ${markets_traded}`);
      console.log(`    Avg trades per market: ${(total_trades / markets_traded).toFixed(1)}`);
    });

    // Summary
    console.log('\n' + '═'.repeat(100));
    console.log('TEST RESULTS');
    console.log('═'.repeat(100) + '\n');

    const passed = results.filter(r => r.passed).length;
    const total = results.length;

    results.forEach(r => {
      const status = r.passed ? '✓' : '✗';
      console.log(`${status} ${r.name}`);
    });

    console.log(`\n${passed}/${total} tests passed\n`);

    if (passed === total) {
      console.log('✅ ALL TESTS PASSED - Ready for implementation gate\n');
      process.exit(0);
    } else {
      console.log('❌ SOME TESTS FAILED - Review errors above\n');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
