#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("CHECKING realized_pnl_by_market_v2");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  // Get view definition
  try {
    const result = await ch.query({
      query: `SELECT create_table_query FROM system.tables 
               WHERE name = 'realized_pnl_by_market_v2' AND database = 'default'`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data.length > 0) {
      console.log("View Definition:\n");
      const def = data[0][0];
      // Pretty print SQL
      const formatted = def.replace(/FROM/g, '\nFROM').replace(/JOIN/g, '\nJOIN').replace(/WHERE/g, '\nWHERE').replace(/GROUP/g, '\nGROUP');
      console.log(formatted);
      console.log("\n");
    }
  } catch (e: any) {
    console.log(`Could not get view definition: ${e.message}\n`);
  }

  // Check schema
  console.log("════════════════════════════════════════════════════════════════\n");
  console.log("Schema:\n");

  try {
    const result = await ch.query({
      query: `SELECT name, type FROM system.columns 
               WHERE table = 'realized_pnl_by_market_v2' AND database = 'default'`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      console.log(`  ${row[0].padEnd(30)}: ${row[1]}`);
    }

    console.log("\n");
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  // Get sample data for niggemon
  console.log("════════════════════════════════════════════════════════════════\n");
  console.log("Sample Data (first 10 rows for niggemon):\n");

  try {
    const result = await ch.query({
      query: `SELECT * FROM realized_pnl_by_market_v2 
               WHERE lower(wallet) = lower('${niggemon}')
               ORDER BY realized_pnl_usd DESC
               LIMIT 10`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      console.log(JSON.stringify(row));
    }

    console.log("\n");
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
