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
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  
  console.log("\n🔍 DIAGNOSING 18.7x P&L INFLATION\n");
  console.log("Expected: $101,949.55");
  console.log("Actual:   $1,907,531.19\n");
  
  // Test 1: P&L from resolved conditions only
  const result1 = await ch.query({
    query: `
      SELECT
        sum(c.cashflow_usdc) as pnl_resolved_only
      FROM trade_cashflows_v3 c
      INNER JOIN winning_index w ON c.condition_id_norm = w.condition_id_norm
      WHERE c.wallet = lower('${wallet}')
    `,
    format: "JSONCompact"
  });
  
  const text1 = await result1.text();
  const data1 = JSON.parse(text1).data;
  console.log("Test 1 - P&L from RESOLVED conditions only:");
  console.log(`  ${data1[0][0]}`);
  
  // Test 2: P&L from all conditions
  const result2 = await ch.query({
    query: `
      SELECT
        sum(c.cashflow_usdc) as pnl_all,
        count(*) as trade_count,
        count(DISTINCT c.condition_id_norm) as unique_conditions
      FROM trade_cashflows_v3 c
      WHERE c.wallet = lower('${wallet}')
    `,
    format: "JSONCompact"
  });
  
  const text2 = await result2.text();
  const data2 = JSON.parse(text2).data;
  console.log("\nTest 2 - P&L from ALL conditions:");
  console.log(`  Total: ${data2[0][0]}`);
  console.log(`  Trades: ${data2[0][1]}`);
  console.log(`  Unique conditions: ${data2[0][2]}`);
  
  // Test 3: Check if there are duplicate records per condition
  const result3 = await ch.query({
    query: `
      SELECT 
        MAX(trade_count) as max_trades_per_condition,
        MIN(trade_count) as min_trades_per_condition,
        AVG(trade_count) as avg_trades_per_condition
      FROM (
        SELECT condition_id_norm, COUNT(*) as trade_count
        FROM trade_cashflows_v3
        WHERE wallet = lower('${wallet}')
        GROUP BY condition_id_norm
      )
    `,
    format: "JSONCompact"
  });
  
  const text3 = await result3.text();
  const data3 = JSON.parse(text3).data;
  console.log("\nTest 3 - Duplicate detection:");
  console.log(`  Max trades per condition: ${data3[0][0]}`);
  console.log(`  Min trades per condition: ${data3[0][1]}`);
  console.log(`  Avg trades per condition: ${data3[0][2]}`);
}

main().catch(console.error);
