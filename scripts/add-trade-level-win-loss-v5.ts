/**
 * Add trade-level win/loss counts v5
 * - Use correct table: pm_condition_resolutions
 * - Count trades per position, multiply by outcome
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
  total_trades: number;
}

async function getTradeStats(wallet: string): Promise<TradeStats> {
  const query = `
    WITH
    -- Deduplicated trades with condition_id from token map
    trades AS (
      SELECT
        t.event_id,
        any(m.condition_id) as condition_id,
        any(t.side) as side,
        any(t.usdc_amount) / 1000000.0 as usdc,
        any(t.token_amount) / 1000000.0 as tokens,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_unified m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower({wallet:String})
        AND t.is_deleted = 0
      GROUP BY t.event_id
    ),
    -- PnL per condition using USDC flow
    position_pnl AS (
      SELECT
        condition_id,
        count(*) as trade_count,
        sum(CASE WHEN side = 'SELL' THEN usdc ELSE -usdc END) as usdc_flow,
        sum(CASE WHEN side = 'BUY' THEN tokens ELSE -tokens END) as net_tokens,
        any(outcome_index) as outcome_index
      FROM trades
      WHERE condition_id IS NOT NULL AND condition_id != ''
      GROUP BY condition_id
    ),
    -- Join with resolutions (correct table name)
    position_final AS (
      SELECT
        p.condition_id,
        p.trade_count,
        p.usdc_flow,
        p.net_tokens,
        r.payout,
        -- Final PnL = USDC flow + remaining tokens * payout (if resolved)
        p.usdc_flow + (CASE
          WHEN r.payout IS NOT NULL AND length(r.payout) > toUInt8(p.outcome_index) THEN
            p.net_tokens * r.payout[toUInt8(p.outcome_index) + 1]
          ELSE 0
        END) as final_pnl
      FROM position_pnl p
      LEFT JOIN pm_condition_resolutions r ON lower(p.condition_id) = lower(r.condition_id)
    )
    SELECT
      sum(CASE WHEN final_pnl > 0.01 THEN trade_count ELSE 0 END) as winning_trades,
      sum(CASE WHEN final_pnl < -0.01 THEN trade_count ELSE 0 END) as losing_trades,
      (SELECT count(DISTINCT event_id) FROM pm_trader_events_v2
       WHERE lower(trader_wallet) = lower({wallet:String}) AND is_deleted = 0) as total_trades
    FROM position_final
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet },
    format: "JSONEachRow",
  });

  const rows = await result.json<TradeStats>();
  return rows[0] || { winning_trades: 0, losing_trades: 0, total_trades: 0 };
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

  let errorCount = 0;

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
    } catch (err: any) {
      errorCount++;
      if (errorCount <= 3) console.error(`Error for ${wallet}:`, err.message?.slice(0, 100));
      outputLines.push(lines[i]);
    }

    if (i % 50 === 0) {
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const rate = i / elapsed;
      const remaining = (total - i) / rate;
      console.log(`[${i}/${total}] ${((i / total) * 100).toFixed(1)}% | ETA: ${remaining.toFixed(1)}m | errors: ${errorCount}`);
    }
  }

  fs.writeFileSync(OUTPUT_CSV, outputLines.join("\n"));

  const totalTime = (Date.now() - startTime) / 1000 / 60;
  console.log(`\n✅ Done in ${totalTime.toFixed(1)} minutes`);
  console.log(`Output: ${OUTPUT_CSV}`);
  console.log(`Total errors: ${errorCount}`);

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
