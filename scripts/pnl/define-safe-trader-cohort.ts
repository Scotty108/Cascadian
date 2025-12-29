import { readFileSync, writeFileSync } from 'fs';

const REGRESSION_FILE = 'tmp/regression-matrix-fresh_2025_12_06.json';

interface WalletResult {
  wallet: string;
  uiPnL: number;
  tags: {
    isTraderStrict: boolean;
    splitCount: number;
    mergeCount: number;
    inventoryMismatch: number;
    missingResolutions: number;
  };
  v29GuardUnrealizedPnL: number;
  v29GuardResolvedUnredeemedValue: number;
  v29GuardRealizedPnL: number;
  v29GuardUiParityPnL: number;
  cashPnl?: number; // Optional, as it's not in the original regression file
  isFullySettledSafeTraderStrict?: boolean;
}

function main() {
  const regressionData = JSON.parse(readFileSync(REGRESSION_FILE, 'utf-8'));
  const results: WalletResult[] = regressionData.results;

  const fullySettledWallets: WalletResult[] = [];

  for (const result of results) {
    const isFullySettledSafeTraderStrict =
      result.tags.isTraderStrict &&
      result.tags.splitCount === 0 &&
      result.tags.mergeCount === 0 &&
      result.tags.inventoryMismatch === 0 &&
      result.tags.missingResolutions === 0 &&
      Math.abs(result.v29GuardUnrealizedPnL) < 0.01 &&
      Math.abs(result.v29GuardResolvedUnredeemedValue) < 0.01;

    result.isFullySettledSafeTraderStrict = isFullySettledSafeTraderStrict;

    if (isFullySettledSafeTraderStrict) {
      fullySettledWallets.push(result);
    }
  }

  console.log('Fully Settled SAFE_TRADER_STRICT Wallets:');
  console.log('Wallet                                      | Cash Flow PnL | v29 Realized PnL | v29 UI Parity PnL | v29 Resolved Unredeemed | Error vs Cash Flow');
  console.log('--------------------------------------------|---------------|------------------|-------------------|-------------------------|--------------------');

  for (const wallet of fullySettledWallets) {
    const errorVsCashFlow = wallet.cashPnl ? wallet.v29GuardRealizedPnL - wallet.cashPnl : 'N/A';
    console.log(
      `${wallet.wallet} | ${wallet.cashPnl?.toFixed(2) ?? 'N/A'}         | ${wallet.v29GuardRealizedPnL.toFixed(2)}            | ${wallet.v29GuardUiParityPnL.toFixed(2)}           | ${wallet.v29GuardResolvedUnredeemedValue.toFixed(2)}                   | ${errorVsCashFlow}`
    );
  }

  // Choose wallets for further analysis
  const closeMatch = fullySettledWallets.find(w => w.cashPnl && Math.abs(w.v29GuardRealizedPnL - w.cashPnl) < 0.02 * Math.abs(w.cashPnl));
  const badMatches = fullySettledWallets.filter(w => w.cashPnl && Math.abs(w.v29GuardRealizedPnL - w.cashPnl) > 0.1 * Math.abs(w.cashPnl));

  console.log('\nWallets to investigate:');
  if (closeMatch) {
    console.log(`- Close match: ${closeMatch.wallet}`);
  } else {
    console.log('- No close match found');
  }
  if (badMatches.length > 0) {
    console.log(`- Bad match 1: ${badMatches[0].wallet}`);
  }
  if (badMatches.length > 1) {
    console.log(`- Bad match 2: ${badMatches[1].wallet}`);
  }
}

main();
