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
  console.log("TESTING THE VIEWS TO UNDERSTAND THE PROBLEM\n");
  
  try {
    // Test 1: Check what fields wallet_pnl_summary_v2 actually has
    const schema = await ch.query({
      query: "DESC wallet_pnl_summary_v2",
      format: "JSONCompact"
    });
    
    const schemaText = await schema.text();
    const schemaData = JSON.parse(schemaText).data || [];
    
    console.log("wallet_pnl_summary_v2 SCHEMA:");
    for (const row of schemaData) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
    
    // Test 2: Query it
    console.log("\n═══════════════════════════════════════════════════════════\n");
    
    const query = `
      SELECT *
      FROM wallet_pnl_summary_v2
      WHERE wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
    `;
    
    const result = await ch.query({
      query,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data[0]) {
      console.log("NIGGEMON DATA FROM wallet_pnl_summary_v2:");
      for (let i = 0; i < schemaData.length && i < data[0].length; i++) {
        console.log(`  ${schemaData[i][0]}: ${data[0][i]}`);
      }
    }
    
    // Test 3: Check trade_flows_v2 to see if cashflows are calculated correctly
    console.log("\n═══════════════════════════════════════════════════════════\n");
    console.log("CHECKING trade_flows_v2 FOR niggemon:\n");
    
    const flowQuery = `
      SELECT
        COUNT(*) as total_flows,
        SUM(cashflow_usdc) as total_cashflows,
        SUM(delta_shares) as total_delta_shares
      FROM trade_flows_v2
      WHERE wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
    `;
    
    const flowResult = await ch.query({
      query: flowQuery,
      format: "JSONCompact"
    });
    
    const flowText = await flowResult.text();
    const flowData = JSON.parse(flowText).data || [];
    
    if (flowData[0]) {
      console.log(`Total flows: ${flowData[0][0]}`);
      console.log(`Total cashflows: $${flowData[0][1]}`);
      console.log(`Total delta shares: ${flowData[0][2]}`);
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
