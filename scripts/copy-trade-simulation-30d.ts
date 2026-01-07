/**
 * Copy Trade Simulation - LAST 30 DAYS ONLY
 *
 * Simulates $1 bet on every BUY trade starting 1 month ago.
 * Shows cumulative returns day by day.
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

const WALLET_NAMES: Record<string, string> = {
  "0x1e109e389fb9cc1fc37360ab796b42c12d4bbeee": "ConfusedUngaBunga",
  "0x5ad5c4608c4661361b91c92e1091d2c5b43c37b9": "roberto73",
  "0x71cd52a9bf9121cf8376ba13999468f5d659912d": "Marcus177",
  "0x01b4f80f5f77d5b9c9f6bb163ad0f64b1001372e": "ghost01",
  "0x74cbe13dba27a6a16805e9e7142ee68aa09cae6d": "C2H5O",
  "0xfb81f27f1c8758d477332f8e751322c424da1cf3": "CiderApple",
  "0x99984e22205053950eb25453779267bcc1aee858": "skybuyer24",
  "0x4d7fad0c5944fc24d4a67110f8e31abd5f559485": "KidNR",
  "0x5bbefc673462f1955e31b4a2347450724946c65d": "playboyisinthehouse",
  "0x3b4484b6c8cbfdaa383ba337ab3f0d71055e264e": "Bruegel",
  "0xc178402031235263f78c1a43bba8cd49d2be35b3": "asdalkjfa",
  "0x373551ed197d65a504390c365835cadb9ead7ad5": "1416CTaKolloKN",
};

interface TradeResult {
  wallet: string;
  condition_id: string;
  outcome_index: number;
  trade_date: string;
  entry_price: number;
  is_resolved: boolean;
  payout: number;
  dollar_bet: number;
  dollar_return: number;
  pnl: number;
  return_pct: number;
}

async function getTradeResults(): Promise<TradeResult[]> {
  const walletList = TARGET_WALLETS.map(w => `'${w.toLowerCase()}'`).join(',');

  // Get BUY trades from last 30 days only
  const query = `
    WITH
    buy_trades AS (
      SELECT
        t.event_id,
        lower(t.trader_wallet) as wallet,
        m.condition_id,
        m.outcome_index,
        t.trade_time,
        t.usdc_amount / 1000000.0 as usdc,
        t.token_amount / 1000000.0 as tokens
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_unified m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) IN (${walletList})
        AND t.is_deleted = 0
        AND lower(t.side) = 'buy'
        AND t.trade_time >= now() - INTERVAL 30 DAY
    ),
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
    ORDER BY t.trade_time ASC
  `;

  const result = await clickhouse.query({
    query,
    format: "JSONEachRow",
    clickhouse_settings: { max_execution_time: 300 },
  });

  const rawTrades = await result.json<any>();

  const trades: TradeResult[] = [];

  for (const t of rawTrades) {
    const entryPrice = Number(t.entry_price);
    const isResolved = t.is_resolved;
    const payout = Number(t.payout);

    // Include both resolved and unresolved trades
    const dollarBet = 1;

    let dollarReturn: number;
    let pnl: number;
    let returnPct: number;

    if (isResolved && payout >= 0) {
      const tokensBought = dollarBet / entryPrice;
      dollarReturn = tokensBought * payout;
      pnl = dollarReturn - dollarBet;
      returnPct = (pnl / dollarBet) * 100;
    } else {
      // Unresolved - mark as pending (use entry price as current value estimate)
      dollarReturn = dollarBet; // Assume breakeven for unresolved
      pnl = 0;
      returnPct = 0;
    }

    trades.push({
      wallet: t.wallet,
      condition_id: t.condition_id,
      outcome_index: Number(t.outcome_index),
      trade_date: t.trade_date,
      entry_price: entryPrice,
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
  console.log("COPY TRADE SIMULATION - LAST 30 DAYS");
  console.log("$1 Per Trade Starting 1 Month Ago");
  console.log("=".repeat(80));
  console.log("");

  const trades = await getTradeResults();

  const resolvedTrades = trades.filter(t => t.is_resolved);
  const unresolvedTrades = trades.filter(t => !t.is_resolved);

  console.log(`Total trades in last 30 days:     ${trades.length.toLocaleString()}`);
  console.log(`  Resolved (have outcome):        ${resolvedTrades.length.toLocaleString()}`);
  console.log(`  Unresolved (still pending):     ${unresolvedTrades.length.toLocaleString()}`);
  console.log("");

  // Daily cumulative tracking
  const dailyStats: Map<string, {
    trades: number;
    resolved: number;
    unresolved: number;
    bet: number;
    return: number;
    wins: number;
    losses: number;
  }> = new Map();

  for (const t of trades) {
    const date = t.trade_date.split(" ")[0];
    const existing = dailyStats.get(date) || {
      trades: 0, resolved: 0, unresolved: 0, bet: 0, return: 0, wins: 0, losses: 0
    };

    existing.trades++;
    existing.bet += t.dollar_bet;

    if (t.is_resolved) {
      existing.resolved++;
      existing.return += t.dollar_return;
      if (t.pnl > 0.01) existing.wins++;
      else if (t.pnl < -0.01) existing.losses++;
    } else {
      existing.unresolved++;
      // Don't count unresolved in returns yet
    }

    dailyStats.set(date, existing);
  }

  const sortedDays = [...dailyStats.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Calculate cumulative returns
  console.log("=".repeat(80));
  console.log("DAY BY DAY RETURNS (Resolved Trades Only)");
  console.log("=".repeat(80));
  console.log("");
  console.log("Date       | Trades | Resolved | Wins | Losses | Daily P/L | Cumulative P/L | Cumulative ROI");
  console.log("-".repeat(100));

  let cumulativeBet = 0;
  let cumulativeReturn = 0;

  for (const [date, data] of sortedDays) {
    const resolvedBet = data.resolved; // $1 per resolved trade
    const dailyPnl = data.return - resolvedBet;

    cumulativeBet += resolvedBet;
    cumulativeReturn += data.return;
    const cumulativePnl = cumulativeReturn - cumulativeBet;
    const cumulativeRoi = cumulativeBet > 0 ? (cumulativePnl / cumulativeBet) * 100 : 0;

    console.log(
      `${date} | ${String(data.trades).padStart(6)} | ${String(data.resolved).padStart(8)} | ${String(data.wins).padStart(4)} | ${String(data.losses).padStart(6)} | $${dailyPnl.toFixed(0).padStart(8)} | $${cumulativePnl.toFixed(0).padStart(13)} | ${cumulativeRoi.toFixed(1).padStart(13)}%`
    );
  }

  console.log("-".repeat(100));

  // Final summary
  const totalBet = resolvedTrades.length;
  const totalReturn = resolvedTrades.reduce((sum, t) => sum + t.dollar_return, 0);
  const totalPnl = totalReturn - totalBet;
  const totalRoi = (totalPnl / totalBet) * 100;

  const wins = resolvedTrades.filter(t => t.pnl > 0.01);
  const losses = resolvedTrades.filter(t => t.pnl < -0.01);

  console.log("");
  console.log("=".repeat(80));
  console.log("30-DAY SUMMARY (Resolved Trades Only)");
  console.log("=".repeat(80));
  console.log("");
  console.log(`  Total Resolved Trades:      ${resolvedTrades.length}`);
  console.log(`  Winning Trades:             ${wins.length} (${((wins.length / resolvedTrades.length) * 100).toFixed(1)}%)`);
  console.log(`  Losing Trades:              ${losses.length} (${((losses.length / resolvedTrades.length) * 100).toFixed(1)}%)`);
  console.log("");
  console.log(`  Capital Deployed:           $${totalBet}`);
  console.log(`  Total Returned:             $${totalReturn.toFixed(2)}`);
  console.log(`  Net Profit/Loss:            $${totalPnl.toFixed(2)}`);
  console.log(`  ROI:                        ${totalRoi.toFixed(1)}%`);

  // Mean returns
  const winReturns = wins.map(t => t.return_pct);
  const lossReturns = losses.map(t => t.return_pct);
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  console.log("");
  console.log("  Mean Win Return:            " + avg(winReturns).toFixed(1) + "%");
  console.log("  Mean Loss Return:           " + avg(lossReturns).toFixed(1) + "%");

  // Per-wallet breakdown
  console.log("");
  console.log("=".repeat(80));
  console.log("PER-WALLET 30-DAY PERFORMANCE");
  console.log("=".repeat(80));
  console.log("");

  const walletStats: Map<string, { trades: number; wins: number; losses: number; bet: number; return: number }> = new Map();

  for (const t of resolvedTrades) {
    const existing = walletStats.get(t.wallet) || { trades: 0, wins: 0, losses: 0, bet: 0, return: 0 };
    existing.trades++;
    existing.bet += t.dollar_bet;
    existing.return += t.dollar_return;
    if (t.pnl > 0.01) existing.wins++;
    else if (t.pnl < -0.01) existing.losses++;
    walletStats.set(t.wallet, existing);
  }

  const walletResults = [...walletStats.entries()]
    .map(([wallet, stats]) => ({
      wallet,
      name: WALLET_NAMES[wallet] || wallet.slice(0, 10),
      ...stats,
      roi: stats.bet > 0 ? ((stats.return - stats.bet) / stats.bet) * 100 : 0,
      winRate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
    }))
    .sort((a, b) => b.roi - a.roi);

  console.log("Wallet              | Trades | Wins | Losses | Win Rate |   P/L   | ROI");
  console.log("-".repeat(80));

  for (const w of walletResults) {
    const pnl = w.return - w.bet;
    console.log(
      `${w.name.padEnd(19)} | ${String(w.trades).padStart(6)} | ${String(w.wins).padStart(4)} | ${String(w.losses).padStart(6)} | ${w.winRate.toFixed(1).padStart(7)}% | $${pnl.toFixed(0).padStart(6)} | ${w.roi.toFixed(1).padStart(6)}%`
    );
  }

  // Pending positions
  console.log("");
  console.log("=".repeat(80));
  console.log("PENDING POSITIONS (Not Yet Resolved)");
  console.log("=".repeat(80));
  console.log("");
  console.log(`  Unresolved Trades:          ${unresolvedTrades.length}`);
  console.log(`  Capital at Risk:            $${unresolvedTrades.length}`);
  console.log("");
  console.log("  These positions are still open and will affect final returns.");

  // Adjusted for execution
  console.log("");
  console.log("=".repeat(80));
  console.log("EXECUTION REALITY CHECK");
  console.log("=".repeat(80));
  console.log("");
  console.log("With 30% edge reduction for slippage:");
  const adjustedRoi = totalRoi * 0.7;
  const adjustedPnl = totalPnl * 0.7;
  console.log(`  Adjusted ROI:               ${adjustedRoi.toFixed(1)}%`);
  console.log(`  Adjusted Net P/L:           $${adjustedPnl.toFixed(0)}`);
}

main().catch(console.error);
