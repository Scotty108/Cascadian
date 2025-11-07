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
      query: "SHOW TABLES",
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    console.log("\n📊 ALL TABLES IN DATABASE:\n");
    const relevant = data.filter(row => 
      row[0].includes('outcome') || 
      row[0].includes('cashflow') ||
      row[0].includes('winning') ||
      row[0].includes('unrealized') ||
      row[0].includes('position') ||
      row[0].includes('trade')
    );
    
    if (relevant.length > 0) {
      console.log("Relevant tables:");
      for (const row of relevant) {
        console.log(`  - ${row[0]}`);
      }
    } else {
      console.log("No outcome/cashflow/position/trade tables found!");
    }
    
    console.log("\n📋 Complete table list:");
    for (const row of data) {
      console.log(`  - ${row[0]}`);
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
