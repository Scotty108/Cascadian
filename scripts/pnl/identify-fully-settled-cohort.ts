/**
 * Identify fully settled SAFE_TRADER_STRICT wallets
 *
 * A wallet is "fully settled" if:
 * - TRADER_STRICT (no splits/merges/inventory issues)
 * - No unrealized PnL (all positions closed)
 * - No resolved unredeemed value (all winnings redeemed)
 *
 * For these wallets, V29 realizedPnl should match cash flow PnL exactly.
 */

import * as fs from 'fs';
import * as path from 'path';
import { computeCashFlowPnl, calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';

interface BenchmarkWallet {
  wallet: string;
  uiPnL: number;
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
  v29GuardUnrealizedPnL?: number;
  v29GuardResolvedUnredeemedValue?: number;
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
  console.log('║       FULLY SETTLED SAFE_TRADER_STRICT WALLET IDENTIFICATION      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Load regression matrix
  const benchmarkFile = path.join(__dirname, '../../tmp/regression-matrix-fresh_2025_12_06.json');
  if (!fs.existsSync(benchmarkFile)) {
    console.error(`❌ Benchmark file not found: ${benchmarkFile}`);
    process.exit(1);
  }

  const data: RegressionSet = JSON.parse(fs.readFileSync(benchmarkFile, 'utf-8'));
  console.log(`📊 Benchmark set: ${data.metadata.benchmarkSet}`);
  console.log(`📅 Run date: ${data.metadata.runDate}`);
  console.log(`👛 Total wallets: ${data.results.length}\n`);

  // Define fully settled SAFE_TRADER_STRICT criteria
  const fullySettledWallets = data.results.filter(w => {
    const isFullySettledSafeTraderStrict = (
      w.tags?.isTraderStrict === true &&
      (w.tags?.splitCount ?? 0) === 0 &&
      (w.tags?.mergeCount ?? 0) === 0 &&
      (w.tags?.inventoryMismatch ?? 0) === 0 &&
      (w.tags?.missingResolutions ?? 0) === 0 &&
      Math.abs(w.v29GuardUnrealizedPnL || 0) < 1e-6 &&
      Math.abs(w.v29GuardResolvedUnredeemedValue || 0) < 1e-6
    );
    return isFullySettledSafeTraderStrict;
  });

  console.log(`✅ Found ${fullySettledWallets.length} fully settled SAFE_TRADER_STRICT wallets\n`);

  if (fullySettledWallets.length === 0) {
    console.log('⚠️  No wallets meet the fully settled criteria.');
    console.log('This means all TRADER_STRICT wallets still have open or unredeemed positions.\n');
    return;
  }

  // Compute cash flow PnL for each
  console.log('Computing cash flow PnL and V29 metrics...\n');

  const results = [];
  for (let i = 0; i < fullySettledWallets.length; i++) {
    const w = fullySettledWallets[i];
    console.log(`[${i + 1}/${fullySettledWallets.length}] Processing ${w.wallet}...`);

    try {
      const [cashFlow, v29Result] = await Promise.all([
        computeCashFlowPnl(w.wallet),
        calculateV29PnL(w.wallet),
      ]);

      const errorVsCash = v29Result.realizedPnl - cashFlow.cashPnl;
      const errorPct = cashFlow.cashPnl !== 0
        ? (errorVsCash / Math.abs(cashFlow.cashPnl)) * 100
        : 0;

      results.push({
        wallet: w.wallet,
        tags: 'TRADER_STRICT',
        cashPnl: cashFlow.cashPnl,
        v29Realized: v29Result.realizedPnl,
        v29UiParity: v29Result.uiParityPnl,
        v29ResolvedUnredeemed: v29Result.resolvedUnredeemedValue,
        v29Unrealized: v29Result.unrealizedPnl,
        errorVsCash: errorVsCash,
        errorPct: errorPct,
        cashFlowEvents: cashFlow.eventsProcessed,
      });
    } catch (err) {
      console.error(`  ❌ Error processing wallet: ${err}`);
    }
  }

  // Print results table
  console.log('\n' + '='.repeat(150));
  console.log('FULLY SETTLED SAFE_TRADER_STRICT WALLETS');
  console.log('='.repeat(150));
  console.log(
    'Wallet'.padEnd(45) +
    'Tags'.padEnd(15) +
    'Cash PnL'.padEnd(15) +
    'V29 Realized'.padEnd(15) +
    'V29 UiParity'.padEnd(15) +
    'V29 Resolved'.padEnd(15) +
    'Error vs Cash'.padEnd(15) +
    'Error %'
  );
  console.log('-'.repeat(150));

  for (const r of results) {
    const errorStatus = Math.abs(r.errorPct) < 1.0 ? '✅' : Math.abs(r.errorPct) < 3.0 ? '⚠️ ' : '❌';
    console.log(
      r.wallet.padEnd(45) +
      r.tags.padEnd(15) +
      `$${r.cashPnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(15) +
      `$${r.v29Realized.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(15) +
      `$${r.v29UiParity.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(15) +
      `$${r.v29ResolvedUnredeemed.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(15) +
      `$${r.errorVsCash.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(15) +
      `${errorStatus} ${r.errorPct.toFixed(2)}%`
    );
  }
  console.log('='.repeat(150));

  // Summary stats
  const passRate1Pct = results.filter(r => Math.abs(r.errorPct) < 1.0).length;
  const passRate3Pct = results.filter(r => Math.abs(r.errorPct) < 3.0).length;
  const errors = results.map(r => Math.abs(r.errorPct)).sort((a, b) => a - b);
  const medianError = errors[Math.floor(errors.length / 2)] || 0;

  console.log('\n📊 SUMMARY STATISTICS:');
  console.log(`   Total fully settled wallets: ${results.length}`);
  console.log(`   Pass rate (<1% error):       ${passRate1Pct}/${results.length} (${((passRate1Pct / results.length) * 100).toFixed(1)}%)`);
  console.log(`   Pass rate (<3% error):       ${passRate3Pct}/${results.length} (${((passRate3Pct / results.length) * 100).toFixed(1)}%)`);
  console.log(`   Median error:                ${medianError.toFixed(2)}%`);

  // Worst errors
  const worst = [...results].sort((a, b) => Math.abs(b.errorPct) - Math.abs(a.errorPct)).slice(0, 3);
  console.log('\n❌ TOP 3 WORST ERRORS:');
  for (let i = 0; i < worst.length; i++) {
    const w = worst[i];
    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   Cash PnL:         $${w.cashPnl.toLocaleString()}`);
    console.log(`   V29 Realized:     $${w.v29Realized.toLocaleString()}`);
    console.log(`   V29 UiParity:     $${w.v29UiParity.toLocaleString()}`);
    console.log(`   Error vs Cash:    $${w.errorVsCash.toLocaleString()} (${w.errorPct.toFixed(2)}%)`);
  }

  console.log('\n✅ Analysis complete\n');
}

main().catch(console.error);
