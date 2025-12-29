#!/usr/bin/env npx tsx
/**
 * Test V11b on a single wallet to compare with V11 and Dome
 */

import { V11Engine, createV11Engine } from '../../lib/pnl/uiActivityEngineV11';
import { V11bEngine, createV11bEngine } from '../../lib/pnl/uiActivityEngineV11b';

async function main() {
  const wallet = process.argv[2] || '0x569e2cb3cc89b7afb28f79a262aae30da6cb4175';
  const domeRealized = 50557.88; // Known Dome value

  console.log(`Testing wallet: ${wallet}\n`);
  console.log(`Dome Realized: $${domeRealized.toFixed(2)}\n`);

  // Test V11
  console.log('Computing V11...');
  const v11 = createV11Engine();
  const v11Result = await v11.compute(wallet);
  console.log(`V11 Realized PnL: $${v11Result.realized_pnl.toFixed(2)}`);
  console.log(`V11 Error vs Dome: ${((Math.abs(v11Result.realized_pnl - domeRealized) / Math.abs(domeRealized)) * 100).toFixed(1)}%\n`);

  // Test V11b
  console.log('Computing V11b...');
  const v11b = createV11bEngine();
  const v11bResult = await v11b.compute(wallet);
  console.log(`V11b Realized PnL: $${v11bResult.realized_pnl.toFixed(2)}`);
  console.log(`V11b Synthetic Pairs Detected: ${v11bResult.syntheticPairsDetected}`);
  console.log(`V11b Cost Basis Adjustment: $${v11bResult.costBasisAdjustment.toFixed(2)}`);
  console.log(`V11b Error vs Dome: ${((Math.abs(v11bResult.realized_pnl - domeRealized) / Math.abs(domeRealized)) * 100).toFixed(1)}%\n`);

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Dome:  $${domeRealized.toFixed(2)}`);
  console.log(`V11:   $${v11Result.realized_pnl.toFixed(2)} (error: ${((Math.abs(v11Result.realized_pnl - domeRealized) / Math.abs(domeRealized)) * 100).toFixed(1)}%)`);
  console.log(`V11b:  $${v11bResult.realized_pnl.toFixed(2)} (error: ${((Math.abs(v11bResult.realized_pnl - domeRealized) / Math.abs(domeRealized)) * 100).toFixed(1)}%)`);
  console.log(`\nV11b improvement: $${(v11bResult.realized_pnl - v11Result.realized_pnl).toFixed(2)}`);
}

main().catch(console.error);
