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
  try {
    const result = await ch.query({
      query: "SHOW TABLES LIKE '%outcome%' OR LIKE '%cashflow%' OR LIKE '%winning%'",
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    console.log("\n📊 TABLES IN DATABASE:\n");
    if (data.length === 0) {
      console.log("  No outcome/cashflow/winning tables found!");
    } else {
      for (const row of data) {
        console.log(`  - ${row[0]}`);
      }
    }
    
    console.log("\n📋 ALL TABLES:\n");
    const allResult = await ch.query({
      query: "SHOW TABLES",
      format: "JSONCompact"
    });
    
    const allText = await allResult.text();
    const allData = JSON.parse(allText).data || [];
    
    for (const row of allData) {
      console.log(`  - ${row[0]}`);
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
