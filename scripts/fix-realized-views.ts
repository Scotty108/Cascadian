#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 30000,
});

async function executeQuery(query: string) {
  try {
    await ch.command({ query });
    return { success: true, error: null };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("FIX #1: REPAIR realized_pnl_by_market_final VIEW");
  console.log("══════════════════════════════════════════════════════════════\n");

  // Step 1: Drop dependent views first
  console.log("📋 Step 1: Dropping dependent views...\n");

  const viewsToDrop = [
    "wallet_pnl_summary_final",
    "wallet_realized_pnl_final",
    "realized_pnl_by_market_final"
  ];

  for (const view of viewsToDrop) {
    const result = await executeQuery(`DROP VIEW IF EXISTS ${view}`);
    if (result.success) {
      console.log(`  ✅ Dropped ${view}`);
    } else {
      console.log(`  ⚠️  ${view}: ${result.error}`);
    }
  }

  // Step 2: Recreate realized_pnl_by_market_final with CLEAN column names
  console.log("\n📋 Step 2: Recreating realized_pnl_by_market_final with clean columns...\n");

  const createRealizedPnl = `
    CREATE VIEW default.realized_pnl_by_market_final (
      wallet String,
      market_id String,
      condition_id_norm String,
      resolved_at Nullable(DateTime64(3)),
      realized_pnl_usd Float64
    ) AS
    WITH win AS (
      SELECT 
        condition_id_norm, 
        toInt16(win_idx) AS win_idx, 
        resolved_at 
      FROM default.winning_index
    )
    SELECT 
      p.wallet,
      p.market_id,
      p.condition_id_norm,
      w.resolved_at,
      round(sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) - sum(toFloat64(c.cashflow_usdc)), 4) AS realized_pnl_usd
    FROM default.outcome_positions_v2 AS p
    ANY LEFT JOIN default.trade_cashflows_v3 AS c 
      ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win AS w 
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE w.win_idx IS NOT NULL
    GROUP BY p.wallet, p.market_id, p.condition_id_norm, w.resolved_at
  `;

  let result = await executeQuery(createRealizedPnl);
  if (result.success) {
    console.log(`  ✅ Created realized_pnl_by_market_final with clean columns\n`);
  } else {
    console.log(`  ❌ ERROR: ${result.error}\n`);
    process.exit(1);
  }

  // Step 3: Recreate wallet_realized_pnl_final
  console.log("📋 Step 3: Recreating wallet_realized_pnl_final...\n");

  const createWalletRealizedPnl = `
    CREATE VIEW default.wallet_realized_pnl_final (
      wallet String,
      realized_pnl_usd Float64
    ) AS
    SELECT 
      wallet,
      round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
    FROM default.realized_pnl_by_market_final
    GROUP BY wallet
  `;

  result = await executeQuery(createWalletRealizedPnl);
  if (result.success) {
    console.log(`  ✅ Created wallet_realized_pnl_final\n`);
  } else {
    console.log(`  ❌ ERROR: ${result.error}\n`);
    process.exit(1);
  }

  // Step 4: Recreate wallet_pnl_summary_final
  console.log("📋 Step 4: Recreating wallet_pnl_summary_final...\n");

  const createWalletPnlSummary = `
    CREATE VIEW default.wallet_pnl_summary_final (
      wallet String,
      realized_pnl_usd Float64,
      unrealized_pnl_usd Float64,
      total_pnl_usd Float64
    ) AS
    SELECT 
      coalesce(r.wallet, u.wallet) AS wallet,
      coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
      coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
      round(coalesce(r.realized_pnl_usd, 0) + coalesce(u.unrealized_pnl_usd, 0), 2) AS total_pnl_usd
    FROM default.wallet_realized_pnl_final AS r
    FULL OUTER JOIN default.wallet_unrealized_pnl_v2 AS u USING (wallet)
  `;

  result = await executeQuery(createWalletPnlSummary);
  if (result.success) {
    console.log(`  ✅ Created wallet_pnl_summary_final\n`);
  } else {
    console.log(`  ❌ ERROR: ${result.error}\n`);
    process.exit(1);
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log("✅ ALL VIEWS REPAIRED SUCCESSFULLY");
  console.log("══════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
