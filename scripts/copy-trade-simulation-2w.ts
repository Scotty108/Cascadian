/**
 * Copy Trade Simulation - LAST 2 WEEKS
 * $100 Bankroll, $1 Flat Per Trade
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

const STARTING_BANKROLL = 100;
const BET_SIZE = 1;

interface Trade {
  wallet: string;
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  entry_price: number;
  is_resolved: boolean;
  payout: number;
}

async function getTrades(): Promise<Trade[]> {
  const walletList = TARGET_WALLETS.map(w => `'${w.toLowerCase()}'`).join(',');

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
        AND t.trade_time >= now() - INTERVAL 14 DAY
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
      toString(t.trade_time) as trade_time,
      CASE WHEN t.tokens > 0 THEN t.usdc / t.tokens ELSE 0 END as entry_price,
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

  return result.json<Trade>();
}

async function main() {
  console.log("=".repeat(80));
  console.log("COPY TRADE SIMULATION - LAST 2 WEEKS");
  console.log(`Starting Bankroll: $${STARTING_BANKROLL} | Bet Size: $${BET_SIZE} flat per trade`);
  console.log("=".repeat(80));
  console.log("");

  const trades = await getTrades();

  const resolved = trades.filter(t => t.is_resolved && Number(t.payout) >= 0);
  const unresolved = trades.filter(t => !t.is_resolved || Number(t.payout) < 0);

  console.log(`Total trades in last 2 weeks:     ${trades.length.toLocaleString()}`);
  console.log(`  Resolved:                       ${resolved.length.toLocaleString()}`);
  console.log(`  Unresolved (pending):           ${unresolved.length.toLocaleString()}`);
  console.log("");

  // Simulate trade by trade with bankroll tracking
  let bankroll = STARTING_BANKROLL;
  let peakBankroll = STARTING_BANKROLL;
  let maxDrawdown = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalBet = 0;
  let totalReturned = 0;

  const dailyStats: Map<string, {
    startBankroll: number;
    endBankroll: number;
    trades: number;
    wins: number;
    losses: number;
    pnl: number;
  }> = new Map();

  // Per-wallet tracking
  const walletStats: Map<string, { trades: number; wins: number; losses: number; pnl: number }> = new Map();
  for (const w of TARGET_WALLETS) {
    walletStats.set(w.toLowerCase(), { trades: 0, wins: 0, losses: 0, pnl: 0 });
  }

  let currentDate = "";
  let dayStartBankroll = bankroll;

  for (const trade of resolved) {
    const date = trade.trade_time.split(" ")[0];
    const entryPrice = Number(trade.entry_price);
    const payout = Number(trade.payout);

    if (entryPrice <= 0) continue;

    // New day - save previous day stats
    if (date !== currentDate) {
      if (currentDate !== "") {
        const dayStats = dailyStats.get(currentDate);
        if (dayStats) {
          dayStats.endBankroll = bankroll;
        }
      }
      currentDate = date;
      dayStartBankroll = bankroll;
      dailyStats.set(date, {
        startBankroll: bankroll,
        endBankroll: bankroll,
        trades: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
      });
    }

    // Execute trade
    const tokensBought = BET_SIZE / entryPrice;
    const returnAmount = tokensBought * payout;
    const pnl = returnAmount - BET_SIZE;

    bankroll += pnl;
    totalBet += BET_SIZE;
    totalReturned += returnAmount;

    // Track peak and drawdown
    if (bankroll > peakBankroll) {
      peakBankroll = bankroll;
    }
    const drawdown = (peakBankroll - bankroll) / peakBankroll * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }

    // Update daily stats
    const dayStats = dailyStats.get(date)!;
    dayStats.trades++;
    dayStats.pnl += pnl;
    dayStats.endBankroll = bankroll;

    // Update wallet stats
    const wStats = walletStats.get(trade.wallet)!;
    wStats.trades++;
    wStats.pnl += pnl;

    if (pnl > 0.01) {
      totalWins++;
      dayStats.wins++;
      wStats.wins++;
    } else if (pnl < -0.01) {
      totalLosses++;
      dayStats.losses++;
      wStats.losses++;
    }
  }

  // Finalize last day
  if (currentDate !== "") {
    const dayStats = dailyStats.get(currentDate);
    if (dayStats) {
      dayStats.endBankroll = bankroll;
    }
  }

  // Display results
  console.log("=".repeat(80));
  console.log("BANKROLL PROGRESSION (Day by Day)");
  console.log("=".repeat(80));
  console.log("");
  console.log("Date       | Start    | Trades | Wins | Losses | Day P/L  | End      | Growth");
  console.log("-".repeat(90));

  const sortedDays = [...dailyStats.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [date, stats] of sortedDays) {
    const growth = ((stats.endBankroll - stats.startBankroll) / stats.startBankroll * 100);
    console.log(
      `${date} | $${stats.startBankroll.toFixed(0).padStart(7)} | ${String(stats.trades).padStart(6)} | ${String(stats.wins).padStart(4)} | ${String(stats.losses).padStart(6)} | $${stats.pnl.toFixed(0).padStart(7)} | $${stats.endBankroll.toFixed(0).padStart(7)} | ${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`
    );
  }

  console.log("-".repeat(90));

  // Final summary
  const totalPnl = bankroll - STARTING_BANKROLL;
  const totalRoi = (totalPnl / STARTING_BANKROLL) * 100;
  const winRate = (totalWins / (totalWins + totalLosses)) * 100;

  console.log("");
  console.log("=".repeat(80));
  console.log("2-WEEK SUMMARY");
  console.log("=".repeat(80));
  console.log("");
  console.log(`  Starting Bankroll:          $${STARTING_BANKROLL}`);
  console.log(`  Ending Bankroll:            $${bankroll.toFixed(2)}`);
  console.log(`  Net Profit/Loss:            $${totalPnl.toFixed(2)}`);
  console.log(`  Total ROI:                  ${totalRoi.toFixed(1)}%`);
  console.log("");
  console.log(`  Total Trades:               ${totalWins + totalLosses}`);
  console.log(`  Wins:                       ${totalWins} (${winRate.toFixed(1)}%)`);
  console.log(`  Losses:                     ${totalLosses} (${(100 - winRate).toFixed(1)}%)`);
  console.log("");
  console.log(`  Peak Bankroll:              $${peakBankroll.toFixed(2)}`);
  console.log(`  Max Drawdown:               ${maxDrawdown.toFixed(1)}%`);
  console.log("");
  console.log(`  Capital Deployed:           $${totalBet.toFixed(0)} (${(totalBet / STARTING_BANKROLL).toFixed(1)}x bankroll)`);

  // Per-wallet performance
  console.log("");
  console.log("=".repeat(80));
  console.log("PER-WALLET 2-WEEK PERFORMANCE");
  console.log("=".repeat(80));
  console.log("");

  const walletResults = [...walletStats.entries()]
    .map(([wallet, stats]) => ({
      wallet,
      name: WALLET_NAMES[wallet] || wallet.slice(0, 10),
      ...stats,
      roi: stats.trades > 0 ? (stats.pnl / stats.trades) * 100 : 0,
      winRate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
    }))
    .sort((a, b) => b.pnl - a.pnl);

  console.log("Wallet              | Trades | Wins | Losses | Win Rate |    P/L   | ROI/Trade");
  console.log("-".repeat(85));

  for (const w of walletResults) {
    console.log(
      `${w.name.padEnd(19)} | ${String(w.trades).padStart(6)} | ${String(w.wins).padStart(4)} | ${String(w.losses).padStart(6)} | ${w.winRate.toFixed(1).padStart(7)}% | $${w.pnl.toFixed(0).padStart(7)} | ${w.roi.toFixed(1).padStart(8)}%`
    );
  }

  // Pending positions warning
  console.log("");
  console.log("=".repeat(80));
  console.log("PENDING POSITIONS");
  console.log("=".repeat(80));
  console.log("");
  console.log(`  Unresolved Trades:          ${unresolved.length}`);
  console.log(`  Capital at Risk:            $${unresolved.length * BET_SIZE}`);

  // What-if with slippage
  console.log("");
  console.log("=".repeat(80));
  console.log("REALITY CHECK (30% Edge Reduction)");
  console.log("=".repeat(80));
  console.log("");
  const adjustedPnl = totalPnl * 0.7;
  const adjustedEndBankroll = STARTING_BANKROLL + adjustedPnl;
  const adjustedRoi = (adjustedPnl / STARTING_BANKROLL) * 100;
  console.log(`  Adjusted Net P/L:           $${adjustedPnl.toFixed(0)}`);
  console.log(`  Adjusted End Bankroll:      $${adjustedEndBankroll.toFixed(0)}`);
  console.log(`  Adjusted ROI:               ${adjustedRoi.toFixed(1)}%`);
}

main().catch(console.error);
