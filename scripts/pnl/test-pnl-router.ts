/**
 * ============================================================================
 * TEST PNL ROUTER - Validate Production Router Across Cohorts
 * ============================================================================
 *
 * Tests the PnL router with representative wallets from each cohort:
 * - SAFE: TRADER_STRICT with low error
 * - MODERATE: MIXED with moderate error
 * - RISKY: MAKER_HEAVY
 * - SUSPECT: Data issues / timeouts
 *
 * Usage:
 *   npx tsx scripts/pnl/test-pnl-router.ts
 *
 * Terminal: Claude 1 (Main Terminal)
 * Date: 2025-12-06
 */

import { getWalletPnlDisplay, WalletPnlDisplay } from '../../lib/pnl/pnlRouter';

// ============================================================================
// Test Wallets (from HEAD_TO_HEAD_V23C_V29_2025_12_06.md)
// ============================================================================

// These wallets are selected from HEAD_TO_HEAD_V23C_V29_2025_12_06.md benchmark:
const TEST_WALLETS = [
  // SAFE candidates (TRADER_STRICT with V29 UiParity < 1% error)
  {
    wallet: '0x033a07b3de5947a4a87ba20f093cbe7e1f5d8e87',  // From benchmark: 0.04% error
    expectedCohort: 'SAFE' as const,
    uiBenchmarkPnL: 3115550.407,
    description: 'TRADER_STRICT - 0.04% error in benchmark',
  },
  {
    wallet: '0x863134d008dd3bcb93e6de43d62470af0d28c840',  // From benchmark: 0.07% error
    expectedCohort: 'SAFE' as const,
    uiBenchmarkPnL: 7532409.672,
    description: 'TRADER_STRICT - 0.07% error in benchmark',
  },

  // MODERATE (MIXED wallet with good accuracy)
  {
    wallet: '0x56687bf447cfa4ef08cf6e43c8ee3c2d4bc0c42e',  // From benchmark: MIXED, 4.0% error
    expectedCohort: 'MODERATE' as const,
    uiBenchmarkPnL: 22053933.752,
    description: 'MIXED wallet - 4.0% error in benchmark',
  },

  // RISKY (MAKER_HEAVY)
  {
    wallet: '0x1f2dd6d473db2dd99eb1da2cf66ef5f4c8c15813',  // From benchmark: MAKER_HEAVY
    expectedCohort: 'RISKY' as const,
    uiBenchmarkPnL: 16620027.6,
    description: 'MAKER_HEAVY - TRUE_COMPLEXITY in benchmark',
  },

  // SUSPECT (wallet that timed out in benchmark)
  {
    wallet: '0x9d84ce0306c37b2a02336ae1e93b65ae5e08beb8',  // From benchmark: TIMEOUT
    expectedCohort: 'SUSPECT' as const,
    uiBenchmarkPnL: 2446907.189,
    description: 'TIMEOUT - data issues in benchmark',
  },
];

// ============================================================================
// Test Runner
// ============================================================================

async function runTest(testCase: typeof TEST_WALLETS[0]): Promise<{
  passed: boolean;
  result: WalletPnlDisplay;
  details: string;
}> {
  const { wallet, expectedCohort, uiBenchmarkPnL, description } = testCase;

  try {
    const result = await getWalletPnlDisplay(wallet, {
      includeDebug: true,
      uiBenchmarkPnL,
    });

    const cohortMatch = result.cohort === expectedCohort;
    const details = cohortMatch
      ? `PASS: Got ${result.cohort} as expected`
      : `FAIL: Expected ${expectedCohort}, got ${result.cohort}`;

    return {
      passed: cohortMatch,
      result,
      details,
    };
  } catch (error: any) {
    return {
      passed: false,
      result: {
        wallet,
        canonicalEngine: 'V29_UIPARITY',
        cohort: 'SUSPECT',
        cohortReason: `ERROR: ${error.message}`,
        displayPnL: 0,
        displayLabel: 'Error',
        confidence: 0,
        shouldDisplay: false,
      },
      details: `ERROR: ${error.message}`,
    };
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('PNL ROUTER TEST SUITE');
  console.log('='.repeat(80));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Test wallets: ${TEST_WALLETS.length}`);
  console.log('');

  let passCount = 0;
  let failCount = 0;

  for (const testCase of TEST_WALLETS) {
    console.log('-'.repeat(80));
    console.log(`Testing: ${testCase.description}`);
    console.log(`Wallet: ${testCase.wallet}`);
    console.log(`Expected Cohort: ${testCase.expectedCohort}`);
    console.log(`UI Benchmark: $${testCase.uiBenchmarkPnL.toLocaleString()}`);
    console.log('');

    const { passed, result, details } = await runTest(testCase);

    if (passed) {
      passCount++;
      console.log(`  [PASS] ${details}`);
    } else {
      failCount++;
      console.log(`  [FAIL] ${details}`);
    }

    // Print result details
    console.log('');
    console.log('  Router Result:');
    console.log(`    canonicalEngine: ${result.canonicalEngine}`);
    console.log(`    cohort:          ${result.cohort}`);
    console.log(`    cohortReason:    ${result.cohortReason}`);
    console.log(`    displayPnL:      $${result.displayPnL.toLocaleString()}`);
    console.log(`    displayLabel:    ${result.displayLabel}`);
    console.log(`    confidence:      ${(result.confidence * 100).toFixed(0)}%`);
    console.log(`    shouldDisplay:   ${result.shouldDisplay}`);

    if (result.debug) {
      console.log('');
      console.log('  Debug Info:');
      console.log(`    uiPnL (V29):          $${result.debug.uiPnL.toLocaleString()}`);
      console.log(`    realizedPnL:          $${result.debug.realizedPnL.toLocaleString()}`);
      console.log(`    unrealizedPnL:        $${result.debug.unrealizedPnL.toLocaleString()}`);
      console.log(`    resolvedUnredeemed:   $${result.debug.resolvedUnredeemedValue.toLocaleString()}`);
      console.log(`    eventsProcessed:      ${result.debug.eventsProcessed}`);
      console.log('');
      console.log('  Data Health:');
      console.log(`    inventoryMismatch:    ${result.debug.dataHealth.inventoryMismatch}`);
      console.log(`    missingResolutions:   ${result.debug.dataHealth.missingResolutions}`);
      console.log(`    negativeInvPositions: ${result.debug.dataHealth.negativeInventoryPositions}`);
      console.log(`    clampedPositions:     ${result.debug.dataHealth.clampedPositions}`);

      if (result.debug.tags) {
        console.log('');
        console.log('  Tags:');
        console.log(`    isTraderStrict:       ${result.debug.tags.isTraderStrict}`);
        console.log(`    isMixed:              ${result.debug.tags.isMixed}`);
        console.log(`    isMakerHeavy:         ${result.debug.tags.isMakerHeavy}`);
        console.log(`    isDataSuspect:        ${result.debug.tags.isDataSuspect}`);
        console.log(`    splitCount:           ${result.debug.tags.splitCount}`);
        console.log(`    mergeCount:           ${result.debug.tags.mergeCount}`);
        console.log(`    clobCount:            ${result.debug.tags.clobCount}`);
      }
    }

    console.log('');
  }

  // Summary
  console.log('='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total:  ${TEST_WALLETS.length}`);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);
  console.log('');

  if (failCount > 0) {
    console.log('NOTE: Some cohort classifications may differ from expected due to:');
    console.log('  - Data health issues detected at runtime');
    console.log('  - Missing resolutions not present in benchmark');
    console.log('  - Inventory mismatches in live data');
    console.log('');
    console.log('Review the cohortReason field for details on each classification.');
  }

  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));

  // Exit with error code if tests failed
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
