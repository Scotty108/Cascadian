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
  v29NoGuardPnL?: number;
  v29NoGuardUiParityPnL?: number;
  v29NoGuardUiParityPctError?: number;
  timedOut?: boolean;
  negativeInventoryPositions?: number;
  negativeInventoryPnlAdjustment?: number;
  rootCause?: string;
}

const results = data.results as WalletResult[];

// Derive wallet tag string from tags object
function getWalletTag(tags: WalletTags): string {
  if (tags.isTraderStrict) return "TRADER_STRICT";
  if (tags.isMakerHeavy) return "MAKER_HEAVY";
  if (tags.isMixed) return "MIXED";
  if (tags.isDataSuspect) return "DATA_SUSPECT";
  return "UNKNOWN";
}

console.log("=== ALL WALLETS ERROR DISTRIBUTION (V29 UiParity) ===\n");

// Sort by absolute v29GuardUiParityPctError
const sorted = results
  .filter(r => r.v29GuardUiParityPctError !== undefined && r.v29GuardUiParityPctError !== null && !r.timedOut)
  .sort((a, b) => Math.abs(b.v29GuardUiParityPctError) - Math.abs(a.v29GuardUiParityPctError));

console.log("Top 20 by absolute V29 UiParity % error:\n");
for (const w of sorted.slice(0, 20)) {
  const errPct = (w.v29GuardUiParityPctError * 100).toFixed(2);
  const delta = w.uiPnL - w.v29GuardUiParityPnL;
  const tag = getWalletTag(w.tags);
  console.log(`${w.wallet}`);
  console.log(`  Tag: ${tag} | UI: $${w.uiPnL.toFixed(2)} | V29 UiParity: $${w.v29GuardUiParityPnL.toFixed(2)} | Err: ${errPct}% | Delta: $${delta.toFixed(2)}`);
  console.log(`  V23c: $${w.v23cPnL.toFixed(2)} | Realized: $${w.v29GuardRealizedPnL.toFixed(2)} | Unrealized: $${w.v29GuardUnrealizedPnL?.toFixed(2) ?? 'N/A'} | ResolvedUnredeemed: $${w.v29GuardResolvedUnredeemedValue.toFixed(2)}`);
  console.log(`  Splits: ${w.tags.splitCount} | Merges: ${w.tags.mergeCount} | CLOB: ${w.tags.clobCount} | InvMismatch: ${w.tags.inventoryMismatch} | MissingRes: ${w.tags.missingResolutions}`);
  if (w.negativeInventoryPositions) {
    console.log(`  NegInvPositions: ${w.negativeInventoryPositions} | NegInvAdjustment: $${w.negativeInventoryPnlAdjustment?.toFixed(2)}`);
  }
  if (w.rootCause) {
    console.log(`  RootCause: ${w.rootCause}`);
  }
  console.log();
}

// Error buckets
const buckets: Record<string, number> = {
  "0-1%": 0,
  "1-2%": 0,
  "2-3%": 0,
  "3-5%": 0,
  "5-10%": 0,
  "10-20%": 0,
  "20-50%": 0,
  "50%+": 0
};

for (const w of sorted) {
  const err = Math.abs(w.v29GuardUiParityPctError) * 100;
  if (err < 1) buckets["0-1%"]++;
  else if (err < 2) buckets["1-2%"]++;
  else if (err < 3) buckets["2-3%"]++;
  else if (err < 5) buckets["3-5%"]++;
  else if (err < 10) buckets["5-10%"]++;
  else if (err < 20) buckets["10-20%"]++;
  else if (err < 50) buckets["20-50%"]++;
  else buckets["50%+"]++;
}

console.log("\n=== V29 UIPARITY ERROR DISTRIBUTION ===");
for (const [bucket, count] of Object.entries(buckets)) {
  console.log(`  ${bucket}: ${count} wallets`);
}

// Group by tag
const byTag: Record<string, WalletResult[]> = {};
for (const w of sorted) {
  const tag = getWalletTag(w.tags);
  if (!byTag[tag]) byTag[tag] = [];
  byTag[tag].push(w);
}

console.log("\n=== BY TAG (sorted by error within tag) ===");
for (const tag of Object.keys(byTag).sort()) {
  console.log(`\n--- ${tag} (${byTag[tag].length} wallets) ---`);
  for (const w of byTag[tag].slice(0, 10)) {
    const errPct = (w.v29GuardUiParityPctError * 100).toFixed(2);
    console.log(`  ${w.wallet.slice(0,12)}... | UI: $${w.uiPnL.toFixed(0)} | V29: $${w.v29GuardUiParityPnL.toFixed(0)} | Err: ${errPct}%`);
  }
}

// Show wallets with >5% error for deep investigation
console.log("\n\n=== WALLETS WITH >5% V29 UIPARITY ERROR (investigation candidates) ===\n");
const highError = sorted.filter(w => Math.abs(w.v29GuardUiParityPctError) > 0.05);
console.log(`Found ${highError.length} wallets with >5% error:`);
for (const w of highError) {
  const errPct = (w.v29GuardUiParityPctError * 100).toFixed(2);
  const delta = w.uiPnL - w.v29GuardUiParityPnL;
  const tag = getWalletTag(w.tags);
  console.log(`\n${w.wallet}`);
  console.log(`  Tag: ${tag}`);
  console.log(`  UI PnL: $${w.uiPnL.toFixed(2)}`);
  console.log(`  V29 UiParity: $${w.v29GuardUiParityPnL.toFixed(2)}`);
  console.log(`  V29 Realized: $${w.v29GuardRealizedPnL.toFixed(2)}`);
  console.log(`  V29 Unrealized: $${w.v29GuardUnrealizedPnL?.toFixed(2) ?? 'N/A'}`);
  console.log(`  V29 ResolvedUnredeemed: $${w.v29GuardResolvedUnredeemedValue.toFixed(2)}`);
  console.log(`  V23c PnL: $${w.v23cPnL.toFixed(2)}`);
  console.log(`  Error: ${errPct}%`);
  console.log(`  Delta (UI - V29): $${delta.toFixed(2)}`);
  console.log(`  Splits: ${w.tags.splitCount}, Merges: ${w.tags.mergeCount}, CLOB: ${w.tags.clobCount}`);
  console.log(`  RootCause: ${w.rootCause || 'N/A'}`);
}

// Show TRADER_STRICT wallets with ANY error for analysis
console.log("\n\n=== ALL TRADER_STRICT WALLETS (for SAFE_TRADER_STRICT analysis) ===\n");
const traderStrict = sorted.filter(w => w.tags.isTraderStrict);
for (const w of traderStrict) {
  const errPct = (w.v29GuardUiParityPctError * 100).toFixed(2);
  const delta = w.uiPnL - w.v29GuardUiParityPnL;
  const passSafe = Math.abs(w.v29GuardUiParityPctError) < 0.03 &&
                   w.tags.splitCount === 0 &&
                   w.tags.mergeCount === 0 &&
                   w.tags.inventoryMismatch === 0 &&
                   w.tags.missingResolutions === 0;
  console.log(`${w.wallet}`);
  console.log(`  UI: $${w.uiPnL.toFixed(2)} | V29: $${w.v29GuardUiParityPnL.toFixed(2)} | Err: ${errPct}% | Delta: $${delta.toFixed(2)}`);
  console.log(`  Splits: ${w.tags.splitCount} | Merges: ${w.tags.mergeCount} | InvMismatch: ${w.tags.inventoryMismatch} | MissingRes: ${w.tags.missingResolutions}`);
  console.log(`  SAFE_TRADER_STRICT candidate: ${passSafe ? 'YES' : 'NO'}`);
  console.log();
}
