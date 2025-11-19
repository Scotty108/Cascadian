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
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("SCHEMA INSPECTION");
  console.log("════════════════════════════════════════════════════════════════\n");

  const tables = ['outcome_positions_v2', 'trade_cashflows_v3', 'winning_index'];

  for (const table of tables) {
    console.log(`TABLE: ${table}`);
    console.log("─".repeat(70));

    const result = await queryData(`
      SELECT 
        name,
        type
      FROM system.columns
      WHERE table = '${table}' AND database = 'default'
      ORDER BY position
    `);

    if (result && result.length > 0) {
      for (const row of result) {
        const colName = row[0];
        const colType = row[1];
        console.log(`  ${colName.padEnd(25)} | ${colType}`);
      }
    }
    console.log("");
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
