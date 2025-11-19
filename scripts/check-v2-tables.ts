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
  console.log("CHECKING wallet_realized_pnl_v2");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    const result = await ch.query({
      query: `SELECT wallet, realized_pnl_usd FROM wallet_realized_pnl_v2 
               WHERE lower(wallet) = lower('${niggemon}')`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data.length > 0) {
      console.log(`✅ wallet_realized_pnl_v2 exists with data:`);
      for (const row of data) {
        console.log(`   Realized P&L: $${parseFloat(row[1]).toFixed(2)}`);
      }
    } else {
      console.log(`⚠️  Table exists but no data for niggemon`);
    }
  } catch (e: any) {
    console.log(`❌ Error: ${e.message.split('\n')[0]}`);
  }

  // Check the schema
  console.log("\n\nChecking wallet_realized_pnl_v2 schema:");
  try {
    const result = await ch.query({
      query: `SELECT name, type FROM system.columns 
               WHERE table = 'wallet_realized_pnl_v2' AND database = 'default'`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      console.log(`  ${row[0].padEnd(30)}: ${row[1]}`);
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}`);
  }
}

main().catch(console.error);
