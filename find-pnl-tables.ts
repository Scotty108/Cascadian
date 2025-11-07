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
  console.log("FINDING ALL P&L-RELATED TABLES");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    const result = await ch.query({
      query: `SELECT name, type FROM system.tables WHERE name LIKE '%pnl%' OR name LIKE '%realized%'`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Tables containing 'pnl' or 'realized':\n");
    for (const row of data) {
      const name = row[0];
      const type = row[1];
      console.log(`  ${name.padEnd(40)} (${type})`);

      // Try to query each table
      try {
        const check = await ch.query({
          query: `SELECT * FROM ${name} WHERE lower(wallet) = lower('${niggemon}') LIMIT 1`,
          format: "JSONCompact"
        });
        const checkText = await check.text();
        const checkData = JSON.parse(checkText).data || [];
        if (checkData.length > 0) {
          console.log(`    ✅ Has data for niggemon`);
        }
      } catch {
        // Table might have different schema or be inaccessible
      }
    }

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }

  // Also check wallet_realized_pnl_v2
  console.log("\n\nChecking wallet_realized_pnl_v2...");
  try {
    const result = await ch.query({
      query: `SELECT wallet, realized_pnl FROM wallet_realized_pnl_v2 
               WHERE lower(wallet) = lower('${niggemon}')`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data.length > 0) {
      console.log(`  ✅ Table exists with data:`);
      for (const row of data) {
        console.log(`     Value: $${parseFloat(row[1]).toFixed(2)}`);
      }
    }
  } catch (e: any) {
    console.log(`  ❌ ${e.message.split('\n')[0]}`);
  }
}

main().catch(console.error);
