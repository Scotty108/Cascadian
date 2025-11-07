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
  console.log("CHECKING outcome_positions_v2 TABLE\n");
  
  try {
    // Check schema
    const schema = await ch.query({
      query: "DESC outcome_positions_v2",
      format: "JSONCompact"
    });
    
    const schemaText = await schema.text();
    const schemaData = JSON.parse(schemaText).data || [];
    
    console.log("SCHEMA:");
    for (const row of schemaData) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
    
    // Sample data
    console.log("\n═══════════════════════════════════════════════════════════\n");
    console.log("SAMPLE DATA:\n");
    
    const sample = await ch.query({
      query: "SELECT * FROM outcome_positions_v2 LIMIT 1",
      format: "JSONCompact"
    });
    
    const sampleText = await sample.text();
    const sampleData = JSON.parse(sampleText).data || [];
    
    if (sampleData[0]) {
      console.log("First row fields:");
      const schemaMap = schemaData.reduce((acc: any, row: any[]) => {
        acc[row[0]] = row[1];
        return acc;
      }, {});
      
      const firstRow = sampleData[0];
      const keys = Object.keys(schemaMap);
      
      for (let i = 0; i < Math.min(5, firstRow.length); i++) {
        console.log(`  ${keys[i]}: ${firstRow[i]}`);
      }
    }
    
    // Check if niggemon exists
    console.log("\n═══════════════════════════════════════════════════════════\n");
    console.log("SEARCHING outcome_positions_v2 FOR niggemon:\n");
    
    const nigQuery = `
      SELECT
        wallet_address,
        COUNT(*) as position_count,
        SUM(realized_pnl_usd) as total_realized_pnl
      FROM outcome_positions_v2
      WHERE wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      GROUP BY wallet_address
    `;
    
    const nigResult = await ch.query({
      query: nigQuery,
      format: "JSONCompact"
    });
    
    const nigText = await nigResult.text();
    const nigData = JSON.parse(nigText).data || [];
    
    if (nigData[0]) {
      console.log(`Wallet: ${nigData[0][0].substring(0, 20)}...`);
      console.log(`  Positions: ${nigData[0][1]}`);
      console.log(`  Realized P&L: $${nigData[0][2]}`);
    } else {
      console.log("niggemon not found - trying walletless search");
      
      const countQuery = `SELECT COUNT(*) as cnt FROM outcome_positions_v2`;
      const countResult = await ch.query({
        query: countQuery,
        format: "JSONCompact"
      });
      
      const countText = await countResult.text();
      const countData = JSON.parse(countText).data || [];
      console.log(`\nTotal rows in table: ${countData[0]?.[0]}`);
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
