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
  console.log("SEARCHING FOR TABLES WITH FEE/TIMESTAMP INFO");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Find all tables
  const tables = await queryData(`
    SELECT name
    FROM system.tables
    WHERE database = 'default'
    ORDER BY name
  `);

  if (!tables || tables.length === 0) {
    console.log("No tables found");
    return;
  }

  console.log("1. ALL TABLES IN DEFAULT DB:");
  console.log("─".repeat(70));
  for (const row of tables) {
    const tableName = row[0];
    if (!tableName.includes('system')) {
      console.log(`  ${tableName}`);
    }
  }
  console.log("");

  // Search for tables with fee columns
  console.log("2. TABLES WITH FEE/SLIPPAGE COLUMNS:");
  console.log("─".repeat(70));

  const result = await queryData(`
    SELECT DISTINCT table
    FROM system.columns
    WHERE database = 'default'
      AND (
        name ILIKE '%fee%' OR 
        name ILIKE '%slippage%' OR 
        name ILIKE '%cost%'
      )
  `);

  if (result && result.length > 0) {
    for (const row of result) {
      console.log(`  ${row[0]}`);
      
      // Show columns for this table
      const cols = await queryData(`
        SELECT name, type
        FROM system.columns
        WHERE database = 'default' AND table = '${row[0]}'
          AND (name ILIKE '%fee%' OR name ILIKE '%slippage%' OR name ILIKE '%cost%')
      `);
      
      if (cols && cols.length > 0) {
        for (const col of cols) {
          console.log(`    - ${col[0]}: ${col[1]}`);
        }
      }
    }
  } else {
    console.log("  (none found)");
  }
  console.log("");

  // Search for tables with timestamp columns
  console.log("3. TABLES WITH TIMESTAMP COLUMNS:");
  console.log("─".repeat(70));

  const tsResult = await queryData(`
    SELECT DISTINCT table
    FROM system.columns
    WHERE database = 'default'
      AND (
        name ILIKE '%timestamp%' OR 
        name ILIKE '%time%' OR
        name ILIKE '%at%'
      )
    ORDER BY table
  `);

  if (tsResult && tsResult.length > 0) {
    for (const row of tsResult) {
      const tname = row[0];
      if (!tname.includes('system')) {
        console.log(`  ${tname}`);
      }
    }
  }
  console.log("");

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
