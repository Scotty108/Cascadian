// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * Test: Wallet-level net PnL consistency across three definitions.
 *
 * For each wallet:
 *  1) net_trade_cash_flow  - sum of signed USDC deltas from pm_trader_events_v2
 *  2) net_api_cash_pnl     - sum cash_pnl from pm_ui_positions_new (Data API mirror)
 *  3) net_hybrid_ui_like   - Goldsky gains minus API losses (what we used to get the ~ -10M)
 *
 * Run with: npx tsx scripts/test-wallet-pnl-consistency.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@clickhouse/client";

config({ path: resolve(process.cwd(), ".env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

async function main() {
  // Sports Bettor and second largest wallet by PnL magnitude
  const SPORTS_BETTOR_WALLET = "0xf29bb8e0712075041e87e8605b69833ef738dd4c";
  const SECOND_WALLET = "0xa0275889acf34a77ae9b66ea6a58112f6101e1d5";

  const wallets = [SPORTS_BETTOR_WALLET.toLowerCase(), SECOND_WALLET.toLowerCase()];

  console.log("Wallets under test:");
  for (const w of wallets) console.log(" -", w);
  console.log("");

  // 1) net_trade_cash_flow from pm_trader_events_v2
  //
  // pm_trader_events_v2 has:
  //  - trader_wallet
  //  - side = 'buy' | 'sell'
  //  - usdc_amount (absolute size in USDC, stored as raw value / 1e6)
  //  - fee_amount (fee charged, stored as raw value / 1e6)
  //
  const tradeCashFlowQuery = `
    SELECT
      lower(trader_wallet)                                  AS wallet,
      sum(
        CASE
          WHEN side = 'buy'  THEN -usdc_amount / 1e6        -- buys spend USDC
          WHEN side = 'sell' THEN  usdc_amount / 1e6        -- sells receive USDC
          ELSE 0
        END
      )                                                    AS gross_trade_usdc,
      sum(
        -fee_amount / 1e6
      )                                                    AS fee_usdc,
      sum(
        CASE
          WHEN side = 'buy'  THEN -usdc_amount / 1e6
          WHEN side = 'sell' THEN  usdc_amount / 1e6
          ELSE 0
        END
        - fee_amount / 1e6
      )                                                    AS net_trade_cash_flow
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) IN (${wallets.map(w => `'${w}'`).join(", ")})
    GROUP BY wallet
  `;

  // 2) net_api_cash_pnl from pm_ui_positions_new
  //
  // pm_ui_positions_new is the Data API mirror and has:
  //  - proxy_wallet
  //  - cash_pnl (can be positive or negative)
  //
  const apiPnlQuery = `
    SELECT
      lower(proxy_wallet)                                     AS wallet,
      sum(cash_pnl)                                           AS net_api_cash_pnl,
      sumIf(cash_pnl, cash_pnl > 0)                           AS api_gains,
      sumIf(cash_pnl, cash_pnl < 0)                           AS api_losses
    FROM pm_ui_positions_new
    WHERE lower(proxy_wallet) IN (${wallets.map(w => `'${w}'`).join(", ")})
    GROUP BY wallet
  `;

  // 3) Hybrid UI-like metric:
  //
  //  - goldsky_gains: sum of positive realized_pnl from pm_user_positions (Goldsky)
  //    Note: Goldsky stores values in micro-USDC (1e6), so divide by 1e6
  //  - api_losses: absolute sum of negative cash_pnl from pm_ui_positions_new
  //
  //  net_hybrid_ui_like = goldsky_gains - api_losses
  //
  const hybridQuery = `
    WITH goldsky AS (
      SELECT
        lower(proxy_wallet) AS wallet,
        sumIf(realized_pnl / 1e6, realized_pnl > 0) AS goldsky_gains
      FROM pm_user_positions
      WHERE lower(proxy_wallet) IN (${wallets.map(w => `'${w}'`).join(", ")})
      GROUP BY wallet
    ),
    api AS (
      SELECT
        lower(proxy_wallet) AS wallet,
        -sumIf(cash_pnl, cash_pnl < 0) AS api_losses
      FROM pm_ui_positions_new
      WHERE lower(proxy_wallet) IN (${wallets.map(w => `'${w}'`).join(", ")})
      GROUP BY wallet
    )
    SELECT
      coalesce(g.wallet, a.wallet)              AS wallet,
      ifNull(g.goldsky_gains, 0)               AS goldsky_gains,
      ifNull(a.api_losses, 0)                  AS api_losses,
      ifNull(g.goldsky_gains, 0) - ifNull(a.api_losses, 0) AS net_hybrid_ui_like
    FROM goldsky g
    FULL OUTER JOIN api a ON g.wallet = a.wallet
  `;

  const [tradeRes, apiRes, hybridRes] = await Promise.all([
    client.query({ query: tradeCashFlowQuery, format: "JSONEachRow" }),
    client.query({ query: apiPnlQuery, format: "JSONEachRow" }),
    client.query({ query: hybridQuery, format: "JSONEachRow" }),
  ]);

  type TradeRow = {
    wallet: string;
    gross_trade_usdc: number;
    fee_usdc: number;
    net_trade_cash_flow: number;
  };

  type ApiRow = {
    wallet: string;
    net_api_cash_pnl: number;
    api_gains: number;
    api_losses: number;
  };

  type HybridRow = {
    wallet: string;
    goldsky_gains: number;
    api_losses: number;
    net_hybrid_ui_like: number;
  };

  const tradeRows = (await tradeRes.json()) as TradeRow[];
  const apiRows = (await apiRes.json()) as ApiRow[];
  const hybridRows = (await hybridRes.json()) as HybridRow[];

  const byWallet: Record<string, any> = {};
  for (const w of wallets) {
    byWallet[w] = { wallet: w };
  }

  for (const r of tradeRows) {
    byWallet[r.wallet] = { ...(byWallet[r.wallet] || {}), ...r };
  }
  for (const r of apiRows) {
    byWallet[r.wallet] = { ...(byWallet[r.wallet] || {}), ...r };
  }
  for (const r of hybridRows) {
    byWallet[r.wallet] = { ...(byWallet[r.wallet] || {}), ...r };
  }

  console.log("=".repeat(100));
  console.log("  PnL CONSISTENCY TEST");
  console.log("=".repeat(100));
  console.log("");

  for (const w of wallets) {
    const r = byWallet[w] || {};
    const label = w === SPORTS_BETTOR_WALLET.toLowerCase() ? "SPORTS BETTOR" : "WALLET #2";

    console.log(`--- ${label} (${w}) ---`);
    console.log("");
    console.log("  NET PnL COMPARISON:");
    console.log(`    1. net_trade_cash_flow:  $${Number(r.net_trade_cash_flow ?? 0).toLocaleString()}`);
    console.log(`    2. net_api_cash_pnl:     $${Number(r.net_api_cash_pnl ?? 0).toLocaleString()}`);
    console.log(`    3. net_hybrid_ui_like:   $${Number(r.net_hybrid_ui_like ?? 0).toLocaleString()}`);
    console.log("");
    console.log("  COMPONENTS:");
    console.log(`    gross_trade_usdc:        $${Number(r.gross_trade_usdc ?? 0).toLocaleString()}`);
    console.log(`    fee_usdc:                $${Number(r.fee_usdc ?? 0).toLocaleString()}`);
    console.log(`    api_gains:               $${Number(r.api_gains ?? 0).toLocaleString()}`);
    console.log(`    api_losses:              $${Number(r.api_losses ?? 0).toLocaleString()}`);
    console.log(`    goldsky_gains:           $${Number(r.goldsky_gains ?? 0).toLocaleString()}`);
    console.log("");
  }

  console.log("=".repeat(100));
  console.log("  INTERPRETATION:");
  console.log("=".repeat(100));
  console.log("");
  console.log("  - net_trade_cash_flow: Raw cash in/out from trades (buys are outflows, sells are inflows)");
  console.log("  - net_api_cash_pnl:    Data API's computed PnL (includes resolutions, proper cost basis)");
  console.log("  - net_hybrid_ui_like:  Goldsky gains - API losses (the ~-10M construction)");
  console.log("");
  console.log("  If net_trade_cash_flow ≈ net_api_cash_pnl, both agree on true economic PnL.");
  console.log("  If net_hybrid_ui_like differs significantly, it's a hybrid artifact, not true PnL.");

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
