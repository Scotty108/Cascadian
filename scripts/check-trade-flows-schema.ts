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
  console.log("CHECKING trade_flows_v2 SCHEMA");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    const result = await ch.query({
      query: `SELECT name, type FROM system.columns 
               WHERE table = 'trade_flows_v2' AND database = 'default'
               ORDER BY position`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Columns in trade_flows_v2:");
    console.log("─".repeat(70));
    for (const row of data) {
      const name = row[0];
      const type = row[1];
      console.log(`  ${name.padEnd(30)} : ${type}`);
    }

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
