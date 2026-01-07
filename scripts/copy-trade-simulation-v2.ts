/**
 * Copy Trade Simulation V2 - TRADE BY TRADE
 *
 * Simulates $1 bet on EVERY individual trade (not position).
 * Each buy trade = $1 at their entry price, held to resolution.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { clickhouse } from "../lib/clickhouse/client";

const TARGET_WALLETS = [
  "0x1e109e389fb9cc1fc37360ab796b42c12d4bbeee", // ConfusedUngaBunga
  "0x5ad5c4608c4661361b91c92e1091d2c5b43c37b9", // roberto73
  "0x71cd52a9bf9121cf8376ba13999468f5d659912d", // Marcus177
  "0x01b4f80f5f77d5b9c9f6bb163ad0f64b1001372e", // ghost01
  "0x74cbe13dba27a6a16805e9e7142ee68aa09cae6d", // C2H5O
  "0xfb81f27f1c8758d477332f8e751322c424da1cf3", // CiderApple
  "0x99984e22205053950eb25453779267bcc1aee858", // skybuyer24
  "0x4d7fad0c5944fc24d4a67110f8e31abd5f559485", // KidNR
  "0x5bbefc673462f1955e31b4a2347450724946c65d", // playboyisinthehouse
  "0x3b4484b6c8cbfdaa383ba337ab3f0d71055e264e", // Bruegel
  "0xc178402031235263f78c1a43bba8cd49d2be35b3", // asdalkjfa
  "0x373551ed197d65a504390c365835cadb9ead7ad5", // 1416CTaKolloKN
];

interface TradeResult {
  wallet: string;
  condition_id: string;
  outcome_index: number;
  trade_date: string;
  entry_price: number;
  tokens_bought: number;
  is_resolved: boolean;
  payout: number;
  dollar_bet: number;
  dollar_return: number;
  pnl: number;
  return_pct: number;
}

async function getTradeResults(): Promise<TradeResult[]> {
  const walletList = TARGET_WALLETS.map(w => `'${w.toLowerCase()}'`).join(',');

  // Get every individual BUY trade
  const query = `
    WITH
    -- All BUY trades for target wallets
    buy_trades AS (
      SELECT
        t.event_id,
        lower(t.trader_wallet) as wallet,
        m.condition_id,
        m.outcome_index,
        t.trade_time,
        t.usdc_amount / 1000000.0 as usdc,
        t.token_amount / 1000000.0 as tokens,
        t.usdc_amount / t.token_amount as entry_price  -- price per token (in micro units, so divide later)
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_unified m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) IN (${walletList})
        AND t.is_deleted = 0
        AND lower(t.side) = 'buy'
    ),
    -- Deduplicated by event_id
    trades_dedup AS (
      SELECT
        event_id,
        any(wallet) as wallet,
        any(condition_id) as condition_id,
        any(outcome_index) as outcome_index,
        any(trade_time) as trade_time,
        any(usdc) as usdc,
        any(tokens) as tokens
      FROM buy_trades
      GROUP BY event_id
    )
    SELECT
      t.wallet,
      t.condition_id,
      t.outcome_index,
      toString(t.trade_time) as trade_date,
      CASE WHEN t.tokens > 0 THEN t.usdc / t.tokens ELSE 0 END as entry_price,
      t.tokens as tokens_bought,
      r.payout_numerators IS NOT NULL AND r.payout_numerators != '' AND length(r.payout_numerators) > 2 as is_resolved,
      CASE
        WHEN r.payout_numerators IS NOT NULL AND r.payout_numerators != '' AND length(r.payout_numerators) > 2
        THEN JSONExtractInt(r.payout_numerators, t.outcome_index + 1)
        ELSE -1
      END as payout
    FROM trades_dedup t
    LEFT JOIN pm_condition_resolutions r ON lower(t.condition_id) = lower(r.condition_id)
    WHERE t.tokens > 0 AND t.usdc > 0
  `;

  const result = await clickhouse.query({
    query,
    format: "JSONEachRow",
    clickhouse_settings: { max_execution_time: 300 },
  });

  const rawTrades = await result.json<any>();

  // Calculate $1 bet results for each trade
  const trades: TradeResult[] = [];

  for (const t of rawTrades) {
    const entryPrice = Number(t.entry_price);
    const isResolved = t.is_resolved;
    const payout = Number(t.payout);

    if (entryPrice <= 0 || !isResolved || payout < 0) continue;

    // Simulate $1 bet at their entry price
    const dollarBet = 1;
    const tokensBought = dollarBet / entryPrice;  // How many tokens $1 buys
    const dollarReturn = tokensBought * payout;   // Value at resolution
    const pnl = dollarReturn - dollarBet;
    const returnPct = (pnl / dollarBet) * 100;

    trades.push({
      wallet: t.wallet,
      condition_id: t.condition_id,
      outcome_index: Number(t.outcome_index),
      trade_date: t.trade_date,
      entry_price: entryPrice,
      tokens_bought: tokensBought,
      is_resolved: isResolved,
      payout: payout,
      dollar_bet: dollarBet,
      dollar_return: dollarReturn,
      pnl: pnl,
      return_pct: returnPct,
    });
  }

  return trades;
}

async function main() {
  console.log("=".repeat(80));
  console.log("COPY TRADE SIMULATION V2 - $1 Per TRADE (Not Position)");
  console.log("=".repeat(80));
  console.log("");

  console.log("Fetching individual BUY trades for 12 target wallets...");
  const trades = await getTradeResults();
  console.log(`Found ${trades.length.toLocaleString()} resolved BUY trades\n`);

  // Per-wallet analysis
  console.log("-".repeat(80));
  console.log("PER-WALLET RESULTS (Trade by Trade)");
  console.log("-".repeat(80));
  console.log("");

  const walletStats: Map<string, {
    trades: number;
    wins: number;
    losses: number;
    totalBet: number;
    totalReturn: number;
    returns: number[];
    winReturns: number[];
    lossReturns: number[];
  }> = new Map();

  for (const wallet of TARGET_WALLETS) {
    walletStats.set(wallet.toLowerCase(), {
      trades: 0,
      wins: 0,
      losses: 0,
      totalBet: 0,
      totalReturn: 0,
      returns: [],
      winReturns: [],
      lossReturns: [],
    });
  }

  for (const t of trades) {
    const stats = walletStats.get(t.wallet.toLowerCase());
    if (!stats) continue;

    stats.trades++;
    stats.totalBet += t.dollar_bet;
    stats.totalReturn += t.dollar_return;
    stats.returns.push(t.return_pct);

    if (t.pnl > 0.01) {
      stats.wins++;
      stats.winReturns.push(t.return_pct);
    } else if (t.pnl < -0.01) {
      stats.losses++;
      stats.lossReturns.push(t.return_pct);
    }
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // Sort by ROI
  const walletResults = [...walletStats.entries()]
    .map(([wallet, stats]) => ({
      wallet,
      ...stats,
      roi: stats.totalBet > 0 ? ((stats.totalReturn - stats.totalBet) / stats.totalBet) * 100 : 0,
      winRate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
      meanWin: avg(stats.winReturns),
      meanLoss: avg(stats.lossReturns),
    }))
    .sort((a, b) => b.roi - a.roi);

  console.log("Wallet      | Trades  | Wins   | Losses | Win Rate | Mean Win% | Mean Loss% | ROI");
  console.log("-".repeat(95));

  for (const w of walletResults) {
    console.log(
      `${w.wallet.slice(0, 10)}... | ${String(w.trades).padStart(7)} | ${String(w.wins).padStart(6)} | ${String(w.losses).padStart(6)} | ${w.winRate.toFixed(1).padStart(7)}% | ${w.meanWin.toFixed(1).padStart(8)}% | ${w.meanLoss.toFixed(1).padStart(9)}% | ${w.roi.toFixed(1).padStart(7)}%`
    );
  }

  // Portfolio totals
  console.log("\n");
  console.log("=".repeat(80));
  console.log("PORTFOLIO SIMULATION - $1 on EVERY Trade from ALL Wallets");
  console.log("=".repeat(80));
  console.log("");

  const allWins = trades.filter(t => t.pnl > 0.01);
  const allLosses = trades.filter(t => t.pnl < -0.01);
  const totalBet = trades.reduce((sum, t) => sum + t.dollar_bet, 0);
  const totalReturn = trades.reduce((sum, t) => sum + t.dollar_return, 0);
  const netPnl = totalReturn - totalBet;
  const overallRoi = (netPnl / totalBet) * 100;

  console.log("Summary Statistics:");
  console.log(`  Total Trades Copied:        ${trades.length.toLocaleString()}`);
  console.log(`  Winning Trades:             ${allWins.length.toLocaleString()} (${((allWins.length / trades.length) * 100).toFixed(1)}%)`);
  console.log(`  Losing Trades:              ${allLosses.length.toLocaleString()} (${((allLosses.length / trades.length) * 100).toFixed(1)}%)`);
  console.log("");
  console.log(`  Total Capital Deployed:     $${totalBet.toLocaleString()}`);
  console.log(`  Total Value Returned:       $${totalReturn.toFixed(2).toLocaleString()}`);
  console.log(`  Net Profit/Loss:            $${netPnl.toFixed(2).toLocaleString()}`);
  console.log(`  Overall ROI:                ${overallRoi.toFixed(1)}%`);

  // Per-trade stats
  const allReturns = trades.map(t => t.return_pct);
  const winReturns = allWins.map(t => t.return_pct);
  const lossReturns = allLosses.map(t => t.return_pct);

  console.log("");
  console.log("Per-Trade Return Distribution:");
  console.log(`  Mean Return (all):          ${avg(allReturns).toFixed(1)}%`);
  console.log(`  Mean Win Return:            ${avg(winReturns).toFixed(1)}%`);
  console.log(`  Mean Loss Return:           ${avg(lossReturns).toFixed(1)}%`);

  // Expected Value check
  const winRate = allWins.length / trades.length;
  const lossRate = allLosses.length / trades.length;
  const expectedEV = (winRate * avg(winReturns)) + (lossRate * avg(lossReturns));

  console.log("");
  console.log("Expected Value Formula Check:");
  console.log(`  Win Rate:                   ${(winRate * 100).toFixed(1)}%`);
  console.log(`  Loss Rate:                  ${(lossRate * 100).toFixed(1)}%`);
  console.log(`  EV = (${(winRate * 100).toFixed(1)}% × ${avg(winReturns).toFixed(1)}%) + (${(lossRate * 100).toFixed(1)}% × ${avg(lossReturns).toFixed(1)}%)`);
  console.log(`  EV = ${(winRate * avg(winReturns)).toFixed(1)}% + ${(lossRate * avg(lossReturns)).toFixed(1)}%`);
  console.log(`  EV = ${expectedEV.toFixed(1)}% per trade`);

  // Daily breakdown
  const dailyStats: Map<string, { trades: number; bet: number; return: number }> = new Map();

  for (const t of trades) {
    const date = t.trade_date.split(" ")[0];
    const existing = dailyStats.get(date) || { trades: 0, bet: 0, return: 0 };
    existing.trades++;
    existing.bet += t.dollar_bet;
    existing.return += t.dollar_return;
    dailyStats.set(date, existing);
  }

  const sortedDays = [...dailyStats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const last30 = sortedDays.slice(-30);

  console.log("\n");
  console.log("=".repeat(80));
  console.log("LAST 30 DAYS (by trade date)");
  console.log("=".repeat(80));
  console.log("");
  console.log("Date       | Trades | Bet    | Return   | Net P/L  | Daily ROI");
  console.log("-".repeat(65));

  for (const [date, data] of last30) {
    const pnl = data.return - data.bet;
    const roi = (pnl / data.bet) * 100;
    console.log(
      `${date} | ${String(data.trades).padStart(6)} | $${data.bet.toFixed(0).padStart(5)} | $${data.return.toFixed(0).padStart(7)} | $${pnl.toFixed(0).padStart(7)} | ${roi.toFixed(1).padStart(8)}%`
    );
  }

  const last30Bet = last30.reduce((sum, [_, d]) => sum + d.bet, 0);
  const last30Return = last30.reduce((sum, [_, d]) => sum + d.return, 0);
  const last30Pnl = last30Return - last30Bet;
  console.log("-".repeat(65));
  console.log(
    `TOTAL      | ${String(last30.reduce((s, [_, d]) => s + d.trades, 0)).padStart(6)} | $${last30Bet.toFixed(0).padStart(5)} | $${last30Return.toFixed(0).padStart(7)} | $${last30Pnl.toFixed(0).padStart(7)} | ${((last30Pnl / last30Bet) * 100).toFixed(1).padStart(8)}%`
  );

  // Risk metrics
  console.log("\n");
  console.log("=".repeat(80));
  console.log("RISK ANALYSIS");
  console.log("=".repeat(80));
  console.log("");

  const winningDays = sortedDays.filter(([_, d]) => d.return > d.bet).length;
  const losingDays = sortedDays.filter(([_, d]) => d.return < d.bet).length;

  const worstDay = sortedDays.reduce((worst, [date, data]) => {
    const pnl = data.return - data.bet;
    return pnl < worst.pnl ? { date, pnl, trades: data.trades } : worst;
  }, { date: "", pnl: 0, trades: 0 });

  const bestDay = sortedDays.reduce((best, [date, data]) => {
    const pnl = data.return - data.bet;
    return pnl > best.pnl ? { date, pnl, trades: data.trades } : best;
  }, { date: "", pnl: 0, trades: 0 });

  console.log(`  Trading Days:               ${sortedDays.length}`);
  console.log(`  Winning Days:               ${winningDays} (${((winningDays / sortedDays.length) * 100).toFixed(1)}%)`);
  console.log(`  Losing Days:                ${losingDays} (${((losingDays / sortedDays.length) * 100).toFixed(1)}%)`);
  console.log(`  Best Day:                   ${bestDay.date} (+$${bestDay.pnl.toFixed(0)}, ${bestDay.trades} trades)`);
  console.log(`  Worst Day:                  ${worstDay.date} ($${worstDay.pnl.toFixed(0)}, ${worstDay.trades} trades)`);

  // Adjusted expectations
  console.log("\n");
  console.log("=".repeat(80));
  console.log("EXECUTION REALITY CHECK");
  console.log("=".repeat(80));
  console.log("");
  console.log("Assuming 30% edge reduction for slippage/execution:");
  const adjustedRoi = overallRoi * 0.7;
  const adjustedPnl = netPnl * 0.7;
  console.log(`  Adjusted ROI:               ${adjustedRoi.toFixed(1)}%`);
  console.log(`  Adjusted Net P/L:           $${adjustedPnl.toFixed(0)}`);
}

main().catch(console.error);
