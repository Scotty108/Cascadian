#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 30000,
});

async function describeTable(tableName: string) {
  try {
    const result = await ch.query({
      query: `SELECT name, type FROM system.columns WHERE table = '${tableName}' AND database = 'default' ORDER BY position`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log(`\n📋 ${tableName}:`);
    console.log("─".repeat(70));
    if (data.length === 0) {
      console.log(`  ❌ TABLE NOT FOUND`);
      return false;
    }
    
    for (const row of data) {
      console.log(`  ${row[0].padEnd(30)} : ${row[1]}`);
    }
    return true;
  } catch (e: any) {
    console.log(`  ❌ ERROR: ${e.message.split('\n')[0]}`);
    return false;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("PHASE 2 STEP 1: SANITY CHECK - CONFIRM SOURCE COLUMNS");
  console.log("════════════════════════════════════════════════════════════════");

  const tables = [
    "outcome_positions_v2",
    "trade_cashflows_v3",
    "trade_flows_v2",
    "canonical_condition",
    "winning_index"
  ];

  let allFound = true;
  for (const table of tables) {
    if (!await describeTable(table)) {
      allFound = false;
    }
  }

  console.log("\n" + "═".repeat(70));
  if (allFound) {
    console.log("✅ ALL REQUIRED TABLES FOUND");
  } else {
    console.log("❌ SOME TABLES MISSING - CANNOT PROCEED");
  }
  console.log("═".repeat(70) + "\n");
}

main().catch(console.error);
