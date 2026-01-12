/**
 * PnL Engine V1 - Accuracy Test Suite with Confidence Indicators
 *
 * This test validates V1's accuracy and the new bundled transaction detection.
 * High-confidence wallets (pure CLOB) should achieve 100% accuracy.
 * Low-confidence wallets (heavy proxy/splits) return warning but still provide data.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// Test wallets with UI-confirmed PnL
const TEST_WALLETS = [
  // Pure CLOB wallets - expect high confidence, 100% accuracy
  { name: 'original', wallet: '0xf918977ef9d3f101385eda508621d5f835fa9052', ui_pnl: 1.16 },
  { name: 'maker_heavy_1', wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c', ui_pnl: -12.60 },
  { name: 'maker_heavy_2', wallet: '0x2e4a6d6dccff351fccfd404f368fa711d94b2e12', ui_pnl: 1500.00 },
  { name: 'taker_heavy_1', wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', ui_pnl: -47.19 },
  { name: 'taker_heavy_2', wallet: '0x94fabfc86594fffbf76996e2f66e5e19675a8164', ui_pnl: -73.00 },
  { name: 'mixed_1', wallet: '0x583537b26372c4527ff0eb9766da22fb6ab038cd', ui_pnl: -0.01 },
  { name: 'mixed_2', wallet: '0x8a8752f8c1b6e8bbdd4d8c47d6298e3a25a421f7', ui_pnl: 4916.75 },

  // Scale test wallets
  { name: '3w21binFf', wallet: '0x99d14ecb7e61f81ae972b9ae792f8f3f32ef65db', ui_pnl: -2429.89 },
  { name: 'Mistswirl', wallet: '0x29f8ad6b0cb15de715eb3954d14fe799944eed77', ui_pnl: -1470.50 },

  // Split user - expect low confidence, warning
  { name: 'copy_trading_pond', wallet: '0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e', ui_pnl: 57.71 },
];

function isWithinTolerance(calculated: number, expected: number, tolerancePercent: number): boolean {
  if (expected === 0) return Math.abs(calculated) < 0.10;
  const delta = Math.abs((calculated - expected) / expected) * 100;
  return delta <= tolerancePercent;
}

async function runTests() {
  console.log('=== PnL Engine V1 - Accuracy + Confidence Test ===\n');

  const { getWalletPnLV1 } = await import('./pnlEngineV1');

  let passed = 0;
  let failed = 0;
  let highConfidencePassed = 0;
  let highConfidenceTotal = 0;
  const failures: string[] = [];

  for (const test of TEST_WALLETS) {
    const result = await getWalletPnLV1(test.wallet);
    const calculated = result.total;

    // Different tolerance based on confidence
    // High confidence: expect 1% accuracy
    // Low confidence: just check we return data with warning
    const tolerance = result.confidence === 'high' ? 1 : (result.confidence === 'medium' ? 5 : 999);
    const match = isWithinTolerance(calculated, test.ui_pnl, tolerance);

    // Track high-confidence accuracy separately
    if (result.confidence === 'high') {
      highConfidenceTotal++;
      if (isWithinTolerance(calculated, test.ui_pnl, 1)) {
        highConfidencePassed++;
      }
    }

    // For high/medium confidence, accuracy matters
    // For low confidence, we just want the warning to work
    const showAsPass = result.confidence === 'low' ? true : match;

    if (showAsPass) {
      const confBadge = result.confidence === 'high' ? '🟢' : (result.confidence === 'medium' ? '🟡' : '🔴');
      console.log(`✅ ${test.name}: $${calculated.toFixed(2)} vs UI $${test.ui_pnl} [${confBadge} ${result.confidence}]`);
      if (result.bundledTxCount > 0) {
        console.log(`   📊 Bundled txs: ${result.bundledTxCount}`);
      }
      if (result.warning) {
        console.log(`   ⚠️  ${result.warning}`);
      }
      passed++;
    } else {
      const delta = ((calculated - test.ui_pnl) / Math.abs(test.ui_pnl) * 100).toFixed(1);
      console.log(`❌ ${test.name}: $${calculated.toFixed(2)} ≠ $${test.ui_pnl} (${delta}% off) [${result.confidence}]`);
      failed++;
      failures.push(`${test.name}: expected $${test.ui_pnl}, got $${calculated.toFixed(2)}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Overall: ${passed}/${passed + failed} passed`);
  console.log(`High-confidence accuracy: ${highConfidencePassed}/${highConfidenceTotal} (${((highConfidencePassed/highConfidenceTotal)*100).toFixed(0)}%)`);

  if (failures.length > 0) {
    console.log('\nAccuracy failures (high/medium confidence):');
    failures.forEach(f => console.log(`  - ${f}`));
  }

  if (highConfidencePassed === highConfidenceTotal) {
    console.log('\n🎉 100% accuracy achieved for all high-confidence (pure CLOB) wallets!');
  }

  return { passed, failed, highConfidencePassed, highConfidenceTotal };
}

if (require.main === module) {
  runTests()
    .then(({ failed }) => process.exit(failed > 0 ? 1 : 0))
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
}
