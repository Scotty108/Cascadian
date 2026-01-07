/**
 * Add trade-level win/loss counts v3
 * Direct ClickHouse query to:
 * 1. Calculate PnL per position (condition_id)
 * 2. Count trades per position
 * 3. Attribute trades to winning/losing based on position outcome
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

interface TradeStats {
  winning_trades: number;
  losing_trades: number;
  neutral_trades: number;
  total_trades: number;
}

async function getTradeStats(wallet: string): Promise<TradeStats> {
  // Direct query that:
  // 1. Dedupes trades by event_id
  // 2. Calculates realized PnL per condition (sells - buys)
  // 3. Joins with resolutions to get payout for resolved markets
  // 4. Counts trades in winning vs losing positions
  const query = `
    WITH
    -- Deduplicated trades
    trades AS (
      SELECT
        event_id,
        any(condition_id) as condition_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower({wallet:String})
        AND is_deleted = 0
      GROUP BY event_id
    ),
    -- PnL per condition (using USDC flow: sells give USDC, buys cost USDC)
    position_pnl AS (
      SELECT
        t.condition_id,
        count(*) as trade_count,
        sum(CASE WHEN t.side = 'SELL' THEN t.usdc ELSE -t.usdc END) as usdc_flow,
        sum(CASE WHEN t.side = 'BUY' THEN t.tokens ELSE -t.tokens END) as net_tokens,
        -- Get resolution payout if resolved
        any(r.payout) as payout
      FROM trades t
      LEFT JOIN pm_condition_resolution_map r ON lower(t.condition_id) = lower(r.condition_id)
      WHERE t.condition_id != ''
      GROUP BY t.condition_id
    ),
    -- Calculate final PnL including resolution value
    position_final AS (
      SELECT
        condition_id,
        trade_count,
        usdc_flow,
        net_tokens,
        payout,
        -- Final PnL = USDC flow + remaining tokens * payout (if resolved)
        usdc_flow + (CASE WHEN payout IS NOT NULL THEN net_tokens * payout ELSE 0 END) as final_pnl
      FROM position_pnl
    )
    SELECT
      sum(CASE WHEN final_pnl > 0 THEN trade_count ELSE 0 END) as winning_trades,
      sum(CASE WHEN final_pnl < 0 THEN trade_count ELSE 0 END) as losing_trades,
      sum(CASE WHEN final_pnl = 0 THEN trade_count ELSE 0 END) as neutral_trades,
      sum(trade_count) as total_trades
    FROM position_final
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet },
    format: "JSONEachRow",
  });

  const rows = await result.json<TradeStats>();
  return rows[0] || { winning_trades: 0, losing_trades: 0, neutral_trades: 0, total_trades: 0 };
}

async function main() {
  console.log("Reading input CSV...");
  const content = fs.readFileSync(INPUT_CSV, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCSVLine(lines[0]);

  console.log("Found", lines.length - 1, "wallets");

  const trueWinsIdx = header.indexOf("true_num_wins");
  const trueLossesIdx = header.indexOf("true_num_losses");
  const trueWinRateIdx = header.indexOf("true_win_rate");

  const total = lines.length - 1;
  const startTime = Date.now();
  const outputLines: string[] = [];

  const newHeader = [...header];
  newHeader[trueWinsIdx] = "winning_trades";
  newHeader[trueLossesIdx] = "losing_trades";
  newHeader[trueWinRateIdx] = "trade_win_rate";
  outputLines.push(newHeader.join(","));

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const wallet = strip(fields[0]).toLowerCase();

    try {
      const stats = await getTradeStats(wallet);

      const winningTrades = Number(stats.winning_trades);
      const losingTrades = Number(stats.losing_trades);
      const totalClassified = winningTrades + losingTrades;
      const winRate = totalClassified > 0 ? ((winningTrades / totalClassified) * 100).toFixed(1) + "%" : "0%";

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

  const numTradesIdx = header.indexOf("num_trades");
  console.log(`\nSample with num_trades comparison:`);
  for (let i = 1; i <= 10; i++) {
    const fields = parseCSVLine(outputLines[i]);
    const w = strip(fields[0]).slice(0, 12);
    const numTrades = Number(strip(fields[numTradesIdx]));
    const winTrades = Number(strip(fields[trueWinsIdx]));
    const loseTrades = Number(strip(fields[trueLossesIdx]));
    const sum = winTrades + loseTrades;
    const rate = strip(fields[trueWinRateIdx]);
    const pct = ((sum / numTrades) * 100).toFixed(0);
    console.log(`${w}... | trades: ${String(numTrades).padStart(5)} | win: ${String(winTrades).padStart(5)} + lose: ${String(loseTrades).padStart(5)} = ${String(sum).padStart(5)} (${pct}%) | rate: ${rate}`);
  }
}

main().catch(console.error);
