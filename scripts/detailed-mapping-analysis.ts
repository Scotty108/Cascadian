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

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

async function queryData(query: string): Promise<any[]> {
  try {
    const result = await ch.query({ query, format: "JSON" });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`  Query error: ${e.message?.substring(0, 100)}`);
    return [];
  }
}

async function main() {
  console.log("Detailed Analysis of Key Mapping Tables\n");

  // 1. gamma_markets
  console.log("=== gamma_markets ===");
  try {
    const ddl = await queryData(`SHOW CREATE TABLE gamma_markets`);
    if (ddl.length > 0) {
      console.log("DDL:");
      console.log(ddl[0].statement?.substring(0, 500));
      console.log("\n");
    }
  } catch (e) {
    console.error("Error getting DDL");
  }

  const gammaMetrics = await queryData(`
    SELECT
      count() as row_count,
      count(DISTINCT market_id) as distinct_markets,
      count(DISTINCT condition_id) as distinct_conditions
    FROM gamma_markets
  `);
  if (gammaMetrics.length > 0) {
    console.log("Metrics:", gammaMetrics[0]);
  }

  const gammaSample = await queryData(`SELECT market_id, condition_id FROM gamma_markets LIMIT 3`);
  console.log("Sample rows:", gammaSample);
  console.log();

  // 2. market_resolutions_final
  console.log("=== market_resolutions_final ===");
  try {
    const ddl = await queryData(`SHOW CREATE TABLE market_resolutions_final`);
    if (ddl.length > 0) {
      console.log("DDL:");
      console.log(ddl[0].statement?.substring(0, 500));
      console.log("\n");
    }
  } catch (e) {
    console.error("Error getting DDL");
  }

  const resMetrics = await queryData(`
    SELECT
      count() as row_count,
      count(DISTINCT market_id) as distinct_markets,
      count(DISTINCT condition_id) as distinct_conditions
    FROM market_resolutions_final
  `);
  if (resMetrics.length > 0) {
    console.log("Metrics:", resMetrics[0]);
  }

  const resSample = await queryData(`SELECT market_id, condition_id FROM market_resolutions_final LIMIT 3`);
  console.log("Sample rows:", resSample);
  console.log();

  // 3. winning_index
  console.log("=== winning_index ===");
  try {
    const ddl = await queryData(`SHOW CREATE TABLE winning_index`);
    if (ddl.length > 0) {
      console.log("DDL:");
      console.log(ddl[0].statement?.substring(0, 500));
      console.log("\n");
    }
  } catch (e) {
    console.error("Error getting DDL");
  }

  const winMetrics = await queryData(`
    SELECT
      count() as row_count,
      count(DISTINCT market_id) as distinct_markets,
      count(DISTINCT condition_id_norm) as distinct_conditions
    FROM winning_index
  `);
  if (winMetrics.length > 0) {
    console.log("Metrics:", winMetrics[0]);
  }

  const winSample = await queryData(`SELECT market_id, condition_id_norm FROM winning_index LIMIT 3`);
  console.log("Sample rows:", winSample);
  console.log();

  // 4. condition_market_map - The key table
  console.log("=== condition_market_map (KEY TABLE) ===");
  try {
    const ddl = await queryData(`SHOW CREATE TABLE condition_market_map`);
    if (ddl.length > 0) {
      console.log("DDL:");
      console.log(ddl[0].statement);
      console.log("\n");
    }
  } catch (e) {
    console.error("Error getting DDL");
  }

  const condMetrics = await queryData(`
    SELECT
      count() as row_count,
      count(DISTINCT market_id) as distinct_markets,
      count(DISTINCT condition_id) as distinct_conditions,
      sum(condition_id IS NULL OR condition_id = '')::UInt64 as null_condition_ids
    FROM condition_market_map
  `);
  if (condMetrics.length > 0) {
    console.log("Metrics:", condMetrics[0]);
  }

  const condSample = await queryData(`SELECT condition_id, market_id, event_id, canonical_category FROM condition_market_map LIMIT 5`);
  console.log("Sample rows:");
  for (const row of condSample) {
    console.log(JSON.stringify(row, null, 2));
  }
  console.log();

  // Test the join
  console.log("=== Join Test: gamma_markets + condition_market_map ===");
  const joinTest = await queryData(`
    SELECT
      g.market_id,
      g.condition_id as gamma_condition,
      c.condition_id as mapped_condition,
      c.canonical_category
    FROM gamma_markets g
    LEFT JOIN condition_market_map c ON g.condition_id = c.condition_id
    LIMIT 5
  `);
  console.log("Join results:");
  for (const row of joinTest) {
    console.log(JSON.stringify(row, null, 2));
  }

  await ch.close();
}

main().catch(console.error);
