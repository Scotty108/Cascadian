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
  console.log("SCHEMA: ENRICHED TABLES");
  console.log("════════════════════════════════════════════════════════════════\n");

  const tables = [
    'trades_enriched_with_condition',
    'trades_with_recovered_cid',
    'trades_enriched',
    'trades_dedup'
  ];

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
        console.log(`  ${row[0].padEnd(25)} | ${row[1]}`);
      }
    }
    console.log("");
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
