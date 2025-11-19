#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function createView(sql: string, name: string) {
  try {
    await ch.command({ query: sql });
    console.log(`  ✅ ${name}`);
    return true;
  } catch (e: any) {
    const err = e.message.split('\n')[0];
    console.error(`  ❌ ${name}: ${err}`);
    return false;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("PHASE 2 STEP 4: REALIZED PNL VIEWS");
  console.log("Formula: cash_usd + (win_shares × $1.00)");
  console.log("════════════════════════════════════════════════════════════════\n");

  console.log("4.1 Creating realized_pnl_by_condition_v3...\n");
  await createView(`
    CREATE OR REPLACE VIEW realized_pnl_by_condition_v3 AS
    SELECT
      f.wallet,
      f.condition_id_norm,
      round(
        f.cash_usd + coalesce(ws.win_shares, 0) * 1.00,
        8
      ) AS realized_pnl_usd
    FROM flows_by_condition_v1 AS f
    LEFT JOIN winning_shares_v1 AS ws
      ON f.wallet = ws.wallet
     AND f.condition_id_norm = ws.condition_id_norm
  `, "realized_pnl_by_condition_v3");

  console.log("\n4.2 Creating wallet_realized_pnl_v3...\n");
  await createView(`
    CREATE OR REPLACE VIEW wallet_realized_pnl_v3 AS
    SELECT wallet, round(sum(realized_pnl_usd), 8) AS realized_pnl_usd
    FROM realized_pnl_by_condition_v3
    GROUP BY wallet
  `, "wallet_realized_pnl_v3");

  console.log("\n" + "═".repeat(70));
  console.log("✅ REALIZED PNL VIEWS CREATED");
  console.log("═".repeat(70) + "\n");
}

main().catch(console.error);
