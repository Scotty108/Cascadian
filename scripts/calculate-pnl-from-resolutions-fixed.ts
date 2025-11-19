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
  console.log("DIRECT P&L CALCULATION FROM market_resolutions_final\n");
  
  try {
    // Simpler approach: Just check the view that was supposed to work
    const viewQuery = `
      SELECT
        wallet,
        realized_pnl_usd,
        unrealized_pnl_usd,
        total_pnl_usd,
        markets_with_realized,
        total_realized_fills
      FROM wallet_pnl_summary_v2
      WHERE wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
    `;
    
    console.log("Querying wallet_pnl_summary_v2 (the view that should be correct):\n");
    
    const result = await ch.query({
      query: viewQuery,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data[0]) {
      const row = data[0];
      console.log(`NIGGEMON (0xeb6f...25f0):`);
      console.log(`  Realized P&L:        $${row[1]}`);
      console.log(`  Unrealized P&L:      $${row[2]}`);
      console.log(`  Total P&L:           $${row[3]}`);
      console.log(`  Markets resolved:    ${row[4]}`);
      console.log(`  Total trades:        ${row[5]}`);
      console.log(`\n  Polymarket target:   $101,949.55`);
      console.log(`  Expected (within -2.3%): $99,691.54`);
      
      // Check variance
      const calc = parseFloat(row[1]);
      const target = 101949.55;
      const variance = ((calc - target) / target * 100).toFixed(2);
      console.log(`  Actual variance:     ${variance}%`);
    } else {
      console.log("❌ NO DATA RETURNED - view may be empty\n");
      
      // Try to find data another way
      console.log("Checking if trades exist for this wallet:\n");
      const tradesCheck = await ch.query({
        query: `
          SELECT 
            wallet_address,
            COUNT(*) as count,
            COUNT(DISTINCT market_id) as markets,
            SUM(CASE WHEN side = 1 THEN 1 ELSE 0 END) as buys,
            SUM(CASE WHEN side = 2 THEN 1 ELSE 0 END) as sells
          FROM trades_raw
          WHERE wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
          GROUP BY wallet_address
        `,
        format: "JSONCompact"
      });
      
      const tradesText = await tradesCheck.text();
      const tradesData = JSON.parse(tradesText).data || [];
      
      if (tradesData[0]) {
        console.log(`  Total trades: ${tradesData[0][1]}`);
        console.log(`  Markets: ${tradesData[0][2]}`);
        console.log(`  Buys: ${tradesData[0][3]}`);
        console.log(`  Sells: ${tradesData[0][4]}`);
      }
    }
    
    // Also check what tables actually have data
    console.log("\n═══════════════════════════════════════════════════════════\n");
    console.log("CHECKING CONDITION_MARKET_MAP LINK:\n");
    
    const linkCheck = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_links,
          COUNT(DISTINCT market_id) as unique_markets,
          COUNT(DISTINCT condition_id) as unique_conditions
        FROM condition_market_map
      `,
      format: "JSONCompact"
    });
    
    const linkText = await linkCheck.text();
    const linkData = JSON.parse(linkText).data?.[0];
    
    console.log(`Total mappings: ${linkData?.[0]}`);
    console.log(`Unique markets: ${linkData?.[1]}`);
    console.log(`Unique conditions: ${linkData?.[2]}`);
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
