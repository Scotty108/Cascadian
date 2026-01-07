/**
 * Add trade-level win/loss counts v2
 * - Use CCR-v1 to get accurate position PnL
 * - Count trades per condition_id
 * - Attribute trades to winning/losing based on position outcome
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import * as fs from "fs";
import { clickhouse } from "../lib/clickhouse/client";
import { computeCCRv1 } from "../lib/pnl/ccrEngineV1";

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

async function getTradeCountsPerCondition(wallet: string): Promise<Map<string, number>> {
  // Get trade counts per condition_id
  const query = `
    SELECT
      condition_id,
      count(DISTINCT event_id) as trade_count
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower({wallet:String})
      AND is_deleted = 0
      AND condition_id != ''
    GROUP BY condition_id
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ condition_id: string; trade_count: number }>();
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.condition_id.toLowerCase(), Number(row.trade_count));
  }
  return map;
}

async function main() {
  console.log("Reading input CSV...");
  const content = fs.readFileSync(INPUT_CSV, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCSVLine(lines[0]);

  console.log("Found", lines.length - 1, "wallets");

  // Find columns to update
  const trueWinsIdx = header.indexOf("true_num_wins");
  const trueLossesIdx = header.indexOf("true_num_losses");
  const trueWinRateIdx = header.indexOf("true_win_rate");

  const total = lines.length - 1;
  const startTime = Date.now();
  const outputLines: string[] = [];

  // Update header
  const newHeader = [...header];
  newHeader[trueWinsIdx] = "winning_trades";
  newHeader[trueLossesIdx] = "losing_trades";
  newHeader[trueWinRateIdx] = "trade_win_rate";
  outputLines.push(newHeader.join(","));

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const wallet = strip(fields[0]).toLowerCase();

    try {
      // Get CCR-v1 data for accurate position PnL
      const ccr = await computeCCRv1(wallet);

      // Get trade counts per condition
      const tradeCounts = await getTradeCountsPerCondition(wallet);

      // CCR-v1 returns position data with condition_ids and returns
      // We need to match positions to their trade counts
      let winningTrades = 0;
      let losingTrades = 0;
      let totalAttributedTrades = 0;

      // ccr.positions contains per-position data
      if (ccr.positions) {
        for (const pos of ccr.positions) {
          const conditionId = pos.condition_id?.toLowerCase();
          const tradeCount = tradeCounts.get(conditionId) || 0;

          if (pos.pnl > 0) {
            winningTrades += tradeCount;
          } else if (pos.pnl < 0) {
            losingTrades += tradeCount;
          }
          totalAttributedTrades += tradeCount;
        }
      }

      const totalTrades = winningTrades + losingTrades;
      const winRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) + "%" : "0%";

      fields[trueWinsIdx] = String(winningTrades);
      fields[trueLossesIdx] = String(losingTrades);
      fields[trueWinRateIdx] = winRate;

      outputLines.push(fields.join(","));
    } catch (err) {
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

  // Verify with comparison to num_trades
  const numTradesIdx = header.indexOf("num_trades");
  console.log(`\nSample with num_trades comparison:`);
  for (let i = 1; i <= 10; i++) {
    const fields = parseCSVLine(outputLines[i]);
    const w = strip(fields[0]).slice(0, 12);
    const numTrades = strip(fields[numTradesIdx]);
    const winTrades = strip(fields[trueWinsIdx]);
    const loseTrades = strip(fields[trueLossesIdx]);
    const sum = Number(winTrades) + Number(loseTrades);
    const rate = strip(fields[trueWinRateIdx]);
    const match = Math.abs(Number(numTrades) - sum) < 50 ? "✓" : "⚠";
    console.log(`${w}... | trades: ${numTrades.padStart(5)} | win: ${winTrades.padStart(5)} + lose: ${loseTrades.padStart(5)} = ${String(sum).padStart(5)} ${match} | rate: ${rate}`);
  }
}

main().catch(console.error);
