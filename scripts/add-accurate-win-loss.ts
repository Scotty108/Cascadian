/**
 * Add accurate win/loss counts and win rate from CCR-v1 position returns
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import * as fs from "fs";
import { computeCCRv1 } from "../lib/pnl/ccrEngineV1";

const INPUT_CSV = "/Users/scotty/Projects/Cascadian-app/platinum_wallets_final.csv";
const OUTPUT_CSV = "/Users/scotty/Projects/Cascadian-app/platinum_wallets_complete.csv";

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

function strip(v: string): string {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

async function main() {
  console.log("Reading input CSV...");
  const content = fs.readFileSync(INPUT_CSV, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  console.log("Found", lines.length - 1, "wallets");

  // Add new columns to header
  const newHeader = lines[0] + ",true_num_wins,true_num_losses,true_win_rate";
  const outputLines: string[] = [newHeader];

  const total = lines.length - 1;
  const startTime = Date.now();

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const wallet = strip(fields[0]).toLowerCase();

    try {
      const ccr = await computeCCRv1(wallet);
      const returns = ccr.position_returns;

      // Count wins and losses from position returns
      const wins = returns.filter((r) => r > 0).length;
      const losses = returns.filter((r) => r < 0).length;
      const total = wins + losses;
      const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) + "%" : "0%";

      outputLines.push(`${lines[i]},${wins},${losses},${winRate}`);
    } catch (err) {
      outputLines.push(`${lines[i]},,,`);
    }

    if (i % 50 === 0) {
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const rate = i / elapsed;
      const remaining = (total - i) / rate;
      console.log(`[${i}/${total}] ${((i / total) * 100).toFixed(1)}% | ETA: ${remaining.toFixed(1)}m`);
    }
  }

  fs.writeFileSync(OUTPUT_CSV, outputLines.join("\n"));

  const totalTime = (Date.now() - startTime) / 1000 / 60;
  console.log(`\n✅ Done in ${totalTime.toFixed(1)} minutes`);
  console.log(`Output: ${OUTPUT_CSV}`);

  // Verify and show sample
  const verifyContent = fs.readFileSync(OUTPUT_CSV, "utf-8");
  const verifyLines = verifyContent.split(/\r?\n/).filter((l) => l.trim());
  const verifyHeader = parseCSVLine(verifyLines[0]);

  console.log(`\nNew columns: ${verifyHeader.slice(-3).join(", ")}`);
  console.log(`Total columns: ${verifyHeader.length}`);

  console.log(`\nSample (first 5):`);
  for (let i = 1; i <= 5; i++) {
    const fields = parseCSVLine(verifyLines[i]);
    const w = strip(fields[0]).slice(0, 12);
    const wins = fields[fields.length - 3];
    const losses = fields[fields.length - 2];
    const rate = fields[fields.length - 1];
    console.log(`${w}... | wins: ${wins} | losses: ${losses} | win_rate: ${rate}`);
  }
}

main().catch(console.error);
