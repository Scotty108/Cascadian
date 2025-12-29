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
  console.log("QUERYING wallet_pnl_correct TABLE (EXISTING!)\n");
  
  try {
    // Check schema first
    const schema = await ch.query({
      query: "DESC wallet_pnl_correct LIMIT 20",
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
    console.log("P&L VALUES FOR TARGET WALLETS:\n");
    
    const query = `
      SELECT
        wallet_address,
        net_pnl,
        total_trades,
        total_cashflow
      FROM wallet_pnl_correct
      WHERE wallet_address IN (
        lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'),  -- niggemon
        lower('0x2b92f7ce00000000000000000000000000000d3'),   -- HolyMoses7 (approx)
        lower('0x68a2f5b39969b3dd5a8e8d1e7cdfe16c85f5d5d6')   -- LucasMeow (guess)
      )
      ORDER BY net_pnl DESC
    `;
    
    const result = await ch.query({
      query,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length === 0) {
      console.log("❌ No data for those exact addresses\n");
      
      // Try finding them differently
      console.log("Searching for top P&L wallets to see what's in the table:\n");
      
      const topQuery = `
        SELECT
          wallet_address,
          net_pnl,
          total_trades
        FROM wallet_pnl_correct
        ORDER BY net_pnl DESC
        LIMIT 10
      `;
      
      const topResult = await ch.query({
        query: topQuery,
        format: "JSONCompact"
      });
      
      const topText = await topResult.text();
      const topData = JSON.parse(topText).data || [];
      
      console.log("TOP 10 WALLETS BY P&L:");
      for (let i = 0; i < topData.length; i++) {
        const row = topData[i];
        console.log(`${i+1}. ${row[0].substring(0, 20)}...`);
        console.log(`   P&L: $${row[1]}`);
        console.log(`   Trades: ${row[2]}\n`);
      }
    } else {
      console.log("RESULTS:\n");
      for (const row of data) {
        console.log(`Wallet: ${row[0].substring(0, 20)}...`);
        console.log(`  Net P&L: $${row[1]}`);
        console.log(`  Total trades: ${row[2]}`);
        console.log(`  Total cashflow: $${row[3]}\n`);
      }
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
