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
  try {
    const result = await ch.query({
      query: "DESC realized_pnl_by_market_final",
    });
    const text = await result.text();
    console.log("Columns in realized_pnl_by_market_final:\n" + text);
  } catch (e: any) {
    console.error("Error:", e.message);
  }

  try {
    const result = await ch.query({
      query: "SELECT * FROM realized_pnl_by_market_final LIMIT 1 FORMAT JSON",
    });
    const text = await result.text();
    console.log("\nSample data:");
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main().catch(console.error);
