#!/usr/bin/env npx tsx
/**
 * Assess multi-engine confidence on a wallet set
 *
 * Usage:
 *   npx tsx scripts/pnl/assess-engine-confidence.ts [input.json] [output.json]
 */

import fs from 'fs';
import {
  createConfidenceEngine,
  summarizeConfidence,
  ConfidenceResult,
} from '../../lib/pnl/engineConfidence';
import { isPassDome, DOME_THRESHOLDS } from '../../lib/pnl/validationThresholds';

async function main() {
  const input = process.argv[2] || 'tmp/clob_10_wallets.json';
  const output = process.argv[3] || 'tmp/confidence_assessment.json';

  console.log('\n================================================================================');
  console.log('MULTI-ENGINE CONFIDENCE ASSESSMENT');
  console.log('================================================================================\n');

  console.log(`Input: ${input}`);
  console.log(`Output: ${output}`);
  console.log(`Agreement threshold: ${6}%\n`);

  // Load wallet data
  const inputData = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const wallets = inputData.wallets || inputData;

  // Create engine
  const engine = createConfidenceEngine();

  // Assess all wallets
  console.log('Assessing wallets...\n');

  const walletAddresses = wallets.map((w: any) => w.wallet_address);
  const results = await engine.assessBatch(walletAddresses, (done, total) => {
    process.stdout.write(`\rProgress: ${done}/${total}`);
  });

  console.log('\n');

  // Create dome_realized lookup
  const domeMap = new Map<string, number>();
  for (const w of wallets) {
    domeMap.set(w.wallet_address.toLowerCase(), w.dome_realized);
  }

  // Print detailed results
  console.log('DETAILED RESULTS');
  console.log('='.repeat(120));
  console.log(
    'Wallet'.padEnd(14) +
      '| Dome'.padEnd(12) +
      '| Best Est'.padEnd(12) +
      '| Engine'.padEnd(8) +
      '| Conf'.padEnd(10) +
      '| Spread'.padEnd(10) +
      '| Pairs'.padEnd(8) +
      '| Pass'
  );
  console.log('-'.repeat(120));

  let passCount = 0;

  for (const r of results) {
    const dome = domeMap.get(r.wallet.toLowerCase()) || 0;
    const passResult = isPassDome(dome, r.bestEstimate);

    const shortWallet = r.wallet.slice(0, 10) + '...';
    const domeStr = `$${dome.toFixed(0)}`.padStart(10);
    const bestStr = `$${r.bestEstimate.toFixed(0)}`.padStart(10);
    const engineStr = r.selectedEngine.padEnd(6);
    const confStr = r.confidence.padEnd(8);
    const spreadStr = `${(r.maxSpread * 100).toFixed(1)}%`.padStart(8);
    const pairsStr = `${r.syntheticPairsCount}`.padStart(6);
    const passStr = passResult.passed ? '✓' : '✗';

    if (passResult.passed) passCount++;

    console.log(
      `${shortWallet} | ${domeStr} | ${bestStr} | ${engineStr} | ${confStr} | ${spreadStr} | ${pairsStr} | ${passStr}`
    );
  }

  // Summary
  const summary = summarizeConfidence(results);

  console.log('\n' + '='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));

  console.log(`\nConfidence Distribution:`);
  console.log(`  HIGH:     ${summary.byConfidence.HIGH} (${((summary.byConfidence.HIGH / summary.total) * 100).toFixed(0)}%)`);
  console.log(`  MEDIUM:   ${summary.byConfidence.MEDIUM} (${((summary.byConfidence.MEDIUM / summary.total) * 100).toFixed(0)}%)`);
  console.log(`  LOW:      ${summary.byConfidence.LOW} (${((summary.byConfidence.LOW / summary.total) * 100).toFixed(0)}%)`);
  console.log(`  FLAGGED:  ${summary.byConfidence.FLAGGED} (${((summary.byConfidence.FLAGGED / summary.total) * 100).toFixed(0)}%)`);

  console.log(`\nMetrics:`);
  console.log(`  Average spread: ${(summary.avgSpread * 100).toFixed(1)}%`);
  console.log(`  Overcorrection risk: ${summary.overcorrectionCount} wallets`);
  console.log(`  Pass rate (best estimate vs Dome): ${passCount}/${results.length} (${((passCount / results.length) * 100).toFixed(0)}%)`);

  // Save results
  const outputData = {
    metadata: {
      generated_at: new Date().toISOString(),
      input_file: input,
      total_wallets: results.length,
      agreement_threshold: 0.06,
    },
    summary,
    passRate: passCount / results.length,
    results: results.map((r) => ({
      ...r,
      dome_realized: domeMap.get(r.wallet.toLowerCase()),
      passed: isPassDome(domeMap.get(r.wallet.toLowerCase()) || 0, r.bestEstimate).passed,
    })),
  };

  fs.writeFileSync(output, JSON.stringify(outputData, null, 2));
  console.log(`\nResults saved to: ${output}`);
}

main().catch(console.error);
