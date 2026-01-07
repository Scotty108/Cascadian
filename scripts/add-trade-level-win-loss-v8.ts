/**
 * Add trade-level win/loss counts v8 - COMPLETE TRADE METRICS
 *
 * Computes trade-level (not position-level) metrics:
 * - winning_trades: count of trades in winning positions
 * - losing_trades: count of trades in losing positions
 * - trade_win_rate: winning_trades / (winning + losing)
 * - trade_mean_win: total winning PnL / winning_trades
 * - trade_mean_loss: total losing PnL / losing_trades
 *
 * Formula: final_pnl = realized_pnl + (net_tokens * payout)
 * A position is "winning" if final_pnl > 0.01, "losing" if < -0.01
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
  sum_winning_pnl: number;
  sum_losing_pnl: number;
}

async function getTradeStats(wallet: string): Promise<TradeStats> {
  const query = `
    WITH
    -- Deduplicated trades with condition_id and outcome_index
    trades AS (
      SELECT
        t.event_id,
        m.condition_id,
        m.outcome_index,
        t.side,
        t.usdc_amount / 1000000.0 as usdc,
        t.token_amount / 1000000.0 as tokens
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_unified m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower({wallet:String})
        AND t.is_deleted = 0
    ),
    -- Deduplicated by event_id
    trades_dedup AS (
      SELECT
        event_id,
        any(condition_id) as condition_id,
        any(outcome_index) as outcome_index,
        any(side) as side,
        any(usdc) as usdc,
        any(tokens) as tokens
      FROM trades
      GROUP BY event_id
    ),
    -- PnL per position (condition + outcome_index to handle YES/NO separately)
    position_pnl AS (
      SELECT
        t.condition_id,
        t.outcome_index,
        count(*) as trade_count,
        sum(CASE WHEN lower(t.side) = 'sell' THEN t.usdc ELSE -t.usdc END) as realized_pnl,
        sum(CASE WHEN lower(t.side) = 'buy' THEN t.tokens ELSE -t.tokens END) as net_tokens,
        any(r.payout_numerators) as payout_numerators
      FROM trades_dedup t
      LEFT JOIN pm_condition_resolutions r ON lower(t.condition_id) = lower(r.condition_id)
      GROUP BY t.condition_id, t.outcome_index
    ),
    -- Calculate final PnL including resolution value
    position_final AS (
      SELECT
        condition_id,
        trade_count,
        realized_pnl,
        net_tokens,
        payout_numerators,
        outcome_index,
        -- Payout is 0 or 1 based on resolution
        CASE
          WHEN payout_numerators IS NOT NULL AND payout_numerators != '' AND length(payout_numerators) > 2
          THEN JSONExtractInt(payout_numerators, outcome_index + 1)
          ELSE 0
        END as payout,
        -- Final PnL = realized + (net_tokens * payout)
        realized_pnl + (
          CASE
            WHEN payout_numerators IS NOT NULL AND payout_numerators != '' AND length(payout_numerators) > 2
            THEN net_tokens * JSONExtractInt(payout_numerators, outcome_index + 1)
            ELSE 0
          END
        ) as final_pnl
      FROM position_pnl
    )
    SELECT
      sum(CASE WHEN final_pnl > 0.01 THEN trade_count ELSE 0 END) as winning_trades,
      sum(CASE WHEN final_pnl < -0.01 THEN trade_count ELSE 0 END) as losing_trades,
      (SELECT count(DISTINCT event_id) FROM pm_trader_events_v2
       WHERE lower(trader_wallet) = lower({wallet:String}) AND is_deleted = 0) as total_trades,
      sum(CASE WHEN final_pnl > 0.01 THEN final_pnl ELSE 0 END) as sum_winning_pnl,
      sum(CASE WHEN final_pnl < -0.01 THEN final_pnl ELSE 0 END) as sum_losing_pnl
    FROM position_final
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet },
    format: "JSONEachRow",
    clickhouse_settings: {
      max_execution_time: 60, // 60 second timeout per query
    },
  });

  const rows = await result.json<TradeStats>();
  return rows[0] || { winning_trades: 0, losing_trades: 0, total_trades: 0, sum_winning_pnl: 0, sum_losing_pnl: 0 };
}

async function main() {
  console.log("Reading input CSV...");
  const content = fs.readFileSync(INPUT_CSV, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCSVLine(lines[0]);

  console.log("Found", lines.length - 1, "wallets");

  // Find columns to update - these are the existing position-level columns we'll replace
  const trueWinsIdx = header.indexOf("true_num_wins");
  const trueLossesIdx = header.indexOf("true_num_losses");
  const trueWinRateIdx = header.indexOf("true_win_rate");
  const meanWinIdx = header.indexOf("mean_win");
  const meanLossIdx = header.indexOf("mean_loss");

  console.log(`Column indices: wins=${trueWinsIdx}, losses=${trueLossesIdx}, rate=${trueWinRateIdx}, meanWin=${meanWinIdx}, meanLoss=${meanLossIdx}`);

  const total = lines.length - 1;
  const startTime = Date.now();
  const outputLines: string[] = [];

  // Update header names to reflect trade-level metrics
  const newHeader = [...header];
  newHeader[trueWinsIdx] = "winning_trades";
  newHeader[trueLossesIdx] = "losing_trades";
  newHeader[trueWinRateIdx] = "trade_win_rate";
  newHeader[meanWinIdx] = "trade_mean_win";
  newHeader[meanLossIdx] = "trade_mean_loss";
  outputLines.push(newHeader.join(","));

  let errorCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const wallet = strip(fields[0]).toLowerCase();

    try {
      const stats = await getTradeStats(wallet);

      const winningTrades = Number(stats.winning_trades);
      const losingTrades = Number(stats.losing_trades);
      const sumWinPnl = Number(stats.sum_winning_pnl);
      const sumLosePnl = Number(stats.sum_losing_pnl);

      const totalClassified = winningTrades + losingTrades;
      const winRate = totalClassified > 0 ? ((winningTrades / totalClassified) * 100).toFixed(1) + "%" : "0%";

      // Trade-level mean: total PnL / trade count
      const tradeMeanWin = winningTrades > 0 ? (sumWinPnl / winningTrades).toFixed(2) : "0";
      const tradeMeanLoss = losingTrades > 0 ? (sumLosePnl / losingTrades).toFixed(2) : "0";

      fields[trueWinsIdx] = String(winningTrades);
      fields[trueLossesIdx] = String(losingTrades);
      fields[trueWinRateIdx] = winRate;
      fields[meanWinIdx] = tradeMeanWin;
      fields[meanLossIdx] = tradeMeanLoss;

      outputLines.push(fields.join(","));
    } catch (err: any) {
      errorCount++;
      if (errorCount <= 3) console.error(`Error for ${wallet}:`, err.message?.slice(0, 200));
      outputLines.push(lines[i]);
    }

    if (i % 20 === 0 || i === 1) {
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
  console.log(`\nSample with trade-level metrics:`);
  console.log(`wallet       | num_trades | win_trades | lose_trades | coverage | win_rate | mean_win | mean_loss`);
  for (let i = 1; i <= 10; i++) {
    const fields = parseCSVLine(outputLines[i]);
    const w = strip(fields[0]).slice(0, 12);
    const numTrades = Number(strip(fields[numTradesIdx]));
    const winTrades = Number(strip(fields[trueWinsIdx]));
    const loseTrades = Number(strip(fields[trueLossesIdx]));
    const sum = winTrades + loseTrades;
    const rate = strip(fields[trueWinRateIdx]);
    const meanWin = strip(fields[meanWinIdx]);
    const meanLoss = strip(fields[meanLossIdx]);
    const pct = ((sum / numTrades) * 100).toFixed(0);
    console.log(`${w}... | ${String(numTrades).padStart(10)} | ${String(winTrades).padStart(10)} | ${String(loseTrades).padStart(11)} | ${pct.padStart(7)}% | ${rate.padStart(8)} | ${meanWin.padStart(8)} | ${meanLoss.padStart(9)}`);
  }
}

main().catch(console.error);
