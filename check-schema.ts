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
  const tables = ["resolved_trades_v2", "trade_cashflows_v3", "trades_raw"];

  for (const table of tables) {
    console.log(`\n${table}:`);
    console.log("─".repeat(60));
    
    try {
      const result = await ch.query({
        query: `DESC ${table}`,
        format: "JSONCompact"
      });

      const text = await result.text();
      const data = JSON.parse(text).data;
      
      for (const row of data) {
        const [name, type] = row;
        console.log(`  ${name.padEnd(25)} ${type}`);
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e.message.substring(0, 60)}...`);
    }
  }
}

main().catch(console.error);
