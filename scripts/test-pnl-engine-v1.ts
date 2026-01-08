/**
 * Test Suite for PnL Engine V1
 *
 * Validates the unified PnL formula against 7 test wallets:
 * - 1 original (owner-confirmed $1.16)
 * - 2 maker-heavy (80%+ maker trades)
 * - 2 taker-heavy (80%+ taker trades)
 * - 2 mixed (40-60% maker/taker)
 *
 * Test methodology:
 * 1. Run getWalletPnLV1() for each wallet
 * 2. Compare realized PnL against UI-confirmed values
 * 3. Report synthetic and unrealized metrics
 * 4. Pass/fail based on $0.50 tolerance (accounts for cent-rounding drift)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1, getWalletMarketsPnLV1, TEST_WALLETS, EXPECTED_PNL, PnLResult } from '../lib/pnl/pnlEngineV1';

interface TestCase {
  name: string;
  wallet: string;
  expectedPnL: number | null; // null = not yet validated against UI
  tolerance: number;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Original (owner confirmed)',
    wallet: TEST_WALLETS.original,
    expectedPnL: EXPECTED_PNL.original,
    tolerance: 0.10,
  },
  {
    name: 'Maker Heavy #1',
    wallet: TEST_WALLETS.maker_heavy_1,
    expectedPnL: EXPECTED_PNL.maker_heavy_1,
    tolerance: 0.50,
  },
  {
    name: 'Maker Heavy #2',
    wallet: TEST_WALLETS.maker_heavy_2,
    expectedPnL: null, // ~$1500, needs UI validation
    tolerance: 50.0, // 3% tolerance for large PnL
  },
  {
    name: 'Taker Heavy #1',
    wallet: TEST_WALLETS.taker_heavy_1,
    expectedPnL: EXPECTED_PNL.taker_heavy_1,
    tolerance: 0.50,
  },
  {
    name: 'Taker Heavy #2',
    wallet: TEST_WALLETS.taker_heavy_2,
    expectedPnL: EXPECTED_PNL.taker_heavy_2,
    tolerance: 0.50,
  },
  {
    name: 'Mixed #1',
    wallet: TEST_WALLETS.mixed_1,
    expectedPnL: EXPECTED_PNL.mixed_1,
    tolerance: 0.10,
  },
  {
    name: 'Mixed #2',
    wallet: TEST_WALLETS.mixed_2,
    expectedPnL: null, // ~$4916, needs UI validation
    tolerance: 150.0, // 3% tolerance for large PnL
  },
];

function formatPnL(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}$${value.toFixed(2)}`;
}

function formatResult(passed: boolean): string {
  return passed ? '\u2705' : '\u274C';
}

async function runTests(): Promise<void> {
  console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  PnL Engine V1 Test Suite                                         \u2551');
  console.log('\u2551  Testing 7 wallets: 1 original, 2 maker, 2 taker, 2 mixed         \u2551');
  console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D\n');

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const results: Array<{ name: string; result: PnLResult; expected: number | null; passed: boolean | null }> = [];

  for (const testCase of TEST_CASES) {
    console.log(`\n\u2500\u2500\u2500 Testing: ${testCase.name} \u2500\u2500\u2500`);
    console.log(`Wallet: ${testCase.wallet}`);

    try {
      const result = await getWalletPnLV1(testCase.wallet);

      console.log(`\nResults:`);
      console.log(`  Realized PnL:           ${formatPnL(result.realized.pnl)} (${result.realized.marketCount} markets)`);
      console.log(`  Synthetic Realized PnL: ${formatPnL(result.syntheticRealized.pnl)} (${result.syntheticRealized.marketCount} markets)`);
      console.log(`  Unrealized PnL:         ${formatPnL(result.unrealized.pnl)} (${result.unrealized.marketCount} markets)`);
      console.log(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
      console.log(`  TOTAL PnL:              ${formatPnL(result.total)}`);

      // Validation
      if (testCase.expectedPnL !== null) {
        // For realized PnL comparison (UI shows realized only for closed positions)
        const delta = Math.abs(result.realized.pnl - testCase.expectedPnL);
        const testPassed = delta <= testCase.tolerance;

        console.log(`\nValidation:`);
        console.log(`  Expected (UI):  ${formatPnL(testCase.expectedPnL)}`);
        console.log(`  Calculated:     ${formatPnL(result.realized.pnl)}`);
        console.log(`  Delta:          $${delta.toFixed(2)} (tolerance: $${testCase.tolerance.toFixed(2)})`);
        console.log(`  Result:         ${formatResult(testPassed)} ${testPassed ? 'PASSED' : 'FAILED'}`);

        if (testPassed) {
          passed++;
        } else {
          failed++;
        }
        results.push({ name: testCase.name, result, expected: testCase.expectedPnL, passed: testPassed });
      } else {
        console.log(`\nValidation: SKIPPED (needs UI confirmation)`);
        console.log(`  Estimated PnL: ${formatPnL(result.realized.pnl)}`);
        skipped++;
        results.push({ name: testCase.name, result, expected: null, passed: null });
      }
    } catch (error) {
      console.error(`  ERROR: ${error}`);
      failed++;
      results.push({ name: testCase.name, result: null as any, expected: testCase.expectedPnL, passed: false });
    }
  }

  // Summary
  console.log('\n\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  TEST SUMMARY                                                      \u2551');
  console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D\n');

  console.log('Results by Wallet:');
  console.log('\u2500'.repeat(90));
  console.log(
    'Name'.padEnd(25),
    'Realized'.padStart(12),
    'Synthetic'.padStart(12),
    'Unrealized'.padStart(12),
    'Total'.padStart(12),
    'Status'.padStart(10)
  );
  console.log('\u2500'.repeat(90));

  for (const r of results) {
    if (r.result) {
      const status = r.passed === null ? 'SKIP' : r.passed ? 'PASS' : 'FAIL';
      const statusIcon = r.passed === null ? '\u26A0\uFE0F' : r.passed ? '\u2705' : '\u274C';
      console.log(
        r.name.padEnd(25),
        formatPnL(r.result.realized.pnl).padStart(12),
        formatPnL(r.result.syntheticRealized.pnl).padStart(12),
        formatPnL(r.result.unrealized.pnl).padStart(12),
        formatPnL(r.result.total).padStart(12),
        `${statusIcon} ${status}`.padStart(10)
      );
    }
  }
  console.log('\u2500'.repeat(90));

  console.log(`\n\u2705 Passed:  ${passed}`);
  console.log(`\u274C Failed:  ${failed}`);
  console.log(`\u26A0\uFE0F  Skipped: ${skipped} (awaiting UI validation)`);

  const overallPassed = failed === 0;
  console.log(`\n${overallPassed ? '\u2705 ALL VALIDATED TESTS PASSED' : '\u274C SOME TESTS FAILED'}`);

  process.exit(overallPassed ? 0 : 1);
}

// Run if executed directly
runTests().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
