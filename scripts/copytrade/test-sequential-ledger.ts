/**
 * Sequential Ledger P&L - Integration Test
 *
 * Phase 4: Validate against 3 known wallets
 *
 * Pass criteria:
 * - calibration = -$86 ± $5 (MUST match exactly)
 * - alexma11224 = positive sign
 * - winner1 = positive sign
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeSequentialLedgerPnl } from '@/lib/pnl/sequentialLedger';

interface TestWallet {
  address: string;
  name: string;
  targetPnl: number;
  tolerance: number; // Max allowed error in dollars
  requireSign: boolean; // If true, only sign must match
}

const TEST_WALLETS: TestWallet[] = [
  {
    address: '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e',
    name: 'calibration',
    targetPnl: -86,
    tolerance: 5, // Must be within $5
    requireSign: false,
  },
  {
    address: '0x0d0e73b88444c21094421447451e15e9c4f14049',
    name: 'alexma11224',
    targetPnl: 375,
    tolerance: Infinity, // Sign only
    requireSign: true,
  },
  {
    address: '0xfb328b94ed05115259bbc48ba8182df1416edb85',
    name: 'winner1',
    targetPnl: 25594,
    tolerance: Infinity, // Sign only
    requireSign: true,
  },
];

async function runTests() {
  console.log('=== SEQUENTIAL LEDGER P&L - INTEGRATION TEST ===\n');
  console.log('Deterministic engine with no heuristics.\n');
  console.log('Pass criteria:');
  console.log('  - calibration: -$86 ± $5');
  console.log('  - alexma11224: positive sign');
  console.log('  - winner1: positive sign\n');

  let passed = 0;
  let failed = 0;

  for (const wallet of TEST_WALLETS) {
    console.log(`--- ${wallet.name} ---`);
    console.log(`Target: $${wallet.targetPnl}`);

    try {
      const result = await computeSequentialLedgerPnl(wallet.address);

      console.log(`\nResults:`);
      console.log(`  Buys: $${result.buys.toFixed(2)}`);
      console.log(`  Sells: $${result.sells.toFixed(2)}`);
      console.log(`  Redemptions: $${result.redemptions.toFixed(2)}`);
      console.log(`  Merges: $${result.merges.toFixed(2)}`);
      console.log(`  Split Cost: $${result.splitCost.toFixed(2)} (${result.splitsInferred} inferred)`);
      console.log(`  Held Value: $${result.heldValue.toFixed(2)}`);
      console.log(`  ---`);
      console.log(`  Realized P&L: $${result.realizedPnl.toFixed(2)}`);
      console.log(`  Total P&L: $${result.totalPnl.toFixed(2)}`);
      console.log(`  ---`);
      console.log(`  Trades: ${result.trades}`);
      console.log(`  CTF Events: ${result.ctfEvents}`);
      console.log(`  Mapping: ${(result.mappingCoveragePct * 100).toFixed(1)}%`);
      console.log(`  Conditions: ${result.conditionsTraded}`);

      // Determine which P&L to use for comparison
      // Use realizedPnl for calibration (they've redeemed), totalPnl for others
      const pnlToCompare = wallet.name === 'calibration' ? result.realizedPnl : result.realizedPnl;

      // Check pass/fail
      const error = Math.abs(pnlToCompare - wallet.targetPnl);
      const signMatch = (pnlToCompare >= 0) === (wallet.targetPnl >= 0);

      let testPassed = false;
      if (wallet.requireSign) {
        testPassed = signMatch;
      } else {
        testPassed = error <= wallet.tolerance;
      }

      console.log(`\n  Target: $${wallet.targetPnl}`);
      console.log(`  Actual: $${pnlToCompare.toFixed(2)}`);
      console.log(`  Error: $${error.toFixed(2)}`);
      console.log(`  Sign Match: ${signMatch ? 'YES' : 'NO'}`);
      console.log(`  Result: ${testPassed ? '✅ PASS' : '❌ FAIL'}`);

      if (testPassed) {
        passed++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`  Error: ${err}`);
      failed++;
    }

    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`Passed: ${passed}/${TEST_WALLETS.length}`);
  console.log(`Failed: ${failed}/${TEST_WALLETS.length}`);

  if (failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED!');
    console.log('The sequential ledger is ready for batch validation.');
  } else {
    console.log('\n⚠️  Some tests failed. Review the results above.');
  }

  return failed === 0;
}

runTests()
  .then((success) => process.exit(success ? 0 : 1))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
