#!/usr/bin/env npx tsx

import fs from "fs";
import path from "path";
import { createClient } from "@clickhouse/client";

// Load env manually
const envPath = path.resolve(".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const lines = envContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...rest] = trimmed.split("=");
      if (key && rest.length > 0) {
        process.env[key] = rest.join("=").replace(/^["']|["']$/g, '');
      }
    }
  }
}

console.log("Connecting to ClickHouse...");
console.log("Host:", process.env.CLICKHOUSE_HOST?.substring(0, 50));

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

interface TableInfo {
  name: string;
  exists: boolean;
  ddl?: string;
  rowCount?: number;
  distinctMarketIds?: number;
  distinctConditionIds?: number;
  nullMarketIds?: number;
  nullConditionIds?: number;
  isDuplicate?: boolean;
  sampleRows?: any[];
  error?: string;
}

async function queryData(query: string): Promise<any[]> {
  try {
    const result = await ch.query({ query, format: "JSON" });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    return [];
  }
}

async function checkTableExists(tableName: string): Promise<boolean> {
  const result = await queryData(`
    SELECT name FROM system.tables 
    WHERE database = currentDatabase() AND name = '${tableName}'
  `);
  return result.length > 0;
}

async function getTableDDL(tableName: string): Promise<string> {
  const result = await queryData(`SHOW CREATE TABLE ${tableName}`);
  return result.length > 0 ? result[0].statement : "";
}

async function analyzeTable(tableName: string, marketIdCol: string, conditionIdCol: string): Promise<TableInfo> {
  const info: TableInfo = { name: tableName, exists: false };

  try {
    const exists = await checkTableExists(tableName);
    if (!exists) {
      info.exists = false;
      info.error = "Table does not exist";
      return info;
    }

    info.exists = true;
    info.ddl = await getTableDDL(tableName);

    // Get metrics
    const metricsQuery = `
      SELECT
        count() as row_count,
        count(DISTINCT ${marketIdCol}) as distinct_market_ids,
        count(DISTINCT ${conditionIdCol}) as distinct_condition_ids,
        sum(${marketIdCol} IS NULL OR ${marketIdCol} = '')::UInt64 as null_market_ids,
        sum(${conditionIdCol} IS NULL OR ${conditionIdCol} = '')::UInt64 as null_condition_ids
      FROM ${tableName}
    `;

    const metrics = await queryData(metricsQuery);
    if (metrics.length > 0) {
      const m = metrics[0];
      info.rowCount = parseInt(m.row_count || 0);
      info.distinctMarketIds = parseInt(m.distinct_market_ids || 0);
      info.distinctConditionIds = parseInt(m.distinct_condition_ids || 0);
      info.nullMarketIds = parseInt(m.null_market_ids || 0);
      info.nullConditionIds = parseInt(m.null_condition_ids || 0);
      info.isDuplicate = info.distinctMarketIds < info.rowCount && info.rowCount > 0;
    }

    // Get sample rows
    const sampleQuery = `
      SELECT ${marketIdCol}, ${conditionIdCol}
      FROM ${tableName}
      WHERE ${marketIdCol} != '' AND ${conditionIdCol} != ''
      LIMIT 5
    `;

    const samples = await queryData(sampleQuery);
    info.sampleRows = samples;

  } catch (e: any) {
    info.error = e.message?.substring(0, 200);
  }

  return info;
}

async function main() {
  console.log("=========================================");
  console.log("ClickHouse Market-Condition Mapping Analysis");
  console.log("=========================================\n");

  const tables: [string, string, string][] = [
    ["ctf_token_map", "market_id", "condition_id_norm"],
    ["condition_market_map", "market_id", "condition_id"],
    ["gamma_markets", "market_id", "condition_id"],
    ["markets_enriched", "market_id", "condition_id"],
    ["market_resolutions_final", "market_id", "condition_id"],
    ["winning_index", "market_id", "condition_id_norm"],
    ["trades_raw", "market_id", "condition_id"],
    ["wallet_resolution_outcomes", "market_id", "condition_id"],
  ];

  const results: TableInfo[] = [];

  for (const [tableName, marketIdCol, conditionIdCol] of tables) {
    console.log(`Analyzing ${tableName}...`);
    const info = await analyzeTable(tableName, marketIdCol, conditionIdCol);
    results.push(info);
    console.log(`  ✓ Complete\n`);
  }

  // Generate summary
  console.log("\n=========================================");
  console.log("SUMMARY TABLE");
  console.log("=========================================\n");

  console.log("| Table Name | Exists | Row Count | Dist Markets | Dist Conditions | NULL Market % | NULL Condition % | Duplicates? |");
  console.log("|---|---|---|---|---|---|---|---|");

  for (const table of results) {
    const exists = table.exists ? "YES" : "NO";
    const rows = table.rowCount?.toString() || "N/A";
    const markets = table.distinctMarketIds?.toString() || "N/A";
    const conditions = table.distinctConditionIds?.toString() || "N/A";
    
    let nullMarketPct = "N/A";
    let nullConditionPct = "N/A";
    if (table.rowCount && table.rowCount > 0) {
      nullMarketPct = ((((table.nullMarketIds || 0) / table.rowCount) * 100).toFixed(1)) + "%";
      nullConditionPct = ((((table.nullConditionIds || 0) / table.rowCount) * 100).toFixed(1)) + "%";
    }

    const dupes = table.isDuplicate ? "YES" : "NO";

    console.log(`| ${table.name} | ${exists} | ${rows} | ${markets} | ${conditions} | ${nullMarketPct} | ${nullConditionPct} | ${dupes} |`);
  }

  // Detailed analysis
  console.log("\n\n=========================================");
  console.log("DETAILED ANALYSIS");
  console.log("=========================================\n");

  for (const table of results) {
    if (!table.exists) {
      console.log(`MISSING: ${table.name}`);
      continue;
    }

    console.log(`EXISTS: ${table.name}`);
    console.log(`   Row Count: ${table.rowCount}`);
    console.log(`   Distinct market_id: ${table.distinctMarketIds}`);
    console.log(`   Distinct condition_id: ${table.distinctConditionIds}`);
    console.log(`   NULL market_id: ${table.nullMarketIds} (${(((table.nullMarketIds || 0) / (table.rowCount || 1)) * 100).toFixed(2)}%)`);
    console.log(`   NULL condition_id: ${table.nullConditionIds} (${(((table.nullConditionIds || 0) / (table.rowCount || 1)) * 100).toFixed(2)}%)`);
    console.log(`   Has duplicates: ${table.isDuplicate ? "YES" : "NO"}`);
    
    if (table.sampleRows && table.sampleRows.length > 0) {
      console.log(`   Sample rows:`);
      for (const row of table.sampleRows.slice(0, 3)) {
        console.log(`     ${JSON.stringify(row)}`);
      }
    }

    console.log();
  }

  await ch.close();
}

main().catch(console.error);
