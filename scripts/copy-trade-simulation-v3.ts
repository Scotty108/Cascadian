/**
 * Copy Trade Simulation V3 - COMPLETE
 *
 * Handles BOTH strategies:
 * 1. BUY → SELL (scalpers who exit before resolution)
 * 2. BUY → RESOLUTION (holders who wait for payout)
 *
 * Uses FIFO matching: sells cover oldest buys first
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
const LOOKBACK_DAYS = 14;

interface Trade {
  wallet: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  trade_time: string;
  usdc: number;
  tokens: number;
  price: number;
}

interface Resolution {
  condition_id: string;
  payout_numerators: string;
}

async function getTrades(): Promise<Trade[]> {
  const walletList = TARGET_WALLETS.map(w => `'${w.toLowerCase()}'`).join(',');

  const query = `
    WITH
    all_trades AS (
      SELECT
        t.event_id,
        lower(t.trader_wallet) as wallet,
        m.condition_id,
        m.outcome_index,
        lower(t.side) as side,
        t.trade_time,
        t.usdc_amount / 1000000.0 as usdc,
        t.token_amount / 1000000.0 as tokens
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_unified m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) IN (${walletList})
        AND t.is_deleted = 0
        AND t.trade_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
    ),
    trades_dedup AS (
      SELECT
        event_id,
        any(wallet) as wallet,
        any(condition_id) as condition_id,
        any(outcome_index) as outcome_index,
        any(side) as side,
        any(trade_time) as trade_time,
        any(usdc) as usdc,
        any(tokens) as tokens
      FROM all_trades
      GROUP BY event_id
    )
    SELECT
      wallet,
      condition_id,
      outcome_index,
      side,
      toString(trade_time) as trade_time,
      usdc,
      tokens,
      CASE WHEN tokens > 0 THEN usdc / tokens ELSE 0 END as price
    FROM trades_dedup
    WHERE tokens > 0 AND usdc > 0
    ORDER BY trade_time ASC
  `;

  const result = await clickhouse.query({
    query,
    format: "JSONEachRow",
    clickhouse_settings: { max_execution_time: 300 },
  });

  return result.json<Trade>();
}

async function getResolutions(): Promise<Map<string, number[]>> {
  const query = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE payout_numerators IS NOT NULL AND payout_numerators != '' AND length(payout_numerators) > 2
  `;

  const result = await clickhouse.query({
    query,
    format: "JSONEachRow",
  });

  const rows = await result.json<Resolution>();
  const map = new Map<string, number[]>();

  for (const row of rows) {
    try {
      const payouts = JSON.parse(row.payout_numerators);
      map.set(row.condition_id.toLowerCase(), payouts);
    } catch {}
  }

  return map;
}

interface SimulatedTrade {
  wallet: string;
  date: string;
  type: 'buy' | 'sell_exit' | 'resolution';
  betAmount: number;
  returnAmount: number;
  pnl: number;
  description: string;
}

async function main() {
  console.log("=".repeat(80));
  console.log("COPY TRADE SIMULATION V3 - COMPLETE (BUY→SELL + BUY→RESOLUTION)");
  console.log(`Starting Bankroll: $${STARTING_BANKROLL} | Bet Size: $${BET_SIZE} | Lookback: ${LOOKBACK_DAYS} days`);
  console.log("=".repeat(80));
  console.log("");

  const trades = await getTrades();
  const resolutions = await getResolutions();

  console.log(`Total trades in last ${LOOKBACK_DAYS} days: ${trades.length.toLocaleString()}`);
  console.log(`Resolutions loaded: ${resolutions.size.toLocaleString()}`);
  console.log("");

  // Group trades by wallet + position
  const positions: Map<string, Trade[]> = new Map();

  for (const t of trades) {
    const key = `${t.wallet}|${t.condition_id}|${t.outcome_index}`;
    const existing = positions.get(key) || [];
    existing.push(t);
    positions.set(key, existing);
  }

  // Process each position with FIFO matching
  const simulatedTrades: SimulatedTrade[] = [];
  const walletStats: Map<string, {
    trades: number;
    scalpWins: number;
    scalpLosses: number;
    holdWins: number;
    holdLosses: number;
    pending: number;
    pnl: number;
  }> = new Map();

  for (const w of TARGET_WALLETS) {
    walletStats.set(w.toLowerCase(), {
      trades: 0, scalpWins: 0, scalpLosses: 0, holdWins: 0, holdLosses: 0, pending: 0, pnl: 0
    });
  }

  for (const [key, posTrades] of positions) {
    const [wallet, conditionId, outcomeIdx] = key.split('|');
    const outcomeIndex = parseInt(outcomeIdx);
    const wStats = walletStats.get(wallet)!;

    // Separate buys and sells, sorted by time
    const buys = posTrades.filter(t => t.side === 'buy').sort((a, b) => a.trade_time.localeCompare(b.trade_time));
    const sells = posTrades.filter(t => t.side === 'sell').sort((a, b) => a.trade_time.localeCompare(b.trade_time));

    // For each BUY, simulate $1 bet and track what happens
    interface BuyLot {
      trade: Trade;
      tokensRemaining: number;  // How many tokens from this buy are still held
      entryPrice: number;
      betAmount: number;  // Our $1 bet
      tokensFromBet: number;  // Tokens we bought with $1
    }

    const buyLots: BuyLot[] = buys.map(t => ({
      trade: t,
      tokensRemaining: t.tokens,
      entryPrice: Number(t.price),
      betAmount: BET_SIZE,
      tokensFromBet: BET_SIZE / Number(t.price),
    }));

    // Process sells with FIFO
    let sellIdx = 0;
    let sellTokensRemaining = sells.length > 0 ? Number(sells[0].tokens) : 0;

    for (const lot of buyLots) {
      let ourTokensRemaining = lot.tokensFromBet;

      // Match sells to this buy lot
      while (ourTokensRemaining > 0.0001 && sellIdx < sells.length) {
        const sell = sells[sellIdx];
        const sellPrice = Number(sell.usdc) / Number(sell.tokens);

        // How much of this sell applies to our tokens?
        const theirTokensRemaining = lot.tokensRemaining;
        const ourProportion = ourTokensRemaining / theirTokensRemaining;

        if (sellTokensRemaining <= 0.0001) {
          sellIdx++;
          if (sellIdx < sells.length) {
            sellTokensRemaining = Number(sells[sellIdx].tokens);
          }
          continue;
        }

        // Calculate tokens sold from our position
        const tokensSold = Math.min(ourTokensRemaining, sellTokensRemaining * ourProportion);
        const usdcReceived = tokensSold * sellPrice;
        const costBasis = tokensSold * lot.entryPrice;
        const pnl = usdcReceived - costBasis;

        ourTokensRemaining -= tokensSold;
        lot.tokensRemaining -= tokensSold / ourProportion * (lot.tokensRemaining / lot.tokensFromBet) * lot.tokensFromBet;
        sellTokensRemaining -= tokensSold / ourProportion;

        // Record this scalp trade
        simulatedTrades.push({
          wallet,
          date: sell.trade_time.split(' ')[0],
          type: 'sell_exit',
          betAmount: costBasis,
          returnAmount: usdcReceived,
          pnl,
          description: `Scalp: bought@${lot.entryPrice.toFixed(3)} sold@${sellPrice.toFixed(3)}`,
        });

        wStats.trades++;
        wStats.pnl += pnl;
        if (pnl > 0.001) wStats.scalpWins++;
        else if (pnl < -0.001) wStats.scalpLosses++;

        if (sellTokensRemaining <= 0.0001) {
          sellIdx++;
          if (sellIdx < sells.length) {
            sellTokensRemaining = Number(sells[sellIdx].tokens);
          }
        }
      }

      // Any remaining tokens go to resolution
      if (ourTokensRemaining > 0.0001) {
        const payouts = resolutions.get(conditionId.toLowerCase());
        const costBasis = ourTokensRemaining * lot.entryPrice;

        if (payouts && payouts[outcomeIndex] !== undefined) {
          const payout = payouts[outcomeIndex];
          const returnAmount = ourTokensRemaining * payout;
          const pnl = returnAmount - costBasis;

          simulatedTrades.push({
            wallet,
            date: lot.trade.trade_time.split(' ')[0],
            type: 'resolution',
            betAmount: costBasis,
            returnAmount,
            pnl,
            description: `Hold: bought@${lot.entryPrice.toFixed(3)} resolved@${payout}`,
          });

          wStats.trades++;
          wStats.pnl += pnl;
          if (pnl > 0.001) wStats.holdWins++;
          else if (pnl < -0.001) wStats.holdLosses++;
        } else {
          // Still pending
          wStats.pending++;
          simulatedTrades.push({
            wallet,
            date: lot.trade.trade_time.split(' ')[0],
            type: 'buy',
            betAmount: costBasis,
            returnAmount: costBasis, // Assume breakeven for pending
            pnl: 0,
            description: `Pending: bought@${lot.entryPrice.toFixed(3)}`,
          });
        }
      }
    }
  }

  // Calculate totals
  const resolvedTrades = simulatedTrades.filter(t => t.type !== 'buy');
  const scalpTrades = simulatedTrades.filter(t => t.type === 'sell_exit');
  const holdTrades = simulatedTrades.filter(t => t.type === 'resolution');
  const pendingTrades = simulatedTrades.filter(t => t.type === 'buy');

  const totalPnl = resolvedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalBet = resolvedTrades.reduce((sum, t) => sum + t.betAmount, 0);

  const scalpPnl = scalpTrades.reduce((sum, t) => sum + t.pnl, 0);
  const scalpBet = scalpTrades.reduce((sum, t) => sum + t.betAmount, 0);
  const scalpWins = scalpTrades.filter(t => t.pnl > 0.001).length;
  const scalpLosses = scalpTrades.filter(t => t.pnl < -0.001).length;

  const holdPnl = holdTrades.reduce((sum, t) => sum + t.pnl, 0);
  const holdBet = holdTrades.reduce((sum, t) => sum + t.betAmount, 0);
  const holdWins = holdTrades.filter(t => t.pnl > 0.001).length;
  const holdLosses = holdTrades.filter(t => t.pnl < -0.001).length;

  console.log("=".repeat(80));
  console.log("STRATEGY BREAKDOWN");
  console.log("=".repeat(80));
  console.log("");
  console.log("SCALP TRADES (BUY → SELL before resolution):");
  console.log(`  Trades:        ${scalpTrades.length}`);
  console.log(`  Wins:          ${scalpWins} (${scalpTrades.length > 0 ? ((scalpWins/scalpTrades.length)*100).toFixed(1) : 0}%)`);
  console.log(`  Losses:        ${scalpLosses} (${scalpTrades.length > 0 ? ((scalpLosses/scalpTrades.length)*100).toFixed(1) : 0}%)`);
  console.log(`  Capital Used:  $${scalpBet.toFixed(2)}`);
  console.log(`  P/L:           $${scalpPnl.toFixed(2)}`);
  console.log(`  ROI:           ${scalpBet > 0 ? ((scalpPnl/scalpBet)*100).toFixed(1) : 0}%`);
  console.log("");
  console.log("HOLD TRADES (BUY → RESOLUTION):");
  console.log(`  Trades:        ${holdTrades.length}`);
  console.log(`  Wins:          ${holdWins} (${holdTrades.length > 0 ? ((holdWins/holdTrades.length)*100).toFixed(1) : 0}%)`);
  console.log(`  Losses:        ${holdLosses} (${holdTrades.length > 0 ? ((holdLosses/holdTrades.length)*100).toFixed(1) : 0}%)`);
  console.log(`  Capital Used:  $${holdBet.toFixed(2)}`);
  console.log(`  P/L:           $${holdPnl.toFixed(2)}`);
  console.log(`  ROI:           ${holdBet > 0 ? ((holdPnl/holdBet)*100).toFixed(1) : 0}%`);
  console.log("");
  console.log("PENDING (not yet resolved or sold):");
  console.log(`  Positions:     ${pendingTrades.length}`);
  console.log(`  Capital:       $${pendingTrades.reduce((s,t) => s + t.betAmount, 0).toFixed(2)}`);

  // Per-wallet breakdown
  console.log("");
  console.log("=".repeat(80));
  console.log("PER-WALLET PERFORMANCE");
  console.log("=".repeat(80));
  console.log("");
  console.log("Wallet              | Scalp W/L | Hold W/L | Pending |    P/L   | Strategy");
  console.log("-".repeat(85));

  const walletResults = [...walletStats.entries()]
    .map(([wallet, stats]) => ({
      wallet,
      name: WALLET_NAMES[wallet] || wallet.slice(0, 10),
      ...stats,
    }))
    .sort((a, b) => b.pnl - a.pnl);

  for (const w of walletResults) {
    const scalpRatio = w.scalpWins + w.scalpLosses;
    const holdRatio = w.holdWins + w.holdLosses;
    const strategy = scalpRatio > holdRatio * 2 ? "Scalper" :
                     holdRatio > scalpRatio * 2 ? "Holder" : "Mixed";
    console.log(
      `${w.name.padEnd(19)} | ${String(w.scalpWins).padStart(4)}/${String(w.scalpLosses).padEnd(4)} | ${String(w.holdWins).padStart(3)}/${String(w.holdLosses).padEnd(4)} | ${String(w.pending).padStart(7)} | $${w.pnl.toFixed(0).padStart(7)} | ${strategy}`
    );
  }

  // Daily progression
  console.log("");
  console.log("=".repeat(80));
  console.log("BANKROLL PROGRESSION");
  console.log("=".repeat(80));
  console.log("");

  const dailyPnl: Map<string, number> = new Map();
  for (const t of resolvedTrades) {
    const existing = dailyPnl.get(t.date) || 0;
    dailyPnl.set(t.date, existing + t.pnl);
  }

  const sortedDays = [...dailyPnl.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let bankroll = STARTING_BANKROLL;

  console.log("Date       | Day P/L  | Bankroll | Growth");
  console.log("-".repeat(50));

  for (const [date, pnl] of sortedDays) {
    const prevBankroll = bankroll;
    bankroll += pnl;
    const growth = ((bankroll - prevBankroll) / prevBankroll * 100);
    console.log(
      `${date} | $${pnl.toFixed(0).padStart(7)} | $${bankroll.toFixed(0).padStart(7)} | ${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`
    );
  }

  // Final summary
  console.log("");
  console.log("=".repeat(80));
  console.log("FINAL SUMMARY");
  console.log("=".repeat(80));
  console.log("");
  console.log(`  Starting Bankroll:      $${STARTING_BANKROLL}`);
  console.log(`  Ending Bankroll:        $${bankroll.toFixed(2)}`);
  console.log(`  Net Profit:             $${(bankroll - STARTING_BANKROLL).toFixed(2)}`);
  console.log(`  ROI:                    ${((bankroll - STARTING_BANKROLL) / STARTING_BANKROLL * 100).toFixed(1)}%`);
  console.log("");
  console.log("  With 30% slippage adjustment:");
  const adjPnl = (bankroll - STARTING_BANKROLL) * 0.7;
  console.log(`  Adjusted P/L:           $${adjPnl.toFixed(0)}`);
  console.log(`  Adjusted Bankroll:      $${(STARTING_BANKROLL + adjPnl).toFixed(0)}`);
}

main().catch(console.error);
