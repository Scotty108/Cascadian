/**
 * Test the rebuilt V29 engine
 *
 * Compares V28 vs V29 for a single wallet to verify:
 * - V29 runs without errors
 * - realizedPnl calculation is correct
 * - resolvedUnredeemedValue is computed
 * - uiParityPnl = realizedPnl + resolvedUnredeemedValue
 */

import { calculateV28PnL } from '../../lib/pnl/inventoryEngineV28';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';

async function testV29Rebuild() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                   V29 REBUILD VERIFICATION TEST                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Use the GOOD wallet from earlier analysis (fully settled)
  const goodWallet = '0xe9ad918c1b0f001d7e4d296d35732796f6eb1ae9';

  // Use the BAD wallet (has redemptions and inflation issues)
  const badWallet = '0x7fb7ad0db6cc7d12fc9766ba6f0f9d83fdc5bbe2';

  for (const wallet of [goodWallet, badWallet]) {
    console.log(`\n${'='.repeat(120)}`);
    console.log(`WALLET: ${wallet}`);
    console.log('='.repeat(120));

    try {
      // Run V28
      console.log('\n📊 Running V28...');
      const v28Start = Date.now();
      const v28Result = await calculateV28PnL(wallet);
      const v28Time = Date.now() - v28Start;

      console.log(`V28 Results (${v28Time}ms):`);
      console.log(`  Realized PnL:        $${v28Result.realizedPnl.toLocaleString()}`);
      console.log(`  Unrealized PnL:      $${v28Result.unrealizedPnl.toLocaleString()}`);
      console.log(`  Total PnL:           $${v28Result.totalPnl.toLocaleString()}`);
      console.log(`  Events Processed:    ${v28Result.eventsProcessed.toLocaleString()}`);
      console.log(`  Open Positions:      ${v28Result.openPositions}`);
      console.log(`  Closed Positions:    ${v28Result.closedPositions}`);

      // Run V29
      console.log('\n📊 Running V29...');
      const v29Start = Date.now();
      const v29Result = await calculateV29PnL(wallet, { inventoryGuard: true });
      const v29Time = Date.now() - v29Start;

      console.log(`V29 Results (${v29Time}ms):`);
      console.log(`  Realized PnL:                 $${v29Result.realizedPnl.toLocaleString()}`);
      console.log(`  Unrealized PnL:               $${v29Result.unrealizedPnl.toLocaleString()}`);
      console.log(`  Resolved Unredeemed Value:    $${v29Result.resolvedUnredeemedValue.toLocaleString()}`);
      console.log(`  UI Parity PnL:                $${v29Result.uiParityPnl.toLocaleString()}`);
      console.log(`  UI Parity Clamped:            $${v29Result.uiParityClampedPnl.toLocaleString()}`);
      console.log(`  Total PnL:                    $${v29Result.totalPnl.toLocaleString()}`);
      console.log(`  Events Processed:             ${v29Result.eventsProcessed.toLocaleString()}`);
      console.log(`  Open Positions:               ${v29Result.openPositions}`);
      console.log(`  Closed Positions:             ${v29Result.closedPositions}`);
      console.log(`  Resolved Unredeemed Positions: ${v29Result.resolvedUnredeemedPositions}`);
      console.log(`  Negative Inventory Positions: ${v29Result.negativeInventoryPositions}`);

      // Comparison
      console.log('\n🔍 V28 vs V29 Comparison:');
      const realizedDiff = v29Result.realizedPnl - v28Result.realizedPnl;
      const unrealizedDiff = v29Result.unrealizedPnl - v28Result.unrealizedPnl;
      const totalDiff = v29Result.totalPnl - v28Result.totalPnl;

      console.log(`  Realized PnL Δ:      $${realizedDiff.toLocaleString()} (${realizedDiff === 0 ? '✅ MATCH' : '⚠️  DIFF'})`);
      console.log(`  Unrealized PnL Δ:    $${unrealizedDiff.toLocaleString()} (${Math.abs(unrealizedDiff) < 1 ? '✅ MATCH' : '⚠️  DIFF'})`);
      console.log(`  Total PnL Δ:         $${totalDiff.toLocaleString()} (${Math.abs(totalDiff) < 1 ? '✅ MATCH' : '⚠️  DIFF'})`);

      // V29 internal consistency check
      console.log('\n✅ V29 Internal Consistency:');
      const calculatedUiParity = v29Result.realizedPnl + v29Result.resolvedUnredeemedValue;
      const uiParityMatch = Math.abs(calculatedUiParity - v29Result.uiParityPnl) < 0.01;
      console.log(`  realizedPnl + resolvedUnredeemedValue = $${calculatedUiParity.toLocaleString()}`);
      console.log(`  uiParityPnl                            = $${v29Result.uiParityPnl.toLocaleString()}`);
      console.log(`  ${uiParityMatch ? '✅' : '❌'} Formula check: ${uiParityMatch ? 'PASS' : 'FAIL'}`);

      const calculatedTotal = v29Result.realizedPnl + v29Result.unrealizedPnl + v29Result.resolvedUnredeemedValue;
      const totalMatch = Math.abs(calculatedTotal - v29Result.totalPnl) < 0.01;
      console.log(`\n  realized + unrealized + resolvedUnredeemed = $${calculatedTotal.toLocaleString()}`);
      console.log(`  totalPnl                                    = $${v29Result.totalPnl.toLocaleString()}`);
      console.log(`  ${totalMatch ? '✅' : '❌'} Formula check: ${totalMatch ? 'PASS' : 'FAIL'}`);

      if (v29Result.errors.length > 0) {
        console.log('\n❌ V29 Errors:');
        v29Result.errors.forEach((err, i) => {
          console.log(`  ${i + 1}. ${err}`);
        });
      }

    } catch (err: any) {
      console.log(`\n❌ ERROR: ${err.message}`);
      console.log(err.stack);
    }
  }

  console.log('\n' + '='.repeat(120));
  console.log('TEST COMPLETE');
  console.log('='.repeat(120));
}

testV29Rebuild().catch(console.error);
