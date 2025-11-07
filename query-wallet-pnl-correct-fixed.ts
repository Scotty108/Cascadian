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
  console.log("\n═══════════════════════════════════════════════════════════\n");
  console.log("QUERYING wallet_pnl_correct TABLE\n");
  
  try {
    // Check schema first
    const schema = await ch.query({
      query: "DESC wallet_pnl_correct",
      format: "JSONCompact"
    });
    
    const schemaText = await schema.text();
    const schemaData = JSON.parse(schemaText).data || [];
    
    console.log("TABLE SCHEMA:");
    for (const row of schemaData) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
    
    // Now query for our target wallets
    console.log("\n═══════════════════════════════════════════════════════════\n");
    console.log("SEARCHING FOR TARGET WALLETS:\n");
    
    const query = `
      SELECT *
      FROM wallet_pnl_correct
      WHERE wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
    `;
    
    const result = await ch.query({
      query,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length === 0) {
      console.log("❌ niggemon not found in wallet_pnl_correct\n");
      
      // Try finding them differently
      console.log("Searching for top P&L wallets to see what's in the table:\n");
      
      const topQuery = `
        SELECT
          wallet_address,
          net_pnl
        FROM wallet_pnl_correct
        ORDER BY net_pnl DESC
        LIMIT 5
      `;
      
      const topResult = await ch.query({
        query: topQuery,
        format: "JSONCompact"
      });
      
      const topText = await topResult.text();
      const topData = JSON.parse(topText).data || [];
      
      console.log("TOP 5 WALLETS BY P&L:");
      for (let i = 0; i < topData.length; i++) {
        const row = topData[i];
        console.log(`${i+1}. ${row[0]}`);
        console.log(`   P&L: $${row[1]}\n`);
      }
    } else {
      console.log("✅ FOUND niggemon:\n");
      console.log("Full row data:");
      console.log(JSON.stringify(data[0], null, 2));
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
