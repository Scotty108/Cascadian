/**
 * Identify fully settled SAFE_TRADER_STRICT wallets
 * Uses pre-computed V29 results from regression matrix
 */

import * as fs from 'fs';

interface WalletResult {
  wallet: string;
  uiPnL: number;
  tags: {
    isTraderStrict: boolean;
    isMixed: boolean;
    isMakerHeavy: boolean;
    isDataSuspect: boolean;
    splitCount: number;
    mergeCount: number;
    clobCount: number;
    inventoryMismatch: number;
    missingResolutions: number;
  };
  v29GuardPnL: number;
  v29GuardRealizedPnL: number;
  v29GuardUiParityPnL: number;
  v29GuardResolvedUnredeemedValue: number;
  v29GuardUnrealizedPnL: number;
  v29GuardUiParityPctError: number;
  timedOut?: boolean;
}

const data = JSON.parse(fs.readFileSync('tmp/regression-matrix-fresh_2025_12_06.json', 'utf-8'));
const results = data.results as WalletResult[];

console.log('╔════════════════════════════════════════════════════════════════════╗');
console.log('║       FULLY SETTLED SAFE_TRADER_STRICT WALLET IDENTIFICATION      ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

console.log(`📊 Total wallets in regression set: ${results.length}\n`);

// Define fully settled criteria
const fullySettled = results.filter(w => {
  if (w.timedOut) return false;

  const isFullySettledSafeTraderStrict = (
    w.tags.isTraderStrict === true &&
    w.tags.splitCount === 0 &&
    w.tags.mergeCount === 0 &&
    w.tags.inventoryMismatch === 0 &&
    w.tags.missingResolutions === 0 &&
    Math.abs(w.v29GuardUnrealizedPnL || 0) < 1e-6 &&
    Math.abs(w.v29GuardResolvedUnredeemedValue || 0) < 1e-6
  );

  return isFullySettledSafeTraderStrict;
});

console.log(`✅ Found ${fullySettled.length} fully settled SAFE_TRADER_STRICT wallets`);

if (fullySettled.length === 0) {
  console.log('\n⚠️  No wallets meet the fully settled criteria.');
  console.log('All TRADER_STRICT wallets still have open or unredeemed positions.\n');
  process.exit(0);
}

// For fully settled wallets, we need to compute cash flow PnL
// Since we can't run the engine due to missing dependencies, we'll use a proxy:
// For fully settled wallets, V29 realized should equal cash flow (no unrealized, no unredeemed)
// So we can use V29 realized as a proxy for cash flow and compare to UI PnL

console.log('\n' + '='.repeat(160));
console.log('FULLY SETTLED SAFE_TRADER_STRICT WALLETS (V29 REALIZED SHOULD = CASH FLOW)');
console.log('='.repeat(160));
console.log(
  'Wallet'.padEnd(45) +
  'UI PnL'.padEnd(18) +
  'V29 Realized'.padEnd(18) +
  'V29 UiParity'.padEnd(18) +
  'V29 Unrealized'.padEnd(18) +
  'V29 Resolved'.padEnd(18) +
  'UI vs Realized %'
);
console.log('-'.repeat(160));

const withMetrics = fullySettled.map(w => {
  // For fully settled wallets:
  // - V29 realized should equal cash flow (all positions closed & redeemed)
  // - V29 unrealized should be ~0 (confirmed by filter)
  // - V29 resolved unredeemed should be ~0 (confirmed by filter)
  // Therefore: V29 realized ≈ UI PnL (if engine is correct)

  const uiVsRealized = w.uiPnL - w.v29GuardRealizedPnL;
  const uiVsRealizedPct = w.uiPnL !== 0 ? (uiVsRealized / Math.abs(w.uiPnL)) * 100 : 0;

  return {
    ...w,
    uiVsRealized,
    uiVsRealizedPct,
  };
});

// Sort by absolute error
const sorted = withMetrics.sort((a, b) => Math.abs(b.uiVsRealizedPct) - Math.abs(a.uiVsRealizedPct));

for (const w of sorted) {
  const errorStatus = Math.abs(w.uiVsRealizedPct) < 1.0 ? '✅' :
                     Math.abs(w.uiVsRealizedPct) < 3.0 ? '⚠️ ' : '❌';

  console.log(
    w.wallet.padEnd(45) +
    `$${w.uiPnL.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(18) +
    `$${w.v29GuardRealizedPnL.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(18) +
    `$${w.v29GuardUiParityPnL.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(18) +
    `$${(w.v29GuardUnrealizedPnL || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(18) +
    `$${(w.v29GuardResolvedUnredeemedValue || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(18) +
    `${errorStatus} ${w.uiVsRealizedPct.toFixed(2)}%`
  );
}

console.log('='.repeat(160));

// Summary statistics
const passRate1Pct = sorted.filter(w => Math.abs(w.uiVsRealizedPct) < 1.0).length;
const passRate3Pct = sorted.filter(w => Math.abs(w.uiVsRealizedPct) < 3.0).length;
const errors = sorted.map(w => Math.abs(w.uiVsRealizedPct));
const medianError = errors[Math.floor(errors.length / 2)] || 0;

console.log('\n📊 SUMMARY STATISTICS:');
console.log(`   Total fully settled wallets:     ${sorted.length}`);
console.log(`   Pass rate (<1% error):           ${passRate1Pct}/${sorted.length} (${((passRate1Pct / sorted.length) * 100).toFixed(1)}%)`);
console.log(`   Pass rate (<3% error):           ${passRate3Pct}/${sorted.length} (${((passRate3Pct / sorted.length) * 100).toFixed(1)}%)`);
console.log(`   Median error (UI vs Realized):   ${medianError.toFixed(2)}%`);

// Top 3 worst
const worst = sorted.slice(0, Math.min(3, sorted.length));
console.log('\n❌ TOP 3 WORST ERRORS (UI PnL vs V29 Realized):');
for (let i = 0; i < worst.length; i++) {
  const w = worst[i];
  console.log(`\n${i + 1}. ${w.wallet}`);
  console.log(`   UI PnL:            $${w.uiPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   V29 Realized:      $${w.v29GuardRealizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   V29 UiParity:      $${w.v29GuardUiParityPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   Error (UI - Real): $${w.uiVsRealized.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${w.uiVsRealizedPct.toFixed(2)}%)`);
  console.log(`   CLOB count:        ${w.tags.clobCount}`);
}

console.log('\n✅ Analysis complete\n');
