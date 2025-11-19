#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`ERROR: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("\n🔍 FINDING RESOLUTION DATA SOURCES\n");
  
  // List of candidate tables that might have resolution data
  const tables = [
    "market_resolutions",
    "market_resolutions_final",
    "market_outcomes",
    "resolved_trades_v1",
    "resolved_trades_v2",
    "resolution_status_cache",
  ];
  
  for (const table of tables) {
    try {
      const count = await queryData(`SELECT COUNT(*) FROM ${table}`);
      const distinct = await queryData(`SELECT COUNT(DISTINCT condition_id_norm) FROM ${table}`);
      console.log(`${table}: ${count[0][0]} rows, ${distinct[0][0]} unique conditions`);
    } catch (e) {
      console.log(`${table}: [not accessible]`);
    }
  }
  
  // Check if market_outcomes has the winner info
  console.log("\nChecking market_outcomes schema:");
  try {
    const schema = await queryData("DESC market_outcomes");
    for (const row of schema.slice(0, 10)) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
  } catch (e) {
    console.log("  [error]");
  }
}

main();
