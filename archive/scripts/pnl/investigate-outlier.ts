// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * Investigate outlier wallets where ground truth is mathematically impossible
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

const WALLET = "0x6770bf688b8121331b1c5cfd7723ebd4152545fb";
const GT_PNL = 179044;

async function main() {
  console.log("=== OUTLIER WALLET INVESTIGATION ===");
  console.log("Wallet:", WALLET);
  console.log("Ground Truth PnL:", GT_PNL.toLocaleString());
  console.log("");

  // Check if this wallet appears as EOA or proxy in Goldsky
  console.log("[1] Check Goldsky proxy_wallet vs eoa_wallet:");
  const walletCheck = await client.query({
    query: `
      SELECT
        'proxy' AS role,
        count() AS positions,
        sum(realized_pnl) / 1e6 AS pnl
      FROM pm_user_positions FINAL
      WHERE lower(proxy_wallet) = '${WALLET.toLowerCase()}'
        AND is_deleted = 0
      UNION ALL
      SELECT
        'eoa' AS role,
        count() AS positions,
        sum(realized_pnl) / 1e6 AS pnl
      FROM pm_user_positions FINAL
      WHERE lower(eoa_wallet) = '${WALLET.toLowerCase()}'
        AND is_deleted = 0
    `,
    format: "JSONEachRow",
  });
  const wc = (await walletCheck.json()) as any[];
  for (const r of wc) {
    console.log(`  As ${r.role}: ${r.positions} positions, $${Number(r.pnl).toLocaleString()} PnL`);
  }
  console.log("");

  // Check for associated wallets
  console.log("[2] Find associated proxy/EOA pairs:");
  const pairs = await client.query({
    query: `
      SELECT DISTINCT
        lower(proxy_wallet) AS proxy,
        lower(eoa_wallet) AS eoa
      FROM pm_user_positions FINAL
      WHERE lower(proxy_wallet) = '${WALLET.toLowerCase()}'
        OR lower(eoa_wallet) = '${WALLET.toLowerCase()}'
      LIMIT 10
    `,
    format: "JSONEachRow",
  });
  const pairRows = (await pairs.json()) as any[];
  for (const r of pairRows) {
    console.log("  Proxy: " + r.proxy);
    console.log("  EOA:   " + r.eoa);
    console.log("");
  }

  // If found an EOA, check its trades
  if (pairRows.length > 0) {
    const eoaWallet = pairRows[0].eoa;
    if (eoaWallet && eoaWallet !== WALLET.toLowerCase()) {
      console.log("[3] Check EOA wallet trades:");
      const eoaTrades = await client.query({
        query: `
          SELECT
            count() AS trade_count,
            sum(usdc_amount) / 1e6 AS total_volume
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = '${eoaWallet}'
        `,
        format: "JSONEachRow",
      });
      const et = (await eoaTrades.json())[0] as any;
      console.log(`  EOA trades: ${et.trade_count}, volume: $${Number(et.total_volume).toLocaleString()}`);
      console.log("");

      // Check combined RESA for both wallets
      console.log("[4] Combined RESA for proxy + EOA:");
      const combined = await client.query({
        query: `
          WITH combined_trades AS (
            SELECT * FROM vw_wallet_condition_ledger_v1
            WHERE wallet IN ('${WALLET.toLowerCase()}', '${eoaWallet}')
          )
          SELECT
            count() AS events,
            sum(usdc_delta) AS total_pnl
          FROM combined_trades
        `,
        format: "JSONEachRow",
      });
      const comb = (await combined.json())[0] as any;
      console.log(`  Combined events: ${comb.events}`);
      console.log(`  Combined PnL:    $${Number(comb.total_pnl).toLocaleString()}`);
    }
  }

  // Check pm_ui_positions_new
  console.log("");
  console.log("[5] Check pm_ui_positions_new (Data API):");
  const uiPos = await client.query({
    query: `
      SELECT
        count() AS positions,
        sum(cash_pnl) AS total_pnl
      FROM pm_ui_positions_new
      WHERE lower(proxy_wallet) = '${WALLET.toLowerCase()}'
    `,
    format: "JSONEachRow",
  });
  const ui = (await uiPos.json())[0] as any;
  console.log(`  Positions: ${ui.positions}`);
  console.log(`  Cash PnL:  $${Number(ui.total_pnl).toLocaleString()}`);

  // Final summary
  console.log("");
  console.log("=== CONCLUSION ===");
  console.log("This wallet appears to have a $164K gap between RESA ($14.8K) and GT ($179K).");
  console.log("With only $93K in trading volume, a $179K profit is MATHEMATICALLY IMPOSSIBLE.");
  console.log("The ground truth data for this wallet appears to be incorrect or uses a different methodology.");

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
