#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 30000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("CHECKING VIEW DEFINITIONS");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    console.log("1. realized_pnl_by_market_final definition:");
    const result = await ch.query({
      query: `SELECT create_table_query FROM system.tables 
               WHERE name = 'realized_pnl_by_market_final' AND database = 'default'`,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      console.log(data[0][0]);
    } else {
      console.log("   View not found");
    }
  } catch (e: any) {
    console.log(`   Error: ${e.message}`);
  }

  console.log("\n════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
