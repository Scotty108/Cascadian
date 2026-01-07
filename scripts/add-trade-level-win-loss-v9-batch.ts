/**
 * Add trade-level win/loss counts v9 - BATCH VERSION
 *
 * Computes all wallets in a single query for efficiency.
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

interface WalletStats {
  wallet: string;
  winning_trades: number;
  losing_trades: number;
  total_trades: number;
  num_wins: number;        // position count
  num_losses: number;      // position count
  mean_win_return: number; // avg of R_i where R_i > 0 (decimal)
  mean_loss_return: number; // avg of R_i where R_i < 0 (decimal)
}

async function getAllWalletStats(wallets: string[]): Promise<Map<string, WalletStats>> {
  console.log(`Computing stats for ${wallets.length} wallets in batch...`);
  const startTime = Date.now();

  // Create wallet list for IN clause
  const walletList = wallets.map(w => `'${w.toLowerCase()}'`).join(',');

  const query = `
    WITH
    -- All trades for target wallets
    trades AS (
      SELECT
        t.event_id,
        lower(t.trader_wallet) as wallet,
        m.condition_id,
        m.outcome_index,
        t.side,
        t.usdc_amount / 1000000.0 as usdc,
        t.token_amount / 1000000.0 as tokens
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_unified m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) IN (${walletList})
        AND t.is_deleted = 0
    ),
    -- Deduplicated by event_id per wallet
    trades_dedup AS (
      SELECT
        event_id,
        any(wallet) as wallet,
        any(condition_id) as condition_id,
        any(outcome_index) as outcome_index,
        any(side) as side,
        any(usdc) as usdc,
        any(tokens) as tokens
      FROM trades
      GROUP BY event_id
    ),
    -- PnL per position (wallet + condition + outcome)
    position_pnl AS (
      SELECT
        t.wallet,
        t.condition_id,
        t.outcome_index,
        count(*) as trade_count,
        sum(CASE WHEN lower(t.side) = 'sell' THEN t.usdc ELSE -t.usdc END) as realized_pnl,
        sum(CASE WHEN lower(t.side) = 'buy' THEN t.tokens ELSE -t.tokens END) as net_tokens,
        sum(CASE WHEN lower(t.side) = 'buy' THEN t.usdc ELSE 0 END) as cost_basis,
        any(r.payout_numerators) as payout_numerators
      FROM trades_dedup t
      LEFT JOIN pm_condition_resolutions r ON lower(t.condition_id) = lower(r.condition_id)
      GROUP BY t.wallet, t.condition_id, t.outcome_index
    ),
    -- Calculate final PnL and return % per position (R_i = pnl / cost_basis)
    position_final AS (
      SELECT
        wallet,
        trade_count,
        cost_basis,
        net_tokens,
        realized_pnl + (
          CASE
            WHEN payout_numerators IS NOT NULL AND payout_numerators != '' AND length(payout_numerators) > 2
            THEN net_tokens * JSONExtractInt(payout_numerators, outcome_index + 1)
            ELSE 0
          END
        ) as final_pnl,
        -- R_i = final_pnl / cost_basis (only when cost_basis > 0)
        CASE
          WHEN cost_basis > 0.01 THEN (realized_pnl + (
            CASE
              WHEN payout_numerators IS NOT NULL AND payout_numerators != '' AND length(payout_numerators) > 2
              THEN net_tokens * JSONExtractInt(payout_numerators, outcome_index + 1)
              ELSE 0
            END
          )) / cost_basis
          ELSE 0
        END as return_pct
      FROM position_pnl
    ),
    -- Aggregate per wallet - TRADE-WEIGHTED returns (each trade counts equally)
    -- Only include LONG positions (net_tokens >= 0) where we have valid cost basis
    wallet_stats AS (
      SELECT
        wallet,
        -- Trade counts (trades in winning/losing positions)
        sum(CASE WHEN final_pnl > 0.01 THEN trade_count ELSE 0 END) as winning_trades,
        sum(CASE WHEN final_pnl < -0.01 THEN trade_count ELSE 0 END) as losing_trades,
        -- Position counts
        countIf(final_pnl > 0.01 AND cost_basis > 0.01) as num_wins,
        countIf(final_pnl < -0.01 AND cost_basis > 0.01) as num_losses,
        -- Trade-weighted mean return - EXCLUDE SHORTS (net_tokens < 0) to avoid >100% losses
        sumIf(trade_count * return_pct, final_pnl > 0.01 AND cost_basis > 0.01 AND net_tokens >= 0) /
          nullIf(sumIf(trade_count, final_pnl > 0.01 AND cost_basis > 0.01 AND net_tokens >= 0), 0) as mean_win_return,
        sumIf(trade_count * return_pct, final_pnl < -0.01 AND cost_basis > 0.01 AND net_tokens >= 0) /
          nullIf(sumIf(trade_count, final_pnl < -0.01 AND cost_basis > 0.01 AND net_tokens >= 0), 0) as mean_loss_return
      FROM position_final
      GROUP BY wallet
    ),
    -- Total trades per wallet
    total_trades AS (
      SELECT
        lower(trader_wallet) as wallet,
        count(DISTINCT event_id) as total_trades
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) IN (${walletList}) AND is_deleted = 0
      GROUP BY lower(trader_wallet)
    )
    SELECT
      w.wallet,
      w.winning_trades,
      w.losing_trades,
      t.total_trades,
      w.num_wins,
      w.num_losses,
      w.mean_win_return,
      w.mean_loss_return
    FROM wallet_stats w
    LEFT JOIN total_trades t ON w.wallet = t.wallet
  `;

  const result = await clickhouse.query({
    query,
    format: "JSONEachRow",
    clickhouse_settings: {
      max_execution_time: 600, // 10 minute timeout for batch
    },
  });

  const rows = await result.json<WalletStats>();
  console.log(`Batch query completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s, got ${rows.length} results`);

  const statsMap = new Map<string, WalletStats>();
  for (const row of rows) {
    statsMap.set(row.wallet.toLowerCase(), {
      ...row,
      num_wins: Number(row.num_wins) || 0,
      num_losses: Number(row.num_losses) || 0,
      mean_win_return: Number(row.mean_win_return) || 0,
      mean_loss_return: Number(row.mean_loss_return) || 0,
    });
  }
  return statsMap;
}

async function main() {
  console.log("Reading input CSV...");
  const content = fs.readFileSync(INPUT_CSV, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCSVLine(lines[0]);

  console.log("Found", lines.length - 1, "wallets");

  // Extract all wallets
  const wallets: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    wallets.push(strip(fields[0]).toLowerCase());
  }

  // Get all stats in one batch
  const statsMap = await getAllWalletStats(wallets);

  // Find columns to update
  const trueWinsIdx = header.indexOf("true_num_wins");
  const trueLossesIdx = header.indexOf("true_num_losses");
  const trueWinRateIdx = header.indexOf("true_win_rate");
  const meanWinIdx = header.indexOf("mean_win");
  const meanLossIdx = header.indexOf("mean_loss");

  console.log(`Column indices: wins=${trueWinsIdx}, losses=${trueLossesIdx}, rate=${trueWinRateIdx}, meanWin=${meanWinIdx}, meanLoss=${meanLossIdx}`);

  const outputLines: string[] = [];

  // Update header
  const newHeader = [...header];
  newHeader[trueWinsIdx] = "winning_trades";
  newHeader[trueLossesIdx] = "losing_trades";
  newHeader[trueWinRateIdx] = "trade_win_rate";
  newHeader[meanWinIdx] = "trade_mean_win_pct";  // Now percentage
  newHeader[meanLossIdx] = "trade_mean_loss_pct"; // Now percentage
  outputLines.push(newHeader.join(","));

  let matched = 0;
  let missing = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const wallet = strip(fields[0]).toLowerCase();

    const stats = statsMap.get(wallet);
    if (stats) {
      matched++;
      const winningTrades = Number(stats.winning_trades);
      const losingTrades = Number(stats.losing_trades);
      const meanWinReturn = Number(stats.mean_win_return) || 0;  // decimal
      const meanLossReturn = Number(stats.mean_loss_return) || 0; // decimal (negative)

      const totalClassified = winningTrades + losingTrades;
      const winRate = totalClassified > 0 ? ((winningTrades / totalClassified) * 100).toFixed(1) + "%" : "0%";

      // Trade-weighted mean return % (already per-trade weighted in SQL)
      const tradeMeanWinPct = winningTrades > 0 ? (meanWinReturn * 100).toFixed(1) + "%" : "0%";
      const tradeMeanLossPct = losingTrades > 0 ? (meanLossReturn * 100).toFixed(1) + "%" : "0%";

      fields[trueWinsIdx] = String(winningTrades);
      fields[trueLossesIdx] = String(losingTrades);
      fields[trueWinRateIdx] = winRate;
      fields[meanWinIdx] = tradeMeanWinPct;
      fields[meanLossIdx] = tradeMeanLossPct;
    } else {
      missing++;
      // Keep original values but update column names
      fields[trueWinsIdx] = "0";
      fields[trueLossesIdx] = "0";
      fields[trueWinRateIdx] = "0%";
      fields[meanWinIdx] = "0%";
      fields[meanLossIdx] = "0%";
    }

    outputLines.push(fields.join(","));
  }

  fs.writeFileSync(OUTPUT_CSV, outputLines.join("\n"));

  console.log(`\n✅ Done!`);
  console.log(`Matched: ${matched}, Missing: ${missing}`);
  console.log(`Output: ${OUTPUT_CSV}`);

  const numTradesIdx = header.indexOf("num_trades");
  console.log(`\nSample with trade-level metrics:`);
  console.log(`wallet       | num_trades | win_trades | lose_trades | coverage | win_rate | mean_win_pct | mean_loss_pct`);
  for (let i = 1; i <= 10; i++) {
    const fields = parseCSVLine(outputLines[i]);
    const w = strip(fields[0]).slice(0, 12);
    const numTrades = Number(strip(fields[numTradesIdx]));
    const winTrades = Number(strip(fields[trueWinsIdx]));
    const loseTrades = Number(strip(fields[trueLossesIdx]));
    const sum = winTrades + loseTrades;
    const rate = strip(fields[trueWinRateIdx]);
    const meanWinPct = strip(fields[meanWinIdx]);
    const meanLossPct = strip(fields[meanLossIdx]);
    const pct = numTrades > 0 ? ((sum / numTrades) * 100).toFixed(0) : "0";
    console.log(`${w}... | ${String(numTrades).padStart(10)} | ${String(winTrades).padStart(10)} | ${String(loseTrades).padStart(11)} | ${pct.padStart(7)}% | ${rate.padStart(8)} | ${meanWinPct.padStart(12)} | ${meanLossPct.padStart(13)}`);
  }
}

main().catch(console.error);
