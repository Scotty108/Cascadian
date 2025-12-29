#!/usr/bin/env npx tsx
/**
 * Compare V11 vs V11b vs V11c on the benchmark set
 */

import fs from 'fs';
import { createV11Engine } from '../../lib/pnl/uiActivityEngineV11';
import { createV11bEngine } from '../../lib/pnl/uiActivityEngineV11b';
import { createV11cEngine } from '../../lib/pnl/uiActivityEngineV11c';
import { isPassDome, DOME_THRESHOLDS } from '../../lib/pnl/validationThresholds';

async function main() {
  const input = process.argv[2] || 'tmp/clob_10_wallets.json';

  console.log(`\nComparing V11 variants on ${input}\n`);
  console.log('='.repeat(100));
  console.log(`Pass threshold: ${DOME_THRESHOLDS.pctThreshold}% (large), $${DOME_THRESHOLDS.absThreshold} (small)\n`);

  const inputData = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const wallets = inputData.wallets;

  const v11 = createV11Engine();
  const v11b = createV11bEngine();
  const v11c = createV11cEngine();

  let v11Passes = 0;
  let v11bPasses = 0;
  let v11cPasses = 0;

  console.log('Wallet            | Dome       | V11        | V11b       | V11c       | Pairs');
  console.log('-'.repeat(100));

  for (const w of wallets) {
    const walletAddr = w.wallet_address;
    const domeRealized = w.dome_realized;

    // Compute all three
    const v11Result = await v11.compute(walletAddr);
    const v11bResult = await v11b.compute(walletAddr);
    const v11cResult = await v11c.compute(walletAddr);

    const v11Pass = isPassDome(domeRealized, v11Result.realized_pnl);
    const v11bPass = isPassDome(domeRealized, v11bResult.realized_pnl);
    const v11cPass = isPassDome(domeRealized, v11cResult.realized_pnl);

    if (v11Pass.passed) v11Passes++;
    if (v11bPass.passed) v11bPasses++;
    if (v11cPass.passed) v11cPasses++;

    const shortWallet = walletAddr.slice(0, 10) + '...';
    const dome = `$${domeRealized.toFixed(0)}`.padStart(10);
    const v11Str = `${v11Pass.passed ? '✓' : '✗'}$${v11Result.realized_pnl.toFixed(0)}`.padStart(10);
    const v11bStr = `${v11bPass.passed ? '✓' : '✗'}$${v11bResult.realized_pnl.toFixed(0)}`.padStart(10);
    const v11cStr = `${v11cPass.passed ? '✓' : '✗'}$${v11cResult.realized_pnl.toFixed(0)}`.padStart(10);
    const pairs = `${v11cResult.syntheticPairsDetected}`.padStart(5);

    console.log(`${shortWallet}  | ${dome} | ${v11Str} | ${v11bStr} | ${v11cStr} | ${pairs}`);
  }

  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log(`\nV11  passes: ${v11Passes}/${wallets.length} (${(v11Passes/wallets.length*100).toFixed(0)}%)`);
  console.log(`V11b passes: ${v11bPasses}/${wallets.length} (${(v11bPasses/wallets.length*100).toFixed(0)}%) - unbounded synthetic pairs`);
  console.log(`V11c passes: ${v11cPasses}/${wallets.length} (${(v11cPasses/wallets.length*100).toFixed(0)}%) - bounded synthetic pairs`);
  console.log(`\nV11c vs V11: ${v11cPasses - v11Passes > 0 ? '+' : ''}${v11cPasses - v11Passes} passes`);
  console.log(`V11c vs V11b: ${v11cPasses - v11bPasses > 0 ? '+' : ''}${v11cPasses - v11bPasses} passes`);
}

main().catch(console.error);
