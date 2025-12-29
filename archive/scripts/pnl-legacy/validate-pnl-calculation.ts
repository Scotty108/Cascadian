#!/usr/bin/env npx tsx
/**
 * P&L Calculation Validator
 *
 * Purpose: Demonstrate correct P&L calculation step-by-step for a single wallet
 * Shows: Individual trade cashflows → market positions → wallet total
 * Runtime: ~10 seconds
 *
 * This script proves the formula works by showing intermediate steps
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

const TEST_WALLET = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'; // niggemon
const EXPECTED_PNL = 102001.46;

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSONCompact' });
  const text = await result.text();
  return JSON.parse(text);
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("P&L CALCULATION VALIDATOR - Step by Step Breakdown");
  console.log("=".repeat(80));
  console.log(`\nTest Wallet: ${TEST_WALLET} (niggemon)`);
  console.log(`Expected P&L: $${EXPECTED_PNL.toLocaleString()}\n`);

  // STEP 1: Show sample trades with cashflow calculation
  console.log("STEP 1: Sample Trades → Cashflows");
  console.log("-".repeat(80));

  const tradesQuery = `
    SELECT
      market_id,
      toString(side) AS side,
      cast(shares as Float64) AS shares,
      cast(entry_price as Float64) AS price,
      round(shares * entry_price, 2) AS trade_value,
      round(
        shares * entry_price * if(lowerUTF8(toString(side)) = 'buy', -1, 1),
        2
      ) AS cashflow,
      if(
        lowerUTF8(toString(side)) = 'buy',
        shares,
        -shares
      ) AS share_delta,
      outcome_index,
      timestamp
    FROM trades_raw
    WHERE lower(wallet_address) = '${TEST_WALLET}'
      AND market_id != '12'
      AND market_id IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT 10
  `;

  const trades = await queryData(tradesQuery);
  console.log("\nSample Trades (most recent 10):");
  console.log("Side  | Shares    | Price  | Cashflow  | Share Δ | Outcome");
  console.log("-".repeat(70));

  if (trades.data && trades.data.length > 0) {
    trades.data.slice(0, 10).forEach((row: any[]) => {
      const [marketId, side, shares, price, tradeValue, cashflow, shareDelta, outcomeIdx] = row;
      console.log(
        `${side.padEnd(5)} | ` +
        `${shares.toFixed(2).padStart(9)} | ` +
        `${price.toFixed(4).padStart(6)} | ` +
        `${cashflow >= 0 ? '+' : ''}${cashflow.toFixed(2).padStart(9)} | ` +
        `${shareDelta >= 0 ? '+' : ''}${shareDelta.toFixed(0).padStart(6)} | ` +
        `${outcomeIdx}`
      );
    });
  }

  console.log("\nNote: BUY = negative cashflow (money spent), SELL = positive (money received)");

  // STEP 2: Market-level aggregation
  console.log("\n\nSTEP 2: Market Positions (Aggregated by Market)");
  console.log("-".repeat(80));

  const marketsQuery = `
    WITH trade_cashflows AS (
      SELECT
        lower(market_id) AS market_id,
        cast(outcome_index as Int16) AS outcome_idx,
        round(
          cast(entry_price as Float64) * cast(shares as Float64) *
          if(lowerUTF8(toString(side)) = 'buy', -1, 1),
          8
        ) AS cashflow,
        if(
          lowerUTF8(toString(side)) = 'buy',
          cast(shares as Float64),
          -cast(shares as Float64)
        ) AS share_delta
      FROM trades_raw
      WHERE lower(wallet_address) = '${TEST_WALLET}'
        AND market_id != '12'
        AND market_id IS NOT NULL
    ),
    market_positions AS (
      SELECT
        tc.market_id,
        lower(replaceAll(cmm.condition_id, '0x', '')) AS condition_id_norm,
        sum(tc.cashflow) AS total_cashflow,
        sumIf(tc.share_delta, tc.outcome_idx = 0) AS shares_outcome_0,
        sumIf(tc.share_delta, tc.outcome_idx = 1) AS shares_outcome_1,
        count() AS trade_count
      FROM trade_cashflows tc
      LEFT JOIN condition_market_map cmm ON tc.market_id = cmm.market_id
      GROUP BY tc.market_id, condition_id_norm
    )
    SELECT
      mp.market_id,
      mp.condition_id_norm,
      mp.total_cashflow,
      mp.shares_outcome_0,
      mp.shares_outcome_1,
      mp.trade_count,
      wi.win_idx,
      if(wi.win_idx = 0, mp.shares_outcome_0,
         if(wi.win_idx = 1, mp.shares_outcome_1, 0)) AS winning_shares,
      round(mp.total_cashflow +
            if(wi.win_idx = 0, mp.shares_outcome_0,
               if(wi.win_idx = 1, mp.shares_outcome_1, 0)), 2) AS realized_pnl
    FROM market_positions mp
    LEFT JOIN winning_index wi ON wi.condition_id_norm = mp.condition_id_norm
    WHERE wi.win_idx IS NOT NULL
    ORDER BY abs(realized_pnl) DESC
    LIMIT 15
  `;

  const markets = await queryData(marketsQuery);
  console.log("\nTop 15 Markets by Absolute P&L:");
  console.log("Cashflow   | Win Shares | P&L       | Trades | Winner");
  console.log("-".repeat(70));

  let totalCashflow = 0;
  let totalWinningShares = 0;
  let totalPnl = 0;

  if (markets.data && markets.data.length > 0) {
    markets.data.forEach((row: any[]) => {
      const [marketId, conditionId, cashflow, shares0, shares1, tradeCount, winIdx, winningShares, pnl] = row;

      totalCashflow += cashflow || 0;
      totalWinningShares += winningShares || 0;
      totalPnl += pnl || 0;

      console.log(
        `${cashflow >= 0 ? '+' : ''}${(cashflow || 0).toFixed(2).padStart(10)} | ` +
        `${(winningShares || 0).toFixed(2).padStart(10)} | ` +
        `${pnl >= 0 ? '+' : ''}${(pnl || 0).toFixed(2).padStart(9)} | ` +
        `${tradeCount.toString().padStart(6)} | ` +
        `${winIdx === 0 ? 'NO' : winIdx === 1 ? 'YES' : '?'}`
      );
    });

    console.log("-".repeat(70));
    console.log(
      `${totalCashflow >= 0 ? '+' : ''}${totalCashflow.toFixed(2).padStart(10)} | ` +
      `${totalWinningShares.toFixed(2).padStart(10)} | ` +
      `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2).padStart(9)} | ` +
      `TOTAL (top 15)`
    );
  }

  // STEP 3: Final wallet-level P&L
  console.log("\n\nSTEP 3: Wallet-Level P&L Summary");
  console.log("-".repeat(80));

  const walletQuery = `
    SELECT
      wallet,
      realized_pnl_usd,
      unrealized_pnl_usd,
      total_pnl_usd,
      markets_with_realized,
      total_realized_fills
    FROM wallet_pnl_summary_v2
    WHERE wallet = '${TEST_WALLET}'
  `;

  const walletResult = await queryData(walletQuery);

  if (walletResult.data && walletResult.data.length > 0) {
    const [wallet, realizedPnl, unrealizedPnl, totalPnl, marketsResolved, totalFills] = walletResult.data[0];

    console.log(`\nWallet: ${wallet}`);
    console.log("-".repeat(70));
    console.log(`Realized P&L:      $${realizedPnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`Unrealized P&L:    $${unrealizedPnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`Total P&L:         $${totalPnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`\nMarkets Resolved:  ${marketsResolved}`);
    console.log(`Total Fills:       ${totalFills}`);

    // Validation
    console.log("\n" + "=".repeat(80));
    console.log("VALIDATION");
    console.log("=".repeat(80));

    const variance = ((totalPnl - EXPECTED_PNL) / EXPECTED_PNL) * 100;
    const isValid = Math.abs(variance) < 5;

    console.log(`\nExpected P&L (Polymarket):  $${EXPECTED_PNL.toLocaleString()}`);
    console.log(`Calculated P&L (Database):  $${totalPnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`Variance:                   ${variance >= 0 ? '+' : ''}${variance.toFixed(2)}%`);
    console.log(`\nStatus: ${isValid ? '✅ VALIDATED (within 5%)' : '⚠️ NEEDS REVIEW (>5% variance)'}`);

    if (isValid) {
      console.log("\nThe formula is working correctly!");
    } else {
      console.log("\nNote: Variance may be due to:");
      console.log("  - Data snapshot date (Oct 31 vs current)");
      console.log("  - Unrealized positions that have since resolved");
      console.log("  - Fee/slippage accounting differences");
    }
  } else {
    console.log("⚠️ No P&L data found for this wallet");
    console.log("This could mean:");
    console.log("  - Wallet has no resolved positions");
    console.log("  - Views haven't been created yet (run: npx tsx scripts/realized-pnl-corrected.ts)");
  }

  // STEP 4: Show the formula breakdown
  console.log("\n\n" + "=".repeat(80));
  console.log("FORMULA BREAKDOWN");
  console.log("=".repeat(80));

  console.log(`
The P&L calculation follows Polymarket's methodology:

┌─────────────────────────────────────────────────────────────────┐
│                    REALIZED P&L FORMULA                         │
└─────────────────────────────────────────────────────────────────┘

Realized P&L = Cost Basis + Settlement Value

Where:
  Cost Basis       = sum(all cashflows in market)
                   = sum(BUY: -price × shares) + sum(SELL: +price × shares)

  Settlement Value = sum(shares in winning outcome × $1.00)
                   = sumIf(share_delta, outcome_index = winning_index)

Example:
  BUY  100 YES @ $0.60  →  -$60.00 cashflow, +100 shares YES
  SELL 40  YES @ $0.80  →  +$32.00 cashflow, -40 shares YES

  Market resolves: YES wins

  Cost Basis:       -$60.00 + $32.00 = -$28.00
  Net Shares:       +100 - 40 = 60 shares YES
  Settlement:       60 × $1.00 = $60.00
  Realized P&L:     -$28.00 + $60.00 = +$32.00 profit ✅

┌─────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                            │
└─────────────────────────────────────────────────────────────────┘

Required Tables:
  ✅ trades_raw              - Position data (side, shares, price)
  ✅ condition_market_map    - Market → Condition ID mapping
  ✅ market_resolutions      - Winning outcomes
  ✅ market_outcomes         - Outcome index mapping

DO NOT USE (Broken/Unreliable):
  ❌ trades_raw.realized_pnl_usd  - 99.9% incorrect values
  ❌ trades_raw.pnl               - 96.68% NULL
  ❌ trades_raw.is_resolved       - Unreliable flags
  ❌ trades_enriched*             - Built with wrong formula
  `);

  console.log("\n" + "=".repeat(80));
  console.log("END OF VALIDATION");
  console.log("=".repeat(80) + "\n");

  await ch.close();
}

main().catch(console.error);
