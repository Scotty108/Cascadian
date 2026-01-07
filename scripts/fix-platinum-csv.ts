/**
 * Fix platinum wallets CSV by properly merging original data with new mean columns
 * The original CSV has quoted fields with commas that need to be preserved
 */
import * as fs from "fs";

const ORIGINAL_CSV = "/Users/scotty/Downloads/Our Copytrading List - Platinum Wallets-2.csv";
const TRUE_MEAN_CSV = "/Users/scotty/Projects/Cascadian-app/platinum_wallets_with_true_mean.csv";
const OUTPUT_CSV = "/Users/scotty/Projects/Cascadian-app/platinum_wallets_final_fixed.csv";

// Parse CSV handling quoted fields properly
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && !inQuotes) {
      inQuotes = true;
      current += char; // Keep the quote
    } else if (char === '"' && inQuotes) {
      inQuotes = false;
      current += char; // Keep the quote
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

// Strip quotes from a field for value extraction
function stripQuotes(val: string): string {
  if (val.startsWith('"') && val.endsWith('"')) {
    return val.slice(1, -1);
  }
  return val;
}

async function main() {
  // Read original CSV (with proper quoting)
  const originalContent = fs.readFileSync(ORIGINAL_CSV, "utf-8");
  const originalLines = originalContent.split(/\r?\n/).filter((l) => l.trim());

  // Read true mean CSV to extract the NEW computed values
  const trueMeanContent = fs.readFileSync(TRUE_MEAN_CSV, "utf-8");
  const trueMeanLines = trueMeanContent.split(/\r?\n/).filter((l) => l.trim());

  console.log("Original lines:", originalLines.length);
  console.log("True mean lines:", trueMeanLines.length);

  // Parse headers
  const origHeader = parseCSVLine(originalLines[0]);
  const meanHeader = parseCSVLine(trueMeanLines[0]);

  console.log("Original columns:", origHeader.length);
  console.log("Mean columns:", meanHeader.length);

  // Find indices in true mean file for the new columns we need to extract
  // These should be at the END of the file (columns 44-47, 0-indexed 43-46)
  // But due to column shifting, we need to find them by counting from the end
  // The LAST 4 values in each row should be: mean_win, mean_loss, last_trade_date, num_trades

  // Build wallet -> new values map from true mean file
  // Since columns are shifted, extract the LAST 4 values which should be our new columns
  const walletNewValues = new Map<string, { mean_win: string; mean_loss: string; last_trade_date: string; num_trades: string }>();

  for (let i = 1; i < trueMeanLines.length; i++) {
    const fields = parseCSVLine(trueMeanLines[i]);
    const wallet = stripQuotes(fields[0]).toLowerCase();

    // Get last 4 fields (these are our new columns regardless of earlier shifting)
    const numTrades = stripQuotes(fields[fields.length - 1]);
    const lastTradeDate = stripQuotes(fields[fields.length - 2]);
    const meanLoss = stripQuotes(fields[fields.length - 3]);
    const meanWin = stripQuotes(fields[fields.length - 4]);

    walletNewValues.set(wallet, {
      mean_win: meanWin,
      mean_loss: meanLoss,
      last_trade_date: lastTradeDate,
      num_trades: numTrades,
    });
  }

  console.log("Extracted new values for", walletNewValues.size, "wallets");

  // Sample a few to verify
  let sample = 0;
  for (const [wallet, vals] of walletNewValues) {
    if (sample < 3) {
      console.log(`  ${wallet.slice(0, 12)}... | mean_win: ${vals.mean_win} | mean_loss: ${vals.mean_loss} | last_trade: ${vals.last_trade_date} | trades: ${vals.num_trades}`);
      sample++;
    }
  }

  // Build new CSV with original data + new columns
  const newHeader = origHeader.join(",") + ",mean_win,mean_loss,last_trade_date,num_trades";
  const outputLines: string[] = [newHeader];

  let matched = 0;
  let unmatched = 0;

  for (let i = 1; i < originalLines.length; i++) {
    const origLine = originalLines[i];
    const fields = parseCSVLine(origLine);
    const wallet = stripQuotes(fields[0]).toLowerCase();

    const newVals = walletNewValues.get(wallet);
    if (newVals) {
      // Append new values to original line (preserving original quoting)
      outputLines.push(`${origLine},${newVals.mean_win},${newVals.mean_loss},${newVals.last_trade_date},${newVals.num_trades}`);
      matched++;
    } else {
      // No match - append empty values
      outputLines.push(`${origLine},,,,`);
      unmatched++;
    }
  }

  console.log("Matched:", matched, "Unmatched:", unmatched);

  // Write output
  fs.writeFileSync(OUTPUT_CSV, outputLines.join("\n"));
  console.log("\nOutput written to:", OUTPUT_CSV);
  console.log("Total rows:", outputLines.length, "(including header)");

  // Verify output
  const verifyContent = fs.readFileSync(OUTPUT_CSV, "utf-8");
  const verifyLines = verifyContent.split(/\r?\n/).filter((l) => l.trim());
  const verifyHeader = parseCSVLine(verifyLines[0]);
  console.log("\nVerification:");
  console.log("  Output columns:", verifyHeader.length);
  console.log("  Last 4 columns:", verifyHeader.slice(-4).join(", "));

  // Check first 3 data rows
  console.log("\nSample output:");
  for (let i = 1; i <= 3; i++) {
    const fields = parseCSVLine(verifyLines[i]);
    const wallet = stripQuotes(fields[0]);
    const meanWin = stripQuotes(fields[fields.length - 4]);
    const meanLoss = stripQuotes(fields[fields.length - 3]);
    const lastTrade = stripQuotes(fields[fields.length - 2]);
    const numTrades = stripQuotes(fields[fields.length - 1]);
    console.log(`  ${wallet.slice(0, 12)}... | mean_win: ${meanWin} | mean_loss: ${meanLoss} | last_trade: ${lastTrade} | trades: ${numTrades}`);
  }
}

main().catch(console.error);
