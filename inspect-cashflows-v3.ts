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
  console.log("INSPECTING: trade_cashflows_v3");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Check the definition
  console.log("TABLE DEFINITION:");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT create_table_query
        FROM system.tables
        WHERE database = 'default' AND name = 'trade_cashflows_v3'
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      const query = data[0][0];
      console.log(query);
      console.log();
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  // Check if it's a table or view
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TABLE TYPE AND COLUMNS");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT 
          engine,
          engine_full
        FROM system.tables
        WHERE database = 'default' AND name = 'trade_cashflows_v3'
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      console.log(`Engine: ${data[0][0]}`);
      console.log(`Engine Full: ${data[0][1]}\n`);
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  // Sample a few rows
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("SAMPLE ROWS (First 5 for niggemon)");
  console.log("─".repeat(70));

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    const result = await ch.query({
      query: `
        SELECT *
        FROM trade_cashflows_v3
        WHERE lower(wallet) = lower('${niggemon}')
        LIMIT 5
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      // Print header
      const firstRow = data[0];
      console.log(`Columns: ${firstRow.length}`);
      for (let i = 0; i < firstRow.length && i < 6; i++) {
        console.log(`  [${i}]: ${firstRow[i]}`);
      }
      console.log();

      // Print sample rows
      for (const row of data) {
        console.log(JSON.stringify(row.slice(0, 6)));
      }
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  console.log("\n════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
