/**
 * Add trade-level win/loss counts
 * - Count trades in winning positions vs trades in losing positions
 * - A winning position = position with positive return
 * - All trades in that position count as "winning trades"
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import * as fs from "fs";
import { clickhouse } from "../lib/clickhouse/client";

const INPUT_CSV = "/Users/scotty/Projects/Cascadian-app/platinum_wallets_complete.csv";
const OUTPUT_CSV = "/Users/scotty/Projects/Cascadian-app/platinum_wallets_final_v2.csv";

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && !inQuotes) { inQuotes = true; current += char; }
    else if (char === '"' && inQuotes) { inQuotes = false; current += char; }
    else if (char === "," && !inQuotes) { fields.push(current); current = ""; }
    else { current += char; }
  }
  fields.push(current);
  return fields;
}

function strip(v: string): string {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

interface PositionStats {
  condition_id: string;
  trade_count: number;
  pnl: number;
}

async function getTradeCountsPerPosition(wallet: string): Promise<PositionStats[]> {
  // Get trade counts and PnL per condition (position)
  const query = `
    WITH trades AS (
      SELECT
        event_id,
        any(condition_id) as condition_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc,
        any(price) as price
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower({wallet:String})
        AND is_deleted = 0
      GROUP BY event_id
    ),
    position_trades AS (
      SELECT
        condition_id,
        count(*) as trade_count,
        sum(CASE WHEN side = 'SELL' THEN usdc ELSE -usdc END) as realized_pnl
      FROM trades
      WHERE condition_id != ''
      GROUP BY condition_id
    )
    SELECT
      condition_id,
      trade_count,
      realized_pnl as pnl
    FROM position_trades
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet },
    format: "JSONEachRow",
  });

  const rows = await result.json<PositionStats>();
  return rows;
}

async function main() {
  console.log("Reading input CSV...");
  const content = fs.readFileSync(INPUT_CSV, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCSVLine(lines[0]);

  console.log("Found", lines.length - 1, "wallets");
  console.log("Existing columns:", header.length);

  // Find and remove the position-level columns we want to replace
  const trueWinsIdx = header.indexOf("true_num_wins");
  const trueLossesIdx = header.indexOf("true_num_losses");
  const trueWinRateIdx = header.indexOf("true_win_rate");

  console.log("Replacing columns at indices:", trueWinsIdx, trueLossesIdx, trueWinRateIdx);

  const total = lines.length - 1;
  const startTime = Date.now();
  const outputLines: string[] = [];

  // Update header - rename to clarify these are trade counts
  const newHeader = [...header];
  newHeader[trueWinsIdx] = "winning_trades";
  newHeader[trueLossesIdx] = "losing_trades";
  newHeader[trueWinRateIdx] = "trade_win_rate";
  outputLines.push(newHeader.join(","));

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const wallet = strip(fields[0]).toLowerCase();

    try {
      const positions = await getTradeCountsPerPosition(wallet);

      // Count trades in winning vs losing positions
      let winningTrades = 0;
      let losingTrades = 0;

      for (const pos of positions) {
        if (pos.pnl > 0) {
          winningTrades += pos.trade_count;
        } else if (pos.pnl < 0) {
          losingTrades += pos.trade_count;
        }
        // pnl = 0 positions are neutral, not counted
      }

      const totalTrades = winningTrades + losingTrades;
      const winRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) + "%" : "0%";

      // Update the fields
      fields[trueWinsIdx] = String(winningTrades);
      fields[trueLossesIdx] = String(losingTrades);
      fields[trueWinRateIdx] = winRate;

      outputLines.push(fields.join(","));
    } catch (err) {
      // Keep original values on error
      outputLines.push(lines[i]);
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

  // Verify
  console.log(`\nSample (first 5):`);
  for (let i = 1; i <= 5; i++) {
    const fields = parseCSVLine(outputLines[i]);
    const w = strip(fields[0]).slice(0, 12);
    const numTrades = strip(fields[header.indexOf("num_trades")]);
    const winTrades = strip(fields[trueWinsIdx]);
    const loseTrades = strip(fields[trueLossesIdx]);
    const rate = strip(fields[trueWinRateIdx]);
    const sum = Number(winTrades) + Number(loseTrades);
    console.log(`${w}... | num_trades: ${numTrades} | winning: ${winTrades} + losing: ${loseTrades} = ${sum} | rate: ${rate}`);
  }
}

main().catch(console.error);
