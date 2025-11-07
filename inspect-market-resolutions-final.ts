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
  console.log("\n📋 CHECKING market_resolutions_final SCHEMA\n");

  try {
    const schema = await ch.query({
      query: "DESC market_resolutions_final",
      format: "JSONCompact"
    });
    
    const schemaText = await schema.text();
    const schemaData = JSON.parse(schemaText).data || [];
    
    console.log("Columns:");
    for (const row of schemaData) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
    
    // Sample data
    const sample = await ch.query({
      query: "SELECT * FROM market_resolutions_final LIMIT 3",
      format: "JSONCompact"
    });
    
    const sampleText = await sample.text();
    const sampleData = JSON.parse(sampleText).data || [];
    
    console.log("\nSample row:");
    if (sampleData.length > 0) {
      const row = sampleData[0];
      console.log(JSON.stringify(row, null, 2).substring(0, 500));
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
