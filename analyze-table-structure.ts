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
  console.log("\n📊 TABLE STRUCTURE ANALYSIS\n");

  try {
    // Check outcome_positions_v2 structure
    const pos = await ch.query({
      query: "DESC outcome_positions_v2",
      format: "JSONCompact"
    });
    const posText = await pos.text();
    const posData = JSON.parse(posText).data || [];
    
    console.log("outcome_positions_v2 columns:");
    for (const row of posData) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
    
    // Check trade_cashflows_v3 structure
    const cash = await ch.query({
      query: "DESC trade_cashflows_v3",
      format: "JSONCompact"
    });
    const cashText = await cash.text();
    const cashData = JSON.parse(cashText).data || [];
    
    console.log("\ntrade_cashflows_v3 columns:");
    for (const row of cashData) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
    
    // Check for a source table with condition_id_norm
    const trades = await ch.query({
      query: "DESC trades_raw LIMIT 20",
      format: "JSONCompact"
    });
    const tradesText = await trades.text();
    const tradesData = JSON.parse(tradesText).data || [];
    
    console.log("\ntrades_raw columns (first 10):");
    for (const row of tradesData.slice(0, 10)) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
