#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 30000,
});

async function main() {
  console.log("Checking table schemas...\n");

  // Check winning_index
  console.log("1️⃣  WINNING_INDEX SCHEMA:\n");
  try {
    const result = await ch.query({ query: "SHOW CREATE TABLE winning_index" });
    const text = await result.text();
    console.log(text);
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 200)}`);
  }

  // Check trades_raw columns
  console.log("\n2️⃣  TRADES_RAW COLUMNS:\n");
  try {
    const result = await ch.query({ query: "SHOW COLUMNS FROM trades_raw LIMIT 40" });
    const text = await result.text();
    console.log(text);
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 200)}`);
  }

  // Sample winning_index
  console.log("\n3️⃣  WINNING_INDEX SAMPLE:\n");
  try {
    const result = await ch.query({ query: "SELECT * FROM winning_index LIMIT 3", format: 'JSON' });
    const text = await result.text();
    const data = JSON.parse(text);
    console.log(JSON.stringify(data.data, null, 2));
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 200)}`);
  }
}

main().catch(console.error);
