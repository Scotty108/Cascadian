#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 120000,
});

async function main() {
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  
  console.log("Testing direct query...\n");
  
  try {
    const result = await ch.query({
      query: `
        SELECT
          round(sum(c.cashflow_usdc), 2) AS realized_pnl,
          round(coalesce(max(u.unrealized_pnl_usd), 0), 2) AS unrealized_pnl
        FROM trade_cashflows_v3 AS c
        LEFT JOIN wallet_unrealized_pnl_v2 AS u ON u.wallet = c.wallet
        WHERE c.wallet = lower('${wallet}')
      `,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data;
    
    console.log("Result:", JSON.stringify(data));
    console.log("Realized PnL:", data[0][0]);
    console.log("Unrealized PnL:", data[0][1]);
    
  } catch (e: any) {
    console.error("Error:", e.message);
    console.error("Full error:", e);
  }
}

main();
