#!/usr/bin/env npx tsx
import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 60000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("PHASE 4 FAILURE DIAGNOSIS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  // Check 1: Table row counts
  console.log("CHECK 1: Table Structure & Row Counts");
  console.log("─".repeat(65));

  const tables = [
    "outcome_positions_v2",
    "trade_cashflows_v3",
    "winning_index",
    "wallet_unrealized_pnl_v2",
  ];

  for (const table of tables) {
    const result = await queryData(`SELECT COUNT(*) FROM ${table}`);
    const count = result && result.length > 0 ? result[0][0] : "ERROR";
    console.log(`  ${table.padEnd(35)}: ${count} rows`);
  }

  console.log("");

  // Check 2: Data in outcome_positions_v2 for niggemon
  console.log("CHECK 2: niggemon data in outcome_positions_v2");
  console.log("─".repeat(65));

  const positions = await queryData(`
    SELECT
      COUNT(*) as row_count,
      SUM(net_shares) as total_shares,
      COUNT(DISTINCT market_id) as markets,
      COUNT(DISTINCT condition_id_norm) as conditions
    FROM outcome_positions_v2
    WHERE wallet = lower('${niggemon}')
  `);

  if (positions && positions.length > 0) {
    const [rows, shares, markets, conditions] = positions[0];
    console.log(`  Row count: ${rows}`);
    console.log(`  Total net shares: ${shares}`);
    console.log(`  Unique markets: ${markets}`);
    console.log(`  Unique conditions: ${conditions}`);
  }

  console.log("");

  // Check 3: Data in trade_cashflows_v3 for niggemon
  console.log("CHECK 3: niggemon data in trade_cashflows_v3");
  console.log("─".repeat(65));

  const cashflows = await queryData(`
    SELECT
      COUNT(*) as row_count,
      SUM(cashflow_usdc) as total_cashflow,
      COUNT(DISTINCT market_id) as markets,
      COUNT(DISTINCT condition_id_norm) as conditions
    FROM trade_cashflows_v3
    WHERE wallet = lower('${niggemon}')
  `);

  if (cashflows && cashflows.length > 0) {
    const [rows, cf, markets, conditions] = cashflows[0];
    console.log(`  Row count: ${rows}`);
    console.log(`  Total cashflow USDC: ${cf}`);
    console.log(`  Unique markets: ${markets}`);
    console.log(`  Unique conditions: ${conditions}`);
  }

  console.log("");

  // Check 4: winning_index data
  console.log("CHECK 4: winning_index sample");
  console.log("─".repeat(65));

  const winningIndex = await queryData(`
    SELECT COUNT(*) as total, COUNT(DISTINCT condition_id_norm) as unique_conditions
    FROM winning_index
  `);

  if (winningIndex && winningIndex.length > 0) {
    const [total, unique] = winningIndex[0];
    console.log(`  Total rows: ${total}`);
    console.log(`  Unique conditions: ${unique}`);
  }

  console.log("");

  // Check 5: Check unrealized_pnl table
  console.log("CHECK 5: wallet_unrealized_pnl_v2 for niggemon");
  console.log("─".repeat(65));

  const unrealized = await queryData(`
    SELECT unrealized_pnl_usd
    FROM wallet_unrealized_pnl_v2
    WHERE wallet = lower('${niggemon}')
  `);

  if (unrealized && unrealized.length > 0) {
    console.log(`  Unrealized P&L: $${unrealized[0][0]}`);
  } else {
    console.log(`  No entry found`);
  }

  console.log("");

  // Check 6: Try simple calculation without ANY LEFT JOIN
  console.log("CHECK 6: Simple cashflow calculation");
  console.log("─".repeat(65));

  const simpleCf = await queryData(`
    SELECT
      SUM(CAST(cashflow_usdc AS Float64)) as total_cashflow
    FROM trade_cashflows_v3
    WHERE wallet = lower('${niggemon}')
  `);

  if (simpleCf && simpleCf.length > 0) {
    console.log(`  Total cashflow (simple): $${simpleCf[0][0]}`);
  }

  console.log("");

  // Check 7: Check what the data looks like
  console.log("CHECK 7: Sample outcome position for niggemon");
  console.log("─".repeat(65));

  const sample = await queryData(`
    SELECT market_id, condition_id_norm, outcome_idx, net_shares
    FROM outcome_positions_v2
    WHERE wallet = lower('${niggemon}')
    LIMIT 5
  `);

  if (sample && sample.length > 0) {
    for (const row of sample) {
      console.log(`  Market: ${String(row[0]).substring(0, 16)}... | Cond: ${String(row[1]).substring(0, 16)}... | Outcome: ${row[2]} | Shares: ${row[3]}`);
    }
  }

  console.log("\n════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
