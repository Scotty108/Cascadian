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

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSONCompact' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return [];
  }
}

async function main() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("EXAMINING CURRENT VIEW DEFINITIONS");
  console.log("══════════════════════════════════════════════════════════════\n");

  // Get the VIEW definition
  const views = await queryData(`
    SELECT 
      name,
      create_table_query
    FROM system.tables
    WHERE database = 'default' 
      AND name IN ('realized_pnl_by_market_final', 'wallet_realized_pnl_final', 'wallet_pnl_summary_final')
    ORDER BY name
  `);

  for (const v of views) {
    console.log(`\n📋 VIEW: ${v[0]}`);
    console.log("─".repeat(80));
    console.log(v[1]);
    console.log("");
  }

  // Test if we can query each view
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("TESTING CURRENT VIEWS");
  console.log("══════════════════════════════════════════════════════════════\n");

  const testViews = [
    "realized_pnl_by_market_final",
    "wallet_realized_pnl_final",
    "wallet_pnl_summary_final"
  ];

  for (const viewName of testViews) {
    try {
      const result = await queryData(`
        SELECT *
        FROM ${viewName}
        LIMIT 1
      `);
      console.log(`✅ ${viewName}: Executes (${result.length} rows)`);
    } catch (e: any) {
      console.log(`❌ ${viewName}: ERROR`);
      console.log(`   ${e.message?.substring(0, 150)}`);
    }
  }

  console.log("\n");
}

main().catch(console.error);
