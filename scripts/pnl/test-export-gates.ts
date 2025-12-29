/**
 * Test export gates on golden wallets
 * Validates that clean wallets pass and dirty wallets fail
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { computePolymarketPnl, EXPORT_GATES } from '../../lib/pnl/polymarketAccurateEngine';

const GOLDEN_WALLETS = [
  { name: '@cozyfnf', address: '0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd', uiPnl: 1409524 },
  { name: '@amused85', address: '0x8fe70c889ce14f67acea5d597e3d0351d73b4f20', uiPnl: -3405 },
  { name: '@antman', address: '0x42592084120b0d5287059919d2a96b3b7acb936f', uiPnl: 416895 },
  { name: 'wasianiverson', address: '0xb744f56635b537e859152d14b022af5afe485210', uiPnl: 2860257 },
  { name: '0xafEe', address: '0xee50a31c3f5a7c77824b12a941a54388a2827ed6', uiPnl: 1254597 },
  { name: 'gmpm', address: '0x14964aefa2cd7caff7878b3820a690a03c5aa429', uiPnl: 1217031 },
];

async function main() {
  console.log('=== EXPORT GATE VALIDATION ===\n');
  console.log('Export Gate Thresholds:');
  console.log(`  maxSkippedSells: ${EXPORT_GATES.maxSkippedSells}`);
  console.log(`  maxSkippedSellsRatio: ${(EXPORT_GATES.maxSkippedSellsRatio * 100).toFixed(0)}%`);
  console.log(`  maxClampedTokensRatio: ${(EXPORT_GATES.maxClampedTokensRatio * 100).toFixed(0)}%`);
  console.log(`  minConfidenceScore: ${EXPORT_GATES.minConfidenceScore}`);
  console.log('');

  const results: Array<{
    name: string;
    exportEligible: boolean;
    exportReasons: string[];
    confidenceLevel: string;
    confidenceScore: number;
    skippedSells: number;
    skippedRatio: number;
    clampedRatio: number;
    deltaVsUi: number;
    totalPnl: number;
    uiPnl: number;
  }> = [];

  for (const wallet of GOLDEN_WALLETS) {
    console.log(`Processing ${wallet.name}...`);

    try {
      const result = await computePolymarketPnl(wallet.address);

      const skippedRatio = result.tradeCount > 0
        ? result.skippedSells / result.tradeCount
        : 0;
      const clampedRatio = (result.metadata?.totalClobTokens as number) > 0
        ? result.clampedTokens / (result.metadata?.totalClobTokens as number)
        : 0;

      const delta = wallet.uiPnl !== 0
        ? ((result.totalPnl - wallet.uiPnl) / Math.abs(wallet.uiPnl)) * 100
        : 0;

      results.push({
        name: wallet.name,
        exportEligible: result.exportGrade?.eligible ?? false,
        exportReasons: result.exportGrade?.reasons ?? [],
        confidenceLevel: result.confidence?.level ?? 'N/A',
        confidenceScore: result.confidence?.score ?? 0,
        skippedSells: result.skippedSells,
        skippedRatio,
        clampedRatio,
        deltaVsUi: delta,
        totalPnl: result.totalPnl,
        uiPnl: wallet.uiPnl,
      });
    } catch (error) {
      console.log(`  Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      results.push({
        name: wallet.name,
        exportEligible: false,
        exportReasons: ['Error during computation'],
        confidenceLevel: 'ERROR',
        confidenceScore: 0,
        skippedSells: 0,
        skippedRatio: 0,
        clampedRatio: 0,
        deltaVsUi: 0,
        totalPnl: 0,
        uiPnl: wallet.uiPnl,
      });
    }
  }

  console.log('\n' + '='.repeat(120));
  console.log('RESULTS:');
  console.log('='.repeat(120));
  console.log('');

  // Header
  console.log(
    'Wallet'.padEnd(20) +
    'Export'.padEnd(10) +
    'Conf'.padEnd(10) +
    'Score'.padEnd(8) +
    'Skipped'.padEnd(12) +
    'SkipRatio'.padEnd(12) +
    'ClampRatio'.padEnd(12) +
    'Delta vs UI'.padEnd(14) +
    'Engine PnL'.padEnd(15) +
    'UI PnL'
  );
  console.log('-'.repeat(120));

  for (const r of results) {
    const exportStatus = r.exportEligible ? '✅ PASS' : '❌ FAIL';
    const deltaStr = r.deltaVsUi.toFixed(1) + '%';

    console.log(
      r.name.padEnd(20) +
      exportStatus.padEnd(10) +
      r.confidenceLevel.padEnd(10) +
      String(r.confidenceScore).padEnd(8) +
      r.skippedSells.toLocaleString().padEnd(12) +
      (r.skippedRatio * 100).toFixed(1).padStart(6) + '%'.padEnd(5) +
      (r.clampedRatio * 100).toFixed(1).padStart(6) + '%'.padEnd(5) +
      deltaStr.padStart(10).padEnd(14) +
      ('$' + r.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })).padEnd(15) +
      '$' + r.uiPnl.toLocaleString()
    );
  }

  console.log('-'.repeat(120));
  console.log('');

  // Export gate failure reasons
  console.log('EXPORT GATE FAILURE DETAILS:');
  console.log('-'.repeat(80));
  for (const r of results.filter(r => !r.exportEligible)) {
    console.log(`${r.name}:`);
    for (const reason of r.exportReasons) {
      console.log(`  - ${reason}`);
    }
    console.log('');
  }

  // Analysis
  const exportEligible = results.filter(r => r.exportEligible);
  const exportEligibleAccurate = exportEligible.filter(r => Math.abs(r.deltaVsUi) <= 15);

  console.log('SUMMARY:');
  console.log('-'.repeat(80));
  console.log(`Export-eligible wallets: ${exportEligible.length}/${results.length}`);
  console.log(`Export-eligible AND within ±15% of UI: ${exportEligibleAccurate.length}/${exportEligible.length}`);

  if (exportEligible.length > 0) {
    const avgDelta = exportEligible.reduce((sum, r) => sum + Math.abs(r.deltaVsUi), 0) / exportEligible.length;
    console.log(`Average absolute delta for export-eligible: ${avgDelta.toFixed(1)}%`);
  }

  console.log('');
  console.log('Done.');
  process.exit(0);
}

main().catch(console.error);
