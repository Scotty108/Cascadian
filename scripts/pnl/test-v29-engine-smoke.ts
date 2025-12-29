/**
 * V29 ENGINE SMOKE TEST
 *
 * Purpose: Verify that the V29 engine compiles and runs without crashing.
 * This is NOT a correctness test - just a sanity check that:
 *   1. The code compiles
 *   2. The function runs without throwing
 *   3. We can call it from the CLI
 *
 * Usage:
 *   npx tsx scripts/pnl/test-v29-engine-smoke.ts
 */

import { getV29CanonicalPnL, V29CanonicalPnL, calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';
import { getWalletPnlDisplay } from '../../lib/pnl/pnlRouter';
import * as fs from 'fs';

// Test wallets from the safe_trader_strict file
const TEST_WALLETS = [
  '0x033a07b3de5947eab4306676ad74eb546da30d50',
  '0x78b9ac44a6d7d7a076c14e0ad518b301b63c6b76',
  '0x01ba0d81daad6ae2fedf19c7c76c5a70b tried8bf', // Intentionally broken to test error handling
];

// Try to load wallets from file if it exists
function loadWalletsFromFile(): string[] {
  const filePath = './tmp/safe_trader_strict_v2_wallets.json';
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (data.wallets && Array.isArray(data.wallets)) {
        return data.wallets.slice(0, 5).map((w: any) => w.wallet);
      }
    }
  } catch (e) {
    // Ignore errors, use default wallets
  }
  return TEST_WALLETS.slice(0, 3);
}

async function runSmokeTest() {
  console.log('='.repeat(60));
  console.log('V29 ENGINE SMOKE TEST');
  console.log('='.repeat(60));
  console.log('');

  const wallets = loadWalletsFromFile();
  console.log(`Testing ${wallets.length} wallets...`);
  console.log('');

  // Test 1: Direct V29 engine call (calculateV29PnL)
  console.log('TEST 1: Direct V29 Engine (calculateV29PnL)');
  console.log('-'.repeat(60));

  for (const wallet of wallets) {
    try {
      const start = Date.now();
      const result = await calculateV29PnL(wallet, { inventoryGuard: true });
      const duration = Date.now() - start;

      console.log(`  ${wallet.slice(0, 10)}... | ${duration}ms`);
      console.log(`    realizedPnl: ${result.realizedPnl.toLocaleString()}`);
      console.log(`    unrealizedPnl: ${result.unrealizedPnl.toLocaleString()}`);
      console.log(`    resolvedUnredeemedValue: ${result.resolvedUnredeemedValue.toLocaleString()}`);
      console.log(`    uiParityPnl: ${result.uiParityPnl.toLocaleString()}`);
      console.log(`    eventsProcessed: ${result.eventsProcessed}`);
      console.log('');
    } catch (err: any) {
      console.log(`  ${wallet.slice(0, 10)}... | ERROR: ${err.message}`);
      console.log('');
    }
  }

  // Test 2: Canonical API (getV29CanonicalPnL)
  console.log('');
  console.log('TEST 2: Canonical API (getV29CanonicalPnL)');
  console.log('-'.repeat(60));

  const testWallet = wallets[0];
  try {
    const start = Date.now();
    const canonical = await getV29CanonicalPnL(testWallet);
    const duration = Date.now() - start;

    console.log(`  Wallet: ${testWallet.slice(0, 20)}...`);
    console.log(`  Duration: ${duration}ms`);
    console.log(`  uiPnL: ${canonical.uiPnL.toLocaleString()}`);
    console.log(`  realizedPnL: ${canonical.realizedPnL.toLocaleString()}`);
    console.log(`  unrealizedPnL: ${canonical.unrealizedPnL.toLocaleString()}`);
    console.log(`  resolvedUnredeemedValue: ${canonical.resolvedUnredeemedValue.toLocaleString()}`);
    console.log(`  dataHealth:`);
    console.log(`    inventoryMismatch: ${canonical.dataHealth.inventoryMismatch}`);
    console.log(`    negativeInventoryPositions: ${canonical.dataHealth.negativeInventoryPositions}`);
    console.log(`  eventsProcessed: ${canonical.eventsProcessed}`);
    console.log(`  errors: ${canonical.errors.length}`);
  } catch (err: any) {
    console.log(`  ERROR: ${err.message}`);
  }

  // Test 3: Router integration (getWalletPnlDisplay)
  console.log('');
  console.log('TEST 3: Router Integration (getWalletPnlDisplay)');
  console.log('-'.repeat(60));

  try {
    const start = Date.now();
    const display = await getWalletPnlDisplay(testWallet, { includeDebug: true });
    const duration = Date.now() - start;

    console.log(`  Wallet: ${display.wallet.slice(0, 20)}...`);
    console.log(`  Duration: ${duration}ms`);
    console.log(`  canonicalEngine: ${display.canonicalEngine}`);
    console.log(`  cohort: ${display.cohort}`);
    console.log(`  cohortReason: ${display.cohortReason}`);
    console.log(`  displayPnL: ${display.displayPnL.toLocaleString()}`);
    console.log(`  displayLabel: ${display.displayLabel}`);
    console.log(`  confidence: ${display.confidence}`);
    console.log(`  shouldDisplay: ${display.shouldDisplay}`);
    if (display.debug) {
      console.log(`  debug.eventsProcessed: ${display.debug.eventsProcessed}`);
    }
  } catch (err: any) {
    console.log(`  ERROR: ${err.message}`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('SMOKE TEST COMPLETE');
  console.log('='.repeat(60));
}

// Run the test
runSmokeTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FATAL ERROR:', err);
    process.exit(1);
  });
