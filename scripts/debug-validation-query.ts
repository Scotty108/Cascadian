#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function queryData(query: string, name: string) {
  try {
    console.log(`\n[${name}]`);
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    console.log(`  Rows: ${data.length}`);
    if (data.length > 0) {
      console.log(`  Sample:`, data[0]);
    }
    return data;
  } catch (e: any) {
    console.error(`  ERROR: ${e.message}`);
    return null;
  }
}

async function main() {
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  
  console.log("🔍 DEBUGGING VALIDATION QUERY\n");
  
  // Step 1: Check table row counts
  await queryData("SELECT COUNT(*) FROM outcome_positions_v2", "outcome_positions_v2 count");
  await queryData("SELECT COUNT(*) FROM trade_cashflows_v3", "trade_cashflows_v3 count");
  await queryData("SELECT COUNT(*) FROM winning_index", "winning_index count");
  await queryData("SELECT COUNT(*) FROM wallet_unrealized_pnl_v2", "wallet_unrealized_pnl_v2 count");
  
  // Step 2: Sample data
  await queryData(`SELECT * FROM outcome_positions_v2 LIMIT 1`, "outcome_positions_v2 sample");
  await queryData(`SELECT * FROM trade_cashflows_v3 LIMIT 1`, "trade_cashflows_v3 sample");
  
  // Step 3: Check if wallet is in the data
  await queryData(`SELECT COUNT(*) FROM outcome_positions_v2 WHERE wallet = lower('${wallet}')`, "niggemon in outcome_positions");
  await queryData(`SELECT COUNT(*) FROM trade_cashflows_v3 WHERE wallet = lower('${wallet}')`, "niggemon in trade_cashflows");
  
  // Step 4: Run the full query
  const result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index
    )
    SELECT
      round(sum(c.cashflow_usdc) - sumIf(p.net_shares, p.outcome_idx = w.win_idx), 2) AS realized_pnl,
      round(coalesce(u.unrealized_pnl_usd, 0), 2) AS unrealized_pnl,
      round(realized_pnl + unrealized_pnl, 2) AS total_pnl
    FROM outcome_positions_v2 AS p
    LEFT JOIN trade_cashflows_v3 AS c
      ON c.wallet = p.wallet AND c.condition_id_norm = p.condition_id_norm
    LEFT JOIN win AS w
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    LEFT JOIN wallet_unrealized_pnl_v2 AS u ON u.wallet = p.wallet
    WHERE p.wallet = lower('${wallet}')
    GROUP BY p.wallet, u.unrealized_pnl_usd
  `, "Full validation query");
}

main();
