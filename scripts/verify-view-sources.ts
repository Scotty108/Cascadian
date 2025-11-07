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
    console.log("Checking view definitions...\n");

    // Check trade_cashflows_v3
    const cf = await ch.query({
      query: "SHOW CREATE VIEW trade_cashflows_v3",
    });
    const cfText = await cf.text();
    console.log("trade_cashflows_v3:\n", cfText.substring(0, 300), "\n");

    // Check outcome_positions_v2
    const op = await ch.query({
      query: "SHOW CREATE VIEW outcome_positions_v2",
    });
    const opText = await op.text();
    console.log("outcome_positions_v2:\n", opText.substring(0, 300), "\n");

    // Check realized_pnl_by_market_final
    const rp = await ch.query({
      query: "SHOW CREATE VIEW realized_pnl_by_market_final",
    });
    const rpText = await rp.text();
    console.log("realized_pnl_by_market_final:\n", rpText.substring(0, 500), "\n");
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main().catch(console.error);
