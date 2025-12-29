#!/usr/bin/env npx tsx
/**
 * Compare V11 vs V11b on the benchmark set
 */

import fs from 'fs';
import { createV11Engine } from '../../lib/pnl/uiActivityEngineV11';
import { createV11bEngine } from '../../lib/pnl/uiActivityEngineV11b';
import { isPassDome, DOME_THRESHOLDS } from '../../lib/pnl/validationThresholds';

async function main() {
  const input = process.argv[2] || 'tmp/clob_10_wallets.json';

  console.log(`\nComparing V11 vs V11b on ${input}\n`);
  console.log('='.repeat(80));
  console.log(`Pass threshold: ${DOME_THRESHOLDS.pctThreshold}% (large), $${DOME_THRESHOLDS.absThreshold} (small)\n`);

  const inputData = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const wallets = inputData.wallets;

  const v11 = createV11Engine();
  const v11b = createV11bEngine();

  let v11Passes = 0;
  let v11bPasses = 0;

  console.log('Wallet            | Dome       | V11        | V11b       | Pairs | Improvement');
  console.log('-'.repeat(85));

  for (const w of wallets) {
    const walletAddr = w.wallet_address;
    const domeRealized = w.dome_realized;

    // Compute both
    const v11Result = await v11.compute(walletAddr);
    const v11bResult = await v11b.compute(walletAddr);

    const v11Pass = isPassDome(domeRealized, v11Result.realized_pnl);
    const v11bPass = isPassDome(domeRealized, v11bResult.realized_pnl);

    if (v11Pass.passed) v11Passes++;
    if (v11bPass.passed) v11bPasses++;

    const improvement = v11bResult.realized_pnl - v11Result.realized_pnl;
    const improvesSign = (Math.sign(improvement) === Math.sign(domeRealized - v11Result.realized_pnl));

    const shortWallet = walletAddr.slice(0, 10) + '...';
    const dome = `$${domeRealized.toFixed(0)}`.padStart(10);
    const v11Str = `${v11Pass.passed ? '✓' : '✗'}$${v11Result.realized_pnl.toFixed(0)}`.padStart(10);
    const v11bStr = `${v11bPass.passed ? '✓' : '✗'}$${v11bResult.realized_pnl.toFixed(0)}`.padStart(10);
    const pairs = `${v11bResult.syntheticPairsDetected}`.padStart(5);
    const impStr = `${improvesSign ? '→' : '←'}$${Math.abs(improvement).toFixed(0)}`.padStart(11);

    console.log(`${shortWallet}  | ${dome} | ${v11Str} | ${v11bStr} | ${pairs} | ${impStr}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nV11  passes: ${v11Passes}/${wallets.length} (${(v11Passes/wallets.length*100).toFixed(0)}%)`);
  console.log(`V11b passes: ${v11bPasses}/${wallets.length} (${(v11bPasses/wallets.length*100).toFixed(0)}%)`);
  console.log(`\nImprovement: ${v11bPasses - v11Passes} more passes`);
}

main().catch(console.error);
