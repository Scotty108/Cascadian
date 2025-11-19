#!/usr/bin/env npx tsx
import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
  request_timeout: 60000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("\n🔍 DIAGNOSING TABLE STATE\n");

  // Check table existence and row counts
  const tables = [
    "outcome_positions_v2",
    "outcome_positions_v2_backup_20251107T071726",
    "outcome_positions_v2_fixed",
    "trade_cashflows_v3",
    "trade_cashflows_v3_backup_20251107T071726",
    "trade_cashflows_v3_fixed"
  ];

  console.log("TABLE ROW COUNTS:");
  for (const tbl of tables) {
    const result = await queryData(`SELECT COUNT(*) FROM ${tbl}`);
    if (result && result.length > 0) {
      console.log(`  ${tbl}: ${result[0][0]} rows`);
    } else {
      console.log(`  ${tbl}: TABLE DOES NOT EXIST`);
    }
  }

  console.log("\nSAMPLE DATA FROM outcome_positions_v2:");
  const sample = await queryData(`
    SELECT wallet, condition_id_norm, outcome_idx, net_shares
    FROM outcome_positions_v2
    LIMIT 3
  `);
  if (sample && sample.length > 0) {
    for (const row of sample) {
      console.log(`  wallet=${row[0]}, condition_id_norm=${row[1]}, outcome_idx=${row[2]}, net_shares=${row[3]}`);
    }
  }

  console.log("\nSAMPLE DATA FROM trade_cashflows_v3:");
  const sample2 = await queryData(`
    SELECT wallet, condition_id_norm, cashflow_usdc
    FROM trade_cashflows_v3
    LIMIT 3
  `);
  if (sample2 && sample2.length > 0) {
    for (const row of sample2) {
      console.log(`  wallet=${row[0]}, condition_id_norm=${row[1]}, cashflow_usdc=${row[2]}`);
    }
  }

  console.log("\nWINNING_INDEX TABLE:");
  const winResult = await queryData(`SELECT COUNT(*) FROM winning_index`);
  if (winResult && winResult.length > 0) {
    console.log(`  Total rows: ${winResult[0][0]}`);
  }

  console.log("\nWALLET_UNREALIZED_PNL_V2 TABLE:");
  const unrealResult = await queryData(`SELECT COUNT(*) FROM wallet_unrealized_pnl_v2`);
  if (unrealResult && unrealResult.length > 0) {
    console.log(`  Total rows: ${unrealResult[0][0]}`);
  }
}

main().catch(e => console.error("Fatal:", e.message));
