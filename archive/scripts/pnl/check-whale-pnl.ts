// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * check-whale-pnl.ts
 *
 * Goal:
 *   For a list of whale wallets, compare several PnL views:
 *     1) net_trade_cash_flow   from pm_trader_events_v2
 *     2) api_cash_pnl          from pm_ui_positions_new      (Data API mirror)
 *     3) goldsky_pnl           from pm_user_positions        (Goldsky mirror)
 *     4) hybrid_ui_like_pnl    = goldsky_gains + api_losses  (what gave ~ -10M)
 *
 * Schema Notes (verified):
 *   - pm_trader_events_v2: trader_wallet, side, usdc_amount, token_amount, fee_amount
 *   - pm_ui_positions_new: proxy_wallet, cash_pnl
 *   - pm_user_positions: proxy_wallet, realized_pnl (in micro-USDC, /1e6)
 *
 * Usage:
 *   npx tsx scripts/check-whale-pnl.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@clickhouse/client";

config({ path: resolve(process.cwd(), ".env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

// All whale addresses to analyze
const WALLET_ADDRESSES: string[] = [
  // Sports Bettor
  "0xf29bb8e0712075041e87e8605b69833ef738dd4c",
  // Known +22M wallet
  "0x56687bf447db6ffa42ffe2204a05edaa20f55839",
  // Wallet #2 from earlier tests
  "0xa0275889acf34a77ae9b66ea6a58112f6101e1d5",
  // New whale list
  "0x4ce73141dbfce41e65db3723e31059a730f0abad",
  "0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144",
  "0x1f0a343513aa6060488fabe96960e6d1e177f7aa",
  "0x06dcaa14f57d8a0573f5dc5940565e6de667af59",
  "0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed",
  "0x8f42ae0a01c0383c7ca8bd060b86a645ee74b88f",
  "0xe542afd3881c4c330ba0ebbb603bb470b2ba0a37",
  "0x12d6cccfc7470a3f4bafc53599a4779cbf2cf2a8",
  "0x7c156bb0dbb44dcb7387a78778e0da313bf3c9db",
  "0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8",
  "0x662244931c392df70bd064fa91f838eea0bfd7a9",
  "0x2e0b70d482e6b389e81dea528be57d825dd48070",
  "0x3b6fd06a595d71c70afb3f44414be1c11304340b",
  "0xd748c701ad93cfec32a3420e10f3b08e68612125",
  "0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397",
  "0xd06f0f7719df1b3b75b607923536b3250825d4a6",
  "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
  "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
  "0x7f3c8979d0afa00007bae4747d5347122af05613",
  "0x1489046ca0f9980fc2d9a950d103d3bec02c1307",
  "0x8e9eedf20dfa70956d49f608a205e402d9df38e4",
  "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "0x6770bf688b8121331b1c5cfd7723ebd4152545fb",
];

type WalletData = {
  wallet: string;
  trade_cash_flow: number;
  trade_count: number;
  api_cash_pnl: number;
  api_gains: number;
  api_losses: number;
  api_positions: number;
  gs_pnl: number;
  gs_gains: number;
  gs_losses: number;
  gs_positions: number;
  hybrid_pnl: number;
};

async function fetchTradeCashFlow(
  wallets: string[]
): Promise<Record<string, { trade_cash_flow: number; trade_count: number }>> {
  if (wallets.length === 0) return {};

  const inList = wallets.map((w) => `'${w}'`).join(", ");

  // pm_trader_events_v2 schema: trader_wallet, side, usdc_amount, fee_amount
  // Cash flow: buy = -usdc_amount, sell = +usdc_amount, minus fees
  const query = `
    SELECT
      lower(trader_wallet) AS wallet,
      sum(
        CASE
          WHEN side = 'buy'  THEN -usdc_amount / 1e6 - fee_amount / 1e6
          WHEN side = 'sell' THEN  usdc_amount / 1e6 - fee_amount / 1e6
          ELSE 0
        END
      ) AS trade_cash_flow,
      count() AS trade_count
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) IN (${inList})
    GROUP BY wallet
  `;

  const result = await client.query({ query, format: "JSONEachRow" });
  const rows = (await result.json()) as {
    wallet: string;
    trade_cash_flow: number;
    trade_count: number;
  }[];

  const map: Record<string, { trade_cash_flow: number; trade_count: number }> = {};
  for (const r of rows) {
    map[r.wallet] = {
      trade_cash_flow: Number(r.trade_cash_flow),
      trade_count: Number(r.trade_count),
    };
  }
  return map;
}

async function fetchApiPnl(
  wallets: string[]
): Promise<
  Record<
    string,
    { api_cash_pnl: number; api_gains: number; api_losses: number; api_positions: number }
  >
> {
  if (wallets.length === 0) return {};

  const inList = wallets.map((w) => `'${w}'`).join(", ");

  // pm_ui_positions_new schema: proxy_wallet, cash_pnl (already in USDC)
  const query = `
    SELECT
      lower(proxy_wallet) AS wallet,
      sum(cash_pnl) AS api_cash_pnl,
      sumIf(cash_pnl, cash_pnl > 0) AS api_gains,
      sumIf(cash_pnl, cash_pnl < 0) AS api_losses,
      count() AS api_positions
    FROM pm_ui_positions_new
    WHERE lower(proxy_wallet) IN (${inList})
    GROUP BY wallet
  `;

  const result = await client.query({ query, format: "JSONEachRow" });
  const rows = (await result.json()) as {
    wallet: string;
    api_cash_pnl: number;
    api_gains: number;
    api_losses: number;
    api_positions: number;
  }[];

  const map: Record<
    string,
    { api_cash_pnl: number; api_gains: number; api_losses: number; api_positions: number }
  > = {};
  for (const r of rows) {
    map[r.wallet] = {
      api_cash_pnl: Number(r.api_cash_pnl),
      api_gains: Number(r.api_gains),
      api_losses: Number(r.api_losses),
      api_positions: Number(r.api_positions),
    };
  }
  return map;
}

async function fetchGoldskyPnl(
  wallets: string[]
): Promise<
  Record<
    string,
    { gs_pnl: number; gs_gains: number; gs_losses: number; gs_positions: number }
  >
> {
  if (wallets.length === 0) return {};

  const inList = wallets.map((w) => `'${w}'`).join(", ");

  // pm_user_positions schema: proxy_wallet, realized_pnl (in micro-USDC, /1e6)
  // NOTE: Goldsky has CROPPED LOSSES - gs_losses will be understated!
  const query = `
    SELECT
      lower(proxy_wallet) AS wallet,
      sum(realized_pnl) / 1e6 AS gs_pnl,
      sumIf(realized_pnl, realized_pnl > 0) / 1e6 AS gs_gains,
      sumIf(realized_pnl, realized_pnl < 0) / 1e6 AS gs_losses,
      count() AS gs_positions
    FROM pm_user_positions
    WHERE lower(proxy_wallet) IN (${inList})
    GROUP BY wallet
  `;

  const result = await client.query({ query, format: "JSONEachRow" });
  const rows = (await result.json()) as {
    wallet: string;
    gs_pnl: number;
    gs_gains: number;
    gs_losses: number;
    gs_positions: number;
  }[];

  const map: Record<
    string,
    { gs_pnl: number; gs_gains: number; gs_losses: number; gs_positions: number }
  > = {};
  for (const r of rows) {
    map[r.wallet] = {
      gs_pnl: Number(r.gs_pnl),
      gs_gains: Number(r.gs_gains),
      gs_losses: Number(r.gs_losses),
      gs_positions: Number(r.gs_positions),
    };
  }
  return map;
}

function formatUsd(x: number | undefined): string {
  if (x == null || Number.isNaN(x)) return "$0";
  const sign = x < 0 ? "-" : "";
  const abs = Math.abs(x);
  return `${sign}$${abs.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  })}`;
}

async function main() {
  console.log("╔" + "═".repeat(100) + "╗");
  console.log("║" + " ".repeat(35) + "WHALE PnL CONSISTENCY CHECK" + " ".repeat(38) + "║");
  console.log("╚" + "═".repeat(100) + "╝");
  console.log("");
  console.log(`Analyzing ${WALLET_ADDRESSES.length} wallets...`);
  console.log("");

  const walletsLower = WALLET_ADDRESSES.map((w) => w.toLowerCase());

  const [tradeMap, apiMap, gsMap] = await Promise.all([
    fetchTradeCashFlow(walletsLower),
    fetchApiPnl(walletsLower),
    fetchGoldskyPnl(walletsLower),
  ]);

  const results: WalletData[] = [];

  for (const w of walletsLower) {
    const trade = tradeMap[w] || { trade_cash_flow: 0, trade_count: 0 };
    const api = apiMap[w] || { api_cash_pnl: 0, api_gains: 0, api_losses: 0, api_positions: 0 };
    const gs = gsMap[w] || { gs_pnl: 0, gs_gains: 0, gs_losses: 0, gs_positions: 0 };

    // Hybrid PnL: Goldsky gains (accurate) + API losses (accurate)
    // This corrects for Goldsky's cropped losses
    const hybrid_pnl = gs.gs_gains + api.api_losses;

    results.push({
      wallet: w,
      trade_cash_flow: trade.trade_cash_flow,
      trade_count: trade.trade_count,
      api_cash_pnl: api.api_cash_pnl,
      api_gains: api.api_gains,
      api_losses: api.api_losses,
      api_positions: api.api_positions,
      gs_pnl: gs.gs_pnl,
      gs_gains: gs.gs_gains,
      gs_losses: gs.gs_losses,
      gs_positions: gs.gs_positions,
      hybrid_pnl,
    });
  }

  // Sort by hybrid PnL descending
  results.sort((a, b) => b.hybrid_pnl - a.hybrid_pnl);

  // Print detailed results
  console.log("┌" + "─".repeat(100) + "┐");
  console.log("│  DETAILED RESULTS (sorted by Hybrid PnL)" + " ".repeat(57) + "│");
  console.log("├" + "─".repeat(100) + "┤");

  for (const r of results) {
    const shortWallet = r.wallet.slice(0, 10) + "..." + r.wallet.slice(-4);
    console.log(`│                                                                                                    │`);
    console.log(`│  ${shortWallet}  Trades: ${r.trade_count.toString().padStart(6)}  GS Pos: ${r.gs_positions.toString().padStart(4)}  API Pos: ${r.api_positions.toString().padStart(4)}`.padEnd(101) + "│");
    console.log(`│    Trade Cash Flow: ${formatUsd(r.trade_cash_flow).padStart(15)}`.padEnd(101) + "│");
    console.log(`│    Goldsky PnL:     ${formatUsd(r.gs_pnl).padStart(15)}  (gains: ${formatUsd(r.gs_gains)}, losses: ${formatUsd(r.gs_losses)} CROPPED)`.padEnd(101) + "│");
    console.log(`│    Data API PnL:    ${formatUsd(r.api_cash_pnl).padStart(15)}  (gains: ${formatUsd(r.api_gains)}, losses: ${formatUsd(r.api_losses)})`.padEnd(101) + "│");
    console.log(`│    HYBRID PnL:      ${formatUsd(r.hybrid_pnl).padStart(15)}  ← Best estimate (GS gains + API losses)`.padEnd(101) + "│");
  }

  console.log("└" + "─".repeat(100) + "┘");

  // Summary table
  console.log("");
  console.log("╔" + "═".repeat(100) + "╗");
  console.log("║  SUMMARY TABLE" + " ".repeat(85) + "║");
  console.log("╠" + "═".repeat(100) + "╣");
  console.log("║  Wallet          │ Trade Cash  │  API PnL    │  GS PnL     │  Hybrid PnL │ Trades │ Pos  ║");
  console.log("╟" + "─".repeat(100) + "╢");

  for (const r of results) {
    const shortWallet = r.wallet.slice(0, 10) + "...";
    const line = `║  ${shortWallet.padEnd(15)} │ ${formatUsd(r.trade_cash_flow).padStart(11)} │ ${formatUsd(r.api_cash_pnl).padStart(11)} │ ${formatUsd(r.gs_pnl).padStart(11)} │ ${formatUsd(r.hybrid_pnl).padStart(11)} │ ${r.trade_count.toString().padStart(6)} │ ${r.gs_positions.toString().padStart(4)} ║`;
    console.log(line);
  }

  console.log("╚" + "═".repeat(100) + "╝");

  // Aggregate stats
  const totalHybrid = results.reduce((sum, r) => sum + r.hybrid_pnl, 0);
  const totalGsGains = results.reduce((sum, r) => sum + r.gs_gains, 0);
  const totalApiLosses = results.reduce((sum, r) => sum + r.api_losses, 0);
  const profitable = results.filter((r) => r.hybrid_pnl > 0).length;
  const unprofitable = results.filter((r) => r.hybrid_pnl < 0).length;

  console.log("");
  console.log("AGGREGATE STATISTICS:");
  console.log(`  Total Wallets:     ${results.length}`);
  console.log(`  Profitable:        ${profitable}`);
  console.log(`  Unprofitable:      ${unprofitable}`);
  console.log(`  Total GS Gains:    ${formatUsd(totalGsGains)}`);
  console.log(`  Total API Losses:  ${formatUsd(totalApiLosses)}`);
  console.log(`  Total Hybrid PnL:  ${formatUsd(totalHybrid)}`);

  await client.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
