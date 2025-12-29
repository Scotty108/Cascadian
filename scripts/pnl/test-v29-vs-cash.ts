/**
 * ============================================================================
 * V29 vs CASH FLOW VALIDATION SCRIPT
 * ============================================================================
 *
 * This script validates V29 UiParity PnL against simple cash-flow accounting
 * for SAFE_TRADER_STRICT wallets.
 *
 * For wallets with:
 * - No splits/merges (CTF events)
 * - No inventory mismatches
 * - No missing resolutions
 *
 * The V29 UiParity PnL should match cash flow within 2-3%.
 *
 * Cash flow formula:
 *   cash_pnl = sum(USDC inflows) - sum(USDC outflows)
 *            = redemptions + CLOB sells - CLOB buys
 *
 * Terminal: Claude 1
 * Date: 2025-12-06
 */

import * as fs from 'fs';
import * as path from 'path';
import { compareV29ToCashFlow } from '../../lib/pnl/inventoryEngineV29';

interface BenchmarkWallet {
  wallet: string;
  uiPnL: number;  // Note: Capital L in PnL
  tags?: {
    isTraderStrict?: boolean;
    isMixed?: boolean;
    isMakerHeavy?: boolean;
    isDataSuspect?: boolean;
    splitCount?: number;
    mergeCount?: number;
    inventoryMismatch?: number;
    missingResolutions?: number;
  };
  v29GuardUiParityPctError?: number;
}

interface RegressionSet {
  metadata: {
    benchmarkSet: string;
    runDate: string;
    walletCount: number;
  };
  results: BenchmarkWallet[];
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          V29 vs CASH FLOW VALIDATION (SAFE_TRADER_STRICT)         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Load the fresh_2025_12_06 regression set
  const benchmarkFile = path.join(
    __dirname,
    '../../tmp/regression-matrix-fresh_2025_12_06.json'
  );

  if (!fs.existsSync(benchmarkFile)) {
    console.error(`❌ Benchmark file not found: ${benchmarkFile}`);
    console.error('Please run: npx tsx scripts/pnl/run-regression-matrix.ts --set=fresh_2025_12_06');
    process.exit(1);
  }

  const data: RegressionSet = JSON.parse(fs.readFileSync(benchmarkFile, 'utf-8'));
  console.log(`📊 Loaded benchmark set: ${data.metadata.benchmarkSet}`);
  console.log(`📅 Captured at: ${data.metadata.runDate}`);
  console.log(`👛 Total wallets: ${data.results.length}\n`);

  // Filter for SAFE_TRADER_STRICT candidates
  const safeWallets = data.results.filter(w => {
    return (
      w.tags?.isTraderStrict === true &&
      (w.tags?.splitCount ?? 0) === 0 &&
      (w.tags?.mergeCount ?? 0) === 0 &&
      (w.tags?.inventoryMismatch ?? 0) === 0 &&
      (w.tags?.missingResolutions ?? 0) === 0
    );
  });

  console.log(`✅ SAFE_TRADER_STRICT candidates: ${safeWallets.length}\n`);

  if (safeWallets.length === 0) {
    console.error('❌ No SAFE_TRADER_STRICT wallets found in benchmark set.');
    process.exit(1);
  }

  console.log('Criteria for SAFE_TRADER_STRICT:');
  console.log('  - isTraderStrict = true');
  console.log('  - splitCount = 0');
  console.log('  - mergeCount = 0');
  console.log('  - inventoryMismatch = 0');
  console.log('  - missingResolutions = 0\n');

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════\n');

  const results: any[] = [];

  for (let i = 0; i < safeWallets.length; i++) {
    const w = safeWallets[i];
    console.log(`[${i + 1}/${safeWallets.length}] Wallet: ${w.wallet}`);

    try {
      const comparison = await compareV29ToCashFlow(w.wallet);

      const passesThreshold = Math.abs(comparison.deltaPct) < 3.0;
      const status = passesThreshold ? '✅ PASS' : '❌ FAIL';

      console.log(`  UI PnL:             $${w.uiPnL.toLocaleString()}`);
      console.log(`  Cash Flow PnL:      $${comparison.cashPnl.toLocaleString()}`);
      console.log(`  V29 UiParity:       $${comparison.v29UiParity.toLocaleString()}`);
      console.log(`  V29 Realized:       $${comparison.v29Realized.toLocaleString()}`);
      console.log(`  V29 Resolved Unred: $${comparison.v29ResolvedUnredeemed.toLocaleString()}`);
      console.log(`  Delta (abs):        $${comparison.deltaAbs.toLocaleString()}`);
      console.log(`  Delta (%):          ${comparison.deltaPct.toFixed(2)}%`);
      console.log(`  Status:             ${status}`);
      console.log('');

      results.push({
        wallet: w.wallet,
        uiPnl: w.uiPnL,
        cashPnl: comparison.cashPnl,
        v29UiParity: comparison.v29UiParity,
        v29Realized: comparison.v29Realized,
        v29ResolvedUnredeemed: comparison.v29ResolvedUnredeemed,
        deltaAbs: comparison.deltaAbs,
        deltaPct: comparison.deltaPct,
        passes: passesThreshold,
        cashFlowDetails: comparison.cashFlowDetails,
      });
    } catch (err: any) {
      console.log(`  ❌ ERROR: ${err.message}\n`);
      results.push({
        wallet: w.wallet,
        error: err.message,
      });
    }
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════\n');

  // Summary statistics
  const validResults = results.filter(r => !r.error);
  const passCount = validResults.filter(r => r.passes).length;
  const failCount = validResults.filter(r => !r.passes).length;

  const deltaPcts = validResults.map(r => Math.abs(r.deltaPct));
  const medianDeltaPct = deltaPcts.sort((a, b) => a - b)[Math.floor(deltaPcts.length / 2)] || 0;
  const avgDeltaPct = deltaPcts.reduce((sum, v) => sum + v, 0) / deltaPcts.length || 0;

  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                       SUMMARY STATISTICS                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Total SAFE_TRADER_STRICT wallets: ${safeWallets.length}`);
  console.log(`Valid results:                     ${validResults.length}`);
  console.log(`Errors:                            ${results.length - validResults.length}`);
  console.log(`PASS (<3% error):                  ${passCount} (${((passCount / validResults.length) * 100).toFixed(1)}%)`);
  console.log(`FAIL (≥3% error):                  ${failCount} (${((failCount / validResults.length) * 100).toFixed(1)}%)`);
  console.log(`Median |delta %|:                  ${medianDeltaPct.toFixed(2)}%`);
  console.log(`Average |delta %|:                 ${avgDeltaPct.toFixed(2)}%\n`);

  // Show worst performers
  const failedResults = validResults.filter(r => !r.passes).sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  if (failedResults.length > 0) {
    console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════\n');
    console.log('FAILED WALLETS (≥3% error, sorted by worst first):\n');

    for (const r of failedResults.slice(0, 10)) {
      console.log(`Wallet: ${r.wallet}`);
      console.log(`  Cash Flow:      $${r.cashPnl.toLocaleString()}`);
      console.log(`  V29 UiParity:   $${r.v29UiParity.toLocaleString()}`);
      console.log(`  Delta:          $${r.deltaAbs.toLocaleString()} (${r.deltaPct.toFixed(2)}%)`);
      console.log(`  V29 Realized:   $${r.v29Realized.toLocaleString()}`);
      console.log(`  V29 Resolved:   $${r.v29ResolvedUnredeemed.toLocaleString()}`);
      console.log('');
    }
  }

  // Save results to file
  const outputFile = path.join(__dirname, '../../tmp/v29-vs-cash-results.json');
  fs.writeFileSync(outputFile, JSON.stringify({
    benchmarkSet: data.metadata.benchmarkSet,
    capturedAt: data.metadata.runDate,
    runAt: new Date().toISOString(),
    summary: {
      totalWallets: safeWallets.length,
      validResults: validResults.length,
      errors: results.length - validResults.length,
      passCount,
      failCount,
      passRate: (passCount / validResults.length) * 100,
      medianDeltaPct,
      avgDeltaPct,
    },
    results,
  }, null, 2));

  console.log(`📄 Detailed results saved to: ${outputFile}\n`);

  // Exit code based on pass rate
  const passRate = (passCount / validResults.length) * 100;
  if (passRate < 80) {
    console.log('❌ FAIL: Pass rate below 80% threshold');
    process.exit(1);
  } else {
    console.log(`✅ SUCCESS: ${passRate.toFixed(1)}% pass rate`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
