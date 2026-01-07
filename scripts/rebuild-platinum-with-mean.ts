/**
 * Rebuild platinum wallets CSV with true mean values
 * 1. Read original CSV (with proper quoting)
 * 2. For each wallet, compute true mean_win and mean_loss using CCR-v1
 * 3. Write new CSV preserving all original data with proper quoting
 */
import * as fs from "fs";
import { computeCCRv1 } from "../lib/pnl/ccrEngineV1";

const ORIGINAL_CSV = "/Users/scotty/Downloads/Our Copytrading List - Platinum Wallets-2.csv";
const OUTPUT_CSV = "/Users/scotty/Projects/Cascadian-app/platinum_wallets_with_true_mean_fixed.csv";

// Parse CSV handling quoted fields properly
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && !inQuotes) {
      inQuotes = true;
      current += char;
    } else if (char === '"' && inQuotes) {
      inQuotes = false;
      current += char;
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

function stripQuotes(val: string): string {
  if (val.startsWith('"') && val.endsWith('"')) {
    return val.slice(1, -1);
  }
  return val;
}

// Compute true mean from position returns
function computeMeans(positionReturns: number[]): { meanWin: number; meanLoss: number } {
  const wins = positionReturns.filter((r) => r > 0);
  const losses = positionReturns.filter((r) => r < 0);

  const meanWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const meanLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  return { meanWin, meanLoss };
}

async function main() {
  console.log("Reading original CSV...");
  const originalContent = fs.readFileSync(ORIGINAL_CSV, "utf-8");
  const originalLines = originalContent.split(/\r?\n/).filter((l) => l.trim());

  console.log("Found", originalLines.length, "lines");

  const header = parseCSVLine(originalLines[0]);
  console.log("Original columns:", header.length);

  // Add new header columns
  const newHeader = originalLines[0] + ",mean_win,mean_loss,last_trade_date,num_trades";
  const outputLines: string[] = [newHeader];

  const total = originalLines.length - 1;
  let processed = 0;
  let errors = 0;

  console.log(`\nProcessing ${total} wallets...`);
  const startTime = Date.now();

  for (let i = 1; i < originalLines.length; i++) {
    const origLine = originalLines[i];
    const fields = parseCSVLine(origLine);
    const wallet = stripQuotes(fields[0]).toLowerCase();

    try {
      // Compute CCR-v1 for this wallet
      const ccr = await computeCCRv1(wallet);

      // Compute true mean from position returns
      const { meanWin, meanLoss } = computeMeans(ccr.position_returns);

      // Format as percentage
      const meanWinPct = (meanWin * 100).toFixed(2) + "%";
      const meanLossPct = (meanLoss * 100).toFixed(2) + "%";

      // Get last trade date and num trades from CCR
      const lastTradeDate = ccr.last_trade_date || "";
      const numTrades = ccr.num_trades || 0;

      // Append to original line (preserving quoting)
      outputLines.push(`${origLine},${meanWinPct},${meanLossPct},${lastTradeDate},${numTrades}`);
    } catch (err) {
      // On error, append empty values
      outputLines.push(`${origLine},,,,`);
      errors++;
    }

    processed++;
    if (processed % 50 === 0) {
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const rate = processed / elapsed;
      const remaining = (total - processed) / rate;
      console.log(`[${processed}/${total}] ${((processed / total) * 100).toFixed(1)}% | ETA: ${remaining.toFixed(1)}m`);
    }
  }

  // Write output
  fs.writeFileSync(OUTPUT_CSV, outputLines.join("\n"));

  const totalTime = (Date.now() - startTime) / 1000 / 60;
  console.log(`\n✅ Done in ${totalTime.toFixed(1)} minutes`);
  console.log(`Output: ${OUTPUT_CSV}`);
  console.log(`Processed: ${processed} | Errors: ${errors}`);

  // Verify output
  const verifyContent = fs.readFileSync(OUTPUT_CSV, "utf-8");
  const verifyLines = verifyContent.split(/\r?\n/).filter((l) => l.trim());
  const verifyHeader = parseCSVLine(verifyLines[0]);
  console.log(`\nVerification:`);
  console.log(`  Total columns: ${verifyHeader.length}`);
  console.log(`  Last 4: ${verifyHeader.slice(-4).join(", ")}`);

  // Sample first 5
  console.log(`\nSample (first 5):`);
  for (let i = 1; i <= 5; i++) {
    const fields = parseCSVLine(verifyLines[i]);
    const w = stripQuotes(fields[0]).slice(0, 12);
    const mw = fields[fields.length - 4];
    const ml = fields[fields.length - 3];
    const lt = fields[fields.length - 2];
    const nt = fields[fields.length - 1];
    console.log(`${w}... | mean_win: ${mw} | mean_loss: ${ml} | last_trade: ${lt} | trades: ${nt}`);
  }
}

main().catch(console.error);
