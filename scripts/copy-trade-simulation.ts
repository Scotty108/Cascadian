/**
 * Copy Trade Simulation
 *
 * Simulates $1 equal-weight betting on every position taken by target wallets.
 * Calculates historical performance and expected returns.
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

interface PositionResult {
  wallet: string;
  condition_id: string;
  outcome_index: number;
  first_trade_date: string;
  last_trade_date: string;
  num_trades: number;
  buy_usdc: number;
  buy_tokens: number;
  sell_usdc: number;
  sell_tokens: number;
  avg_entry_price: number;
  net_tokens: number;
  is_resolved: boolean;
  payout: number;
  realized_pnl: number;
  final_pnl: number;
  return_pct: number;
}

interface WalletSummary {
  wallet: string;
  total_positions: number;
  resolved_positions: number;
  winning_positions: number;
  losing_positions: number;
  win_rate: number;
  total_invested: number;
  total_return: number;
  net_pnl: number;
  roi_pct: number;
  avg_position_return_pct: number;
  median_win_pct: number;
  median_loss_pct: number;
}

async function getPositionResults(): Promise<PositionResult[]> {
  const walletList = TARGET_WALLETS.map(w => `'${w.toLowerCase()}'`).join(',');

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
        t.token_amount / 1000000.0 as tokens,
        t.trade_time
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_unified m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) IN (${walletList})
        AND t.is_deleted = 0
    ),
    -- Deduplicated by event_id
    trades_dedup AS (
      SELECT
        event_id,
        any(wallet) as wallet,
        any(condition_id) as condition_id,
        any(outcome_index) as outcome_index,
        any(side) as side,
        any(usdc) as usdc,
        any(tokens) as tokens,
        any(trade_time) as trade_time
      FROM trades
      GROUP BY event_id
    ),
    -- Position-level aggregation
    positions AS (
      SELECT
        t.wallet,
        t.condition_id,
        t.outcome_index,
        min(t.trade_time) as first_trade_date,
        max(t.trade_time) as last_trade_date,
        count(*) as num_trades,
        sumIf(t.usdc, lower(t.side) = 'buy') as buy_usdc,
        sumIf(t.tokens, lower(t.side) = 'buy') as buy_tokens,
        sumIf(t.usdc, lower(t.side) = 'sell') as sell_usdc,
        sumIf(t.tokens, lower(t.side) = 'sell') as sell_tokens,
        -- Net position
        sumIf(t.tokens, lower(t.side) = 'buy') - sumIf(t.tokens, lower(t.side) = 'sell') as net_tokens,
        -- Realized PnL from trading
        sumIf(t.usdc, lower(t.side) = 'sell') - sumIf(t.usdc, lower(t.side) = 'buy') as realized_pnl,
        -- Resolution info
        any(r.payout_numerators) as payout_numerators
      FROM trades_dedup t
      LEFT JOIN pm_condition_resolutions r ON lower(t.condition_id) = lower(r.condition_id)
      GROUP BY t.wallet, t.condition_id, t.outcome_index
    )
    SELECT
      wallet,
      condition_id,
      outcome_index,
      toString(first_trade_date) as first_trade_date,
      toString(last_trade_date) as last_trade_date,
      num_trades,
      coalesce(buy_usdc, 0) as buy_usdc,
      coalesce(buy_tokens, 0) as buy_tokens,
      coalesce(sell_usdc, 0) as sell_usdc,
      coalesce(sell_tokens, 0) as sell_tokens,
      CASE WHEN buy_tokens > 0 THEN buy_usdc / buy_tokens ELSE 0 END as avg_entry_price,
      net_tokens,
      payout_numerators IS NOT NULL AND payout_numerators != '' AND length(payout_numerators) > 2 as is_resolved,
      CASE
        WHEN payout_numerators IS NOT NULL AND payout_numerators != '' AND length(payout_numerators) > 2
        THEN JSONExtractInt(payout_numerators, outcome_index + 1)
        ELSE 0
      END as payout,
      realized_pnl,
      realized_pnl + (
        CASE
          WHEN payout_numerators IS NOT NULL AND payout_numerators != '' AND length(payout_numerators) > 2
          THEN net_tokens * JSONExtractInt(payout_numerators, outcome_index + 1)
          ELSE 0
        END
      ) as final_pnl,
      CASE
        WHEN buy_usdc > 0.01 AND net_tokens >= 0
        THEN (realized_pnl + (
          CASE
            WHEN payout_numerators IS NOT NULL AND payout_numerators != '' AND length(payout_numerators) > 2
            THEN net_tokens * JSONExtractInt(payout_numerators, outcome_index + 1)
            ELSE 0
          END
        )) / buy_usdc
        ELSE 0
      END as return_pct
    FROM positions
    WHERE buy_usdc > 0.01  -- Only positions where they bought (not pure shorts)
  `;

  const result = await clickhouse.query({
    query,
    format: "JSONEachRow",
    clickhouse_settings: { max_execution_time: 300 },
  });

  return result.json<PositionResult>();
}

function computeWalletSummary(positions: PositionResult[], wallet: string): WalletSummary {
  const walletPositions = positions.filter(p => p.wallet.toLowerCase() === wallet.toLowerCase());

  // Only count resolved positions for win/loss stats
  const resolved = walletPositions.filter(p => p.is_resolved);
  const wins = resolved.filter(p => Number(p.final_pnl) > 0.01);
  const losses = resolved.filter(p => Number(p.final_pnl) < -0.01);

  // Get return percentages for median calculation
  const winReturns = wins.map(p => Number(p.return_pct) * 100).sort((a, b) => a - b);
  const lossReturns = losses.map(p => Number(p.return_pct) * 100).sort((a, b) => a - b);

  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  };

  // Simulate $1 bet on each position
  const simulatedResults = resolved.map(p => {
    const returnPct = Number(p.return_pct);
    return returnPct; // Return on $1 bet
  });

  const totalInvested = resolved.length; // $1 per position
  const totalReturn = simulatedResults.reduce((sum, r) => sum + (1 + r), 0);
  const netPnl = totalReturn - totalInvested;

  return {
    wallet: wallet.slice(0, 10) + "...",
    total_positions: walletPositions.length,
    resolved_positions: resolved.length,
    winning_positions: wins.length,
    losing_positions: losses.length,
    win_rate: resolved.length > 0 ? wins.length / resolved.length : 0,
    total_invested: totalInvested,
    total_return: totalReturn,
    net_pnl: netPnl,
    roi_pct: totalInvested > 0 ? (netPnl / totalInvested) * 100 : 0,
    avg_position_return_pct: simulatedResults.length > 0
      ? (simulatedResults.reduce((a, b) => a + b, 0) / simulatedResults.length) * 100
      : 0,
    median_win_pct: median(winReturns),
    median_loss_pct: median(lossReturns),
  };
}

async function main() {
  console.log("=" .repeat(80));
  console.log("COPY TRADE SIMULATION - $1 Equal Weight Per Position");
  console.log("=" .repeat(80));
  console.log("");

  console.log("Fetching position data for 12 target wallets...");
  const positions = await getPositionResults();
  console.log(`Found ${positions.length} total positions\n`);

  // Per-wallet analysis
  console.log("-".repeat(80));
  console.log("PER-WALLET RESULTS (Resolved Positions Only)");
  console.log("-".repeat(80));
  console.log("");

  const summaries: WalletSummary[] = [];

  for (const wallet of TARGET_WALLETS) {
    const summary = computeWalletSummary(positions, wallet);
    summaries.push(summary);
  }

  // Sort by ROI
  summaries.sort((a, b) => b.roi_pct - a.roi_pct);

  console.log("Wallet      | Positions | Wins | Losses | Win Rate | $1/pos ROI | Med Win% | Med Loss%");
  console.log("-".repeat(95));

  for (const s of summaries) {
    console.log(
      `${s.wallet} | ${String(s.resolved_positions).padStart(9)} | ${String(s.winning_positions).padStart(4)} | ${String(s.losing_positions).padStart(6)} | ${(s.win_rate * 100).toFixed(1).padStart(7)}% | ${s.roi_pct.toFixed(1).padStart(9)}% | ${s.median_win_pct.toFixed(1).padStart(7)}% | ${s.median_loss_pct.toFixed(1).padStart(8)}%`
    );
  }

  // Portfolio simulation
  console.log("\n");
  console.log("=".repeat(80));
  console.log("PORTFOLIO SIMULATION - Equal $1 on ALL Positions from ALL Wallets");
  console.log("=".repeat(80));
  console.log("");

  // Get all resolved positions
  const allResolved = positions.filter(p => p.is_resolved && Number(p.buy_usdc) > 0.01 && Number(p.net_tokens) >= 0);
  const allWins = allResolved.filter(p => Number(p.final_pnl) > 0.01);
  const allLosses = allResolved.filter(p => Number(p.final_pnl) < -0.01);

  // Simulate $1 per position
  let totalBet = 0;
  let totalReturn = 0;
  const dailyReturns: Map<string, { bet: number; return: number }> = new Map();

  for (const p of allResolved) {
    const returnPct = Number(p.return_pct);
    const betAmount = 1;
    const returnAmount = betAmount * (1 + returnPct);

    totalBet += betAmount;
    totalReturn += returnAmount;

    // Track by first trade date
    const date = p.first_trade_date.split(" ")[0];
    const existing = dailyReturns.get(date) || { bet: 0, return: 0 };
    existing.bet += betAmount;
    existing.return += returnAmount;
    dailyReturns.set(date, existing);
  }

  const netPnl = totalReturn - totalBet;
  const overallRoi = (netPnl / totalBet) * 100;

  console.log("Summary Statistics:");
  console.log(`  Total Positions Copied:     ${allResolved.length.toLocaleString()}`);
  console.log(`  Winning Positions:          ${allWins.length.toLocaleString()} (${((allWins.length / allResolved.length) * 100).toFixed(1)}%)`);
  console.log(`  Losing Positions:           ${allLosses.length.toLocaleString()} (${((allLosses.length / allResolved.length) * 100).toFixed(1)}%)`);
  console.log("");
  console.log(`  Total Capital Deployed:     $${totalBet.toLocaleString()}`);
  console.log(`  Total Value Returned:       $${totalReturn.toFixed(2).toLocaleString()}`);
  console.log(`  Net Profit/Loss:            $${netPnl.toFixed(2).toLocaleString()}`);
  console.log(`  Overall ROI:                ${overallRoi.toFixed(1)}%`);

  // Calculate per-position stats
  const returns = allResolved.map(p => Number(p.return_pct) * 100);
  const winReturns = allWins.map(p => Number(p.return_pct) * 100);
  const lossReturns = allLosses.map(p => Number(p.return_pct) * 100);

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  console.log("");
  console.log("Per-Position Return Distribution:");
  console.log(`  Mean Return (all):          ${avg(returns).toFixed(1)}%`);
  console.log(`  Median Return (all):        ${median(returns).toFixed(1)}%`);
  console.log(`  Mean Win Return:            ${avg(winReturns).toFixed(1)}%`);
  console.log(`  Median Win Return:          ${median(winReturns).toFixed(1)}%`);
  console.log(`  Mean Loss Return:           ${avg(lossReturns).toFixed(1)}%`);
  console.log(`  Median Loss Return:         ${median(lossReturns).toFixed(1)}%`);

  // Time-based analysis
  const sortedDates = [...dailyReturns.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const recentDays = sortedDates.slice(-30);

  console.log("");
  console.log("=".repeat(80));
  console.log("LAST 30 DAYS PERFORMANCE (by position entry date)");
  console.log("=".repeat(80));
  console.log("");
  console.log("Date       | Positions | Bet    | Return  | Net P/L  | Daily ROI");
  console.log("-".repeat(70));

  let runningPnl = 0;
  for (const [date, data] of recentDays) {
    const dailyPnl = data.return - data.bet;
    const dailyRoi = (dailyPnl / data.bet) * 100;
    runningPnl += dailyPnl;
    console.log(
      `${date} | ${String(Math.round(data.bet)).padStart(9)} | $${data.bet.toFixed(0).padStart(5)} | $${data.return.toFixed(0).padStart(6)} | $${dailyPnl.toFixed(0).padStart(7)} | ${dailyRoi.toFixed(1).padStart(8)}%`
    );
  }

  console.log("-".repeat(70));
  const last30Bet = recentDays.reduce((sum, [_, d]) => sum + d.bet, 0);
  const last30Return = recentDays.reduce((sum, [_, d]) => sum + d.return, 0);
  const last30Pnl = last30Return - last30Bet;
  console.log(
    `TOTAL      | ${String(Math.round(last30Bet)).padStart(9)} | $${last30Bet.toFixed(0).padStart(5)} | $${last30Return.toFixed(0).padStart(6)} | $${last30Pnl.toFixed(0).padStart(7)} | ${((last30Pnl / last30Bet) * 100).toFixed(1).padStart(8)}%`
  );

  // Risk analysis
  console.log("");
  console.log("=".repeat(80));
  console.log("RISK ANALYSIS");
  console.log("=".repeat(80));
  console.log("");

  // Max drawdown (simplified - consecutive losing days)
  let maxDrawdown = 0;
  let currentDrawdown = 0;
  for (const [_, data] of sortedDates) {
    const dailyPnl = data.return - data.bet;
    if (dailyPnl < 0) {
      currentDrawdown += dailyPnl;
      maxDrawdown = Math.min(maxDrawdown, currentDrawdown);
    } else {
      currentDrawdown = 0;
    }
  }

  // Worst single day
  const worstDay = sortedDates.reduce((worst, [date, data]) => {
    const pnl = data.return - data.bet;
    return pnl < worst.pnl ? { date, pnl } : worst;
  }, { date: "", pnl: 0 });

  // Best single day
  const bestDay = sortedDates.reduce((best, [date, data]) => {
    const pnl = data.return - data.bet;
    return pnl > best.pnl ? { date, pnl } : best;
  }, { date: "", pnl: 0 });

  // Win rate by day
  const winningDays = sortedDates.filter(([_, d]) => d.return > d.bet).length;
  const losingDays = sortedDates.filter(([_, d]) => d.return < d.bet).length;

  console.log(`  Trading Days:               ${sortedDates.length}`);
  console.log(`  Winning Days:               ${winningDays} (${((winningDays / sortedDates.length) * 100).toFixed(1)}%)`);
  console.log(`  Losing Days:                ${losingDays} (${((losingDays / sortedDates.length) * 100).toFixed(1)}%)`);
  console.log(`  Best Day:                   ${bestDay.date} (+$${bestDay.pnl.toFixed(0)})`);
  console.log(`  Worst Day:                  ${worstDay.date} ($${worstDay.pnl.toFixed(0)})`);
  console.log(`  Max Consecutive Drawdown:   $${maxDrawdown.toFixed(0)}`);

  // Reality check warnings
  console.log("");
  console.log("=".repeat(80));
  console.log("REALITY CHECK - Execution Considerations");
  console.log("=".repeat(80));
  console.log("");
  console.log("This simulation assumes PERFECT execution at their exact prices.");
  console.log("In reality, you should expect:");
  console.log("");
  console.log("  1. SLIPPAGE: Entry prices 5-20% worse than theirs");
  console.log("  2. TIMING: Missing fast-moving opportunities");
  console.log("  3. FEES: Gas costs on each transaction");
  console.log("  4. MINIMUMS: Some markets have minimum trade sizes");
  console.log("");
  console.log("Adjusted expectations (with 30% edge reduction for execution):");
  const adjustedRoi = overallRoi * 0.7;
  const adjustedNetPnl = netPnl * 0.7;
  console.log(`  Adjusted ROI:               ${adjustedRoi.toFixed(1)}%`);
  console.log(`  Adjusted Net P/L:           $${adjustedNetPnl.toFixed(0)}`);
}

main().catch(console.error);
