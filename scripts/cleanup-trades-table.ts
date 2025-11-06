#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

async function main() {
  try {
    console.log("Dropping pm_trades table...");
    await ch.exec({
      query: "DROP TABLE IF EXISTS pm_trades",
    });
    console.log("✅ pm_trades table dropped\n");

    // Recreate the table
    console.log("Creating fresh pm_trades table...");
    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS pm_trades
        (
          fill_id         String,
          proxy_wallet    String,
          market_id       String,
          outcome_id      String,
          side            String,
          price           String,
          size            String,
          ts              DateTime,
          notional        String,
          insert_time     DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree()
        PARTITION BY toYYYYMM(ts)
        ORDER BY (proxy_wallet, ts, fill_id)
      `,
    });

    console.log("✅ pm_trades table recreated\n");

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
