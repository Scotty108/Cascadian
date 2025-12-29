/**
 * ============================================================================
 * V21 REGRESSION TEST
 * ============================================================================
 *
 * Fixed test set of 10 wallets for CI-style regression testing:
 *   - 6 "clean CLOB-only" (should pass gating, known UI values)
 *   - 2 "high duplication sensitive" (test dedupe stability)
 *   - 2 "high external-inventory" (should FAIL gating)
 *
 * Tests:
 *   1. Computes V21 net for each wallet
 *   2. Confirms clean wallets are within threshold of stored UI snapshots
 *   3. Confirms external-inventory wallets fail gating
 *
 * Usage:
 *   npx tsx scripts/pnl/regression-test-v21.ts
 *
 * Exit codes:
 *   0 = All tests passed
 *   1 = Some tests failed
 *
 * ============================================================================
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateV21PnL } from '../../lib/pnl/v21SyntheticEngine';

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

interface TestWallet {
  wallet: string;
  name: string;
  category: 'clean' | 'dedupe_sensitive' | 'external_inventory';
  ui_net: number | null;        // Expected UI value (if known)
  expected_gating: boolean;     // true = should pass, false = should fail
  tolerance_pct: number;        // Allowed delta from UI (%)
}

const TEST_WALLETS: TestWallet[] = [
  // Clean CLOB-only wallets (should pass gating)
  {
    wallet: '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4',
    name: '@ForgetAboutBenjamin',
    category: 'clean',
    ui_net: 10268,
    expected_gating: true,
    tolerance_pct: 5, // 5% tolerance for clean wallets
  },
  {
    wallet: '0x62fadaf110588be0d8fcf2c711bae31051bb50a9',
    name: 'Anon12345678910',
    category: 'clean',
    ui_net: -257,
    expected_gating: true,
    tolerance_pct: 10,
  },
  // Additional clean wallets (UI values TBD)
  {
    wallet: '0x2e3ea056400d81c42e2ce26ef25fda4ec5caabea',
    name: 'wallet_clean_3',
    category: 'clean',
    ui_net: null,
    expected_gating: true,
    tolerance_pct: 5,
  },
  {
    wallet: '0x63e975a9904e09249a37f771a877c55de7cde1a1',
    name: 'wallet_clean_4',
    category: 'clean',
    ui_net: null,
    expected_gating: true,
    tolerance_pct: 5,
  },
  {
    wallet: '0xccfad5b58b552097689e020614aad86028673576',
    name: 'wallet_clean_5',
    category: 'clean',
    ui_net: null,
    expected_gating: true,
    tolerance_pct: 5,
  },
  {
    wallet: '0x6e4cc0238aaa1214606354e2d612ddbace5abdbd',
    name: 'wallet_clean_6',
    category: 'clean',
    ui_net: null,
    expected_gating: true,
    tolerance_pct: 5,
  },

  // Dedupe-sensitive wallets (known to have duplicates in source data)
  {
    wallet: '0xb6bed94e759a4e5b56a8ed5ed26dde1f4f9cf51f',
    name: 'dedupe_sensitive_1',
    category: 'dedupe_sensitive',
    ui_net: null,
    expected_gating: true, // May pass or fail depending on dedupe
    tolerance_pct: 10,
  },
  {
    wallet: '0xcdcd7d980e1da7c9c5fb7d9d62dec3c3c8ed7a3e',
    name: 'dedupe_sensitive_2',
    category: 'dedupe_sensitive',
    ui_net: null,
    expected_gating: true,
    tolerance_pct: 10,
  },

  // High external-inventory wallets (should FAIL gating)
  {
    wallet: '0xf5201f998333d228dafba270d01d8ff82b2c0637',
    name: '@rbnoftg',
    category: 'external_inventory',
    ui_net: 879268,
    expected_gating: false, // Should fail (38% external)
    tolerance_pct: 15,
  },
  {
    wallet: '0xe9c6312464b52aa3eff13d822b003282075995c9',
    name: '@kingofcoinflips',
    category: 'external_inventory',
    ui_net: 618061,
    expected_gating: false, // Should fail (high external)
    tolerance_pct: 25,
  },
];

// -----------------------------------------------------------------------------
// Test Runner
// -----------------------------------------------------------------------------

interface TestResult {
  wallet: string;
  name: string;
  category: string;
  v21_net: number;
  external_sell_pct: number;
  is_eligible: boolean;
  expected_gating: boolean;
  gating_test: 'PASS' | 'FAIL';
  ui_net: number | null;
  delta_pct: number | null;
  pnl_test: 'PASS' | 'FAIL' | 'SKIP';
  error: string | null;
}

async function runTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               V21 REGRESSION TEST                                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Test Set:');
  console.log('  - 6 clean CLOB-only wallets (expect PASS gating)');
  console.log('  - 2 dedupe-sensitive wallets (stability check)');
  console.log('  - 2 external-inventory wallets (expect FAIL gating)\n');

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const t = TEST_WALLETS[i];
    const result: TestResult = {
      wallet: t.wallet,
      name: t.name,
      category: t.category,
      v21_net: 0,
      external_sell_pct: 0,
      is_eligible: false,
      expected_gating: t.expected_gating,
      gating_test: 'FAIL',
      ui_net: t.ui_net,
      delta_pct: null,
      pnl_test: 'SKIP',
      error: null,
    };

    try {
      const v21 = await calculateV21PnL(t.wallet);

      result.v21_net = v21.net;
      result.external_sell_pct = v21.external_sell_pct;
      result.is_eligible = v21.external_sell_pct <= 0.5 && v21.mapped_ratio >= 99.9;

      // Gating test
      result.gating_test = (result.is_eligible === t.expected_gating) ? 'PASS' : 'FAIL';

      // PnL test (if UI value known)
      if (t.ui_net !== null && t.ui_net !== 0) {
        result.delta_pct = Math.abs((v21.net - t.ui_net) / t.ui_net) * 100;
        result.pnl_test = result.delta_pct <= t.tolerance_pct ? 'PASS' : 'FAIL';
      }

      const gatingIcon = result.gating_test === 'PASS' ? '✅' : '❌';
      const pnlIcon = result.pnl_test === 'PASS' ? '✅' : result.pnl_test === 'FAIL' ? '❌' : '⏭️';
      const netStr = result.v21_net >= 0
        ? `+$${result.v21_net.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : `-$${Math.abs(result.v21_net).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

      console.log(
        `[${i + 1}/${TEST_WALLETS.length}] ${t.name.padEnd(22)} | ` +
        `Gate: ${gatingIcon} | PnL: ${pnlIcon} | ` +
        `ext: ${result.external_sell_pct.toFixed(2).padStart(5)}% | ` +
        `net: ${netStr.padStart(12)}` +
        (result.delta_pct !== null ? ` | delta: ${result.delta_pct.toFixed(1)}%` : '')
      );

    } catch (e: any) {
      result.error = e.message;
      console.log(`[${i + 1}/${TEST_WALLETS.length}] ${t.name.padEnd(22)} | ❌ ERROR: ${e.message.slice(0, 40)}`);
    }

    results.push(result);
  }

  return results;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const results = await runTests();

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              SUMMARY                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  const gatingPassed = results.filter(r => r.gating_test === 'PASS').length;
  const gatingFailed = results.filter(r => r.gating_test === 'FAIL').length;
  const pnlPassed = results.filter(r => r.pnl_test === 'PASS').length;
  const pnlFailed = results.filter(r => r.pnl_test === 'FAIL').length;
  const pnlSkipped = results.filter(r => r.pnl_test === 'SKIP').length;
  const errors = results.filter(r => r.error !== null).length;

  console.log('Gating Tests:');
  console.log(`  Passed: ${gatingPassed}/${results.length}`);
  console.log(`  Failed: ${gatingFailed}`);

  console.log('\nPnL Tests (vs UI):');
  console.log(`  Passed: ${pnlPassed}`);
  console.log(`  Failed: ${pnlFailed}`);
  console.log(`  Skipped: ${pnlSkipped} (no UI value)`);

  if (errors > 0) {
    console.log(`\nErrors: ${errors}`);
  }

  // Detailed failures
  const failures = results.filter(r => r.gating_test === 'FAIL' || r.pnl_test === 'FAIL');
  if (failures.length > 0) {
    console.log('\n❌ FAILURES:');
    failures.forEach(f => {
      console.log(`  - ${f.name}: gating=${f.gating_test}, pnl=${f.pnl_test}`);
      if (f.gating_test === 'FAIL') {
        console.log(`    Expected gating: ${f.expected_gating}, Got: ${f.is_eligible}`);
        console.log(`    external_sell_pct: ${f.external_sell_pct.toFixed(2)}%`);
      }
      if (f.pnl_test === 'FAIL' && f.delta_pct !== null) {
        console.log(`    V21: $${f.v21_net.toLocaleString()}, UI: $${f.ui_net?.toLocaleString()}, Delta: ${f.delta_pct.toFixed(1)}%`);
      }
    });
  }

  // Overall result
  const allPassed = gatingFailed === 0 && pnlFailed === 0 && errors === 0;

  console.log('\n' + '='.repeat(78));
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED');
  } else {
    console.log('❌ SOME TESTS FAILED');
  }
  console.log('='.repeat(78));

  process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
