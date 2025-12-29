import * as fs from "fs";

const data = JSON.parse(fs.readFileSync("tmp/regression-matrix-fresh_2025_12_06.json", "utf-8"));

interface WalletTags {
  isTraderStrict: boolean;
  isMixed: boolean;
  isMakerHeavy: boolean;
  isDataSuspect: boolean;
  splitCount: number;
  mergeCount: number;
  clobCount: number;
  inventoryMismatch: number;
  missingResolutions: number;
}

interface WalletResult {
  wallet: string;
  uiPnL: number;
  tags: WalletTags;
  v23cPnL: number;
  v23cPctError: number;
  v29GuardPnL: number;
  v29GuardRealizedPnL: number;
  v29GuardUiParityPnL: number;
  v29GuardUiParityClampedPnL: number;
  v29GuardResolvedUnredeemedValue: number;
  v29GuardUnrealizedPnL: number;
  v29GuardError: number;
  v29GuardPctError: number;
  v29GuardUiParityError: number;
  v29GuardUiParityPctError: number;
  timedOut?: boolean;
  negativeInventoryPositions?: number;
  negativeInventoryPnlAdjustment?: number;
}

const results = data.results as WalletResult[];

// SAFE_TRADER_STRICT rule: no splits, merges, inventory mismatches, or missing resolutions
const safeTraderStrict = results.filter(r =>
  r.tags.isTraderStrict === true &&
  r.tags.splitCount === 0 &&
  r.tags.mergeCount === 0 &&
  r.tags.inventoryMismatch === 0 &&
  r.tags.missingResolutions === 0 &&
  !r.timedOut &&
  r.v29GuardUiParityPctError !== undefined &&
  r.v29GuardUiParityPctError !== null
);

console.log(`\n=== SAFE_TRADER_STRICT EXTRACTION ===`);
console.log(`Total wallets in dataset: ${results.length}`);
console.log(`TRADER_STRICT wallets: ${results.filter(r => r.tags.isTraderStrict).length}`);
console.log(`SAFE_TRADER_STRICT wallets (strict subset): ${safeTraderStrict.length}\n`);

// Create output structure
const output = safeTraderStrict.map(w => ({
  wallet: w.wallet,
  uiPnL: w.uiPnL,
  v29UiParityPnL: w.v29GuardUiParityPnL,
  v29RealizedPnL: w.v29GuardRealizedPnL,
  v29UnrealizedPnL: w.v29GuardUnrealizedPnL,
  v29ResolvedUnredeemed: w.v29GuardResolvedUnredeemedValue,
  v29UiParityError: w.v29GuardUiParityError,
  v29UiParityPctError: w.v29GuardUiParityPctError,
  v23cPnL: w.v23cPnL,
  tags: {
    isTraderStrict: w.tags.isTraderStrict,
    splitCount: w.tags.splitCount,
    mergeCount: w.tags.mergeCount,
    clobCount: w.tags.clobCount,
    inventoryMismatch: w.tags.inventoryMismatch,
    missingResolutions: w.tags.missingResolutions
  }
}));

// Sort by absolute percent error descending
output.sort((a, b) => Math.abs(b.v29UiParityPctError) - Math.abs(a.v29UiParityPctError));

// Save to file
fs.writeFileSync(
  "tmp/safe_trader_strict_wallets_2025_12_06.json",
  JSON.stringify(output, null, 2)
);

console.log("✅ Written to: tmp/safe_trader_strict_wallets_2025_12_06.json\n");

// Print summary table
console.log("Top 10 SAFE_TRADER_STRICT wallets by absolute error:\n");
console.log("Wallet                                      UI PnL      V29 UiParity    Error %    Delta");
console.log("─".repeat(100));

for (const w of output.slice(0, 10)) {
  const errPct = (w.v29UiParityPctError * 100).toFixed(2);
  const delta = w.uiPnL - w.v29UiParityPnL;
  console.log(
    `${w.wallet}  ${w.uiPnL.toFixed(2).padStart(10)}  ${w.v29UiParityPnL.toFixed(2).padStart(14)}  ${errPct.padStart(8)}%  ${delta.toFixed(2).padStart(10)}`
  );
}

console.log("\nError distribution:");
const buckets = {
  "0-1%": 0,
  "1-2%": 0,
  "2-3%": 0,
  "3-5%": 0,
  "5-10%": 0,
  "10%+": 0
};

for (const w of output) {
  const err = Math.abs(w.v29UiParityPctError) * 100;
  if (err < 1) buckets["0-1%"]++;
  else if (err < 2) buckets["1-2%"]++;
  else if (err < 3) buckets["2-3%"]++;
  else if (err < 5) buckets["3-5%"]++;
  else if (err < 10) buckets["5-10%"]++;
  else buckets["10%+"]++;
}

for (const [bucket, count] of Object.entries(buckets)) {
  const pct = ((count / output.length) * 100).toFixed(1);
  console.log(`  ${bucket}: ${count} wallets (${pct}%)`);
}

console.log(`\nMedian error: ${(output[Math.floor(output.length / 2)]?.v29UiParityPctError * 100 || 0).toFixed(2)}%`);
console.log(`Mean error: ${((output.reduce((sum, w) => sum + Math.abs(w.v29UiParityPctError), 0) / output.length) * 100).toFixed(2)}%\n`);
