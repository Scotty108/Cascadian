/**
 * Check all TRADER_STRICT wallets (not just fully settled)
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
console.log('║          TRADER_STRICT COHORT ANALYSIS                            ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

const traderStrict = results.filter(w =>
  !w.timedOut &&
  w.tags.isTraderStrict === true &&
  w.tags.splitCount === 0 &&
  w.tags.mergeCount === 0 &&
  w.tags.inventoryMismatch === 0 &&
  w.tags.missingResolutions === 0
);

console.log(`📊 TRADER_STRICT wallets (clean, no splits/merges/issues): ${traderStrict.length}\n`);

// Categorize by position status
const fullySettled = traderStrict.filter(w =>
  Math.abs(w.v29GuardUnrealizedPnL || 0) < 1e-6 &&
  Math.abs(w.v29GuardResolvedUnredeemedValue || 0) < 1e-6
);

const hasUnredeemed = traderStrict.filter(w =>
  Math.abs(w.v29GuardResolvedUnredeemedValue || 0) >= 1e-6
);

const hasUnrealized = traderStrict.filter(w =>
  Math.abs(w.v29GuardUnrealizedPnL || 0) >= 1e-6
);

console.log(`   Fully settled (no open, no unredeemed):  ${fullySettled.length}`);
console.log(`   Has unredeemed resolved positions:        ${hasUnredeemed.length}`);
console.log(`   Has unrealized (open) positions:          ${hasUnrealized.length}\n`);

console.log('='.repeat(160));
console.log('ALL TRADER_STRICT WALLETS (CLEAN)');
console.log('='.repeat(160));
console.log(
  'Wallet'.padEnd(45) +
  'Status'.padEnd(20) +
  'UI PnL'.padEnd(15) +
  'V29 Realized'.padEnd(15) +
  'V29 Resolved'.padEnd(15) +
  'V29 Unrealized'.padEnd(15) +
  'V29 UiParity'.padEnd(15) +
  'Error %'
);
console.log('-'.repeat(160));

for (const w of traderStrict) {
  const status =
    Math.abs(w.v29GuardUnrealizedPnL || 0) < 1e-6 && Math.abs(w.v29GuardResolvedUnredeemedValue || 0) < 1e-6 ? 'FULLY_SETTLED' :
    Math.abs(w.v29GuardResolvedUnredeemedValue || 0) >= 1e-6 ? 'HAS_UNREDEEMED' :
    'HAS_OPEN';

  const errorStatus = Math.abs(w.v29GuardUiParityPctError * 100) < 1.0 ? '✅' :
                     Math.abs(w.v29GuardUiParityPctError * 100) < 3.0 ? '⚠️ ' : '❌';

  console.log(
    w.wallet.padEnd(45) +
    status.padEnd(20) +
    `$${w.uiPnL.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(15) +
    `$${w.v29GuardRealizedPnL.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(15) +
    `$${(w.v29GuardResolvedUnredeemedValue || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(15) +
    `$${(w.v29GuardUnrealizedPnL || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(15) +
    `$${w.v29GuardUiParityPnL.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padEnd(15) +
    `${errorStatus} ${(w.v29GuardUiParityPctError * 100).toFixed(2)}%`
  );
}

console.log('='.repeat(160));
console.log('\n✅ Analysis complete\n');
