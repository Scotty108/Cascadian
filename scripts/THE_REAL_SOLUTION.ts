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
  console.log("\n════════════════════════════════════════════════════════════\n");
  console.log("THE ACTUAL SOLUTION: How the -2.3% Formula REALLY Works\n");
  console.log("════════════════════════════════════════════════════════════\n");
  
  try {
    // The REAL issue: You need to use the view chain from realized-pnl-corrected.ts
    // But first, verify trade_flows_v2 was created correctly
    
    console.log("STEP 1: Verify trade_flows_v2 view exists and works\n");
    
    const tradeFlows = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_flows,
          SUM(cashflow_usdc) as total_cashflows,
          SUM(delta_shares) as total_shares
        FROM trade_flows_v2
        WHERE wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      `,
      format: "JSONCompact"
    });
    
    const flowText = await tradeFlows.text();
    const flowData = JSON.parse(flowText).data || [];
    
    if (flowData[0]) {
      console.log(`✓ trade_flows_v2 exists`);
      console.log(`  Total flows: ${flowData[0][0]}`);
      console.log(`  Total cashflows: $${flowData[0][1]}`);
      console.log(`  Total delta_shares: ${flowData[0][2]}\n`);
    } else {
      console.log("✗ trade_flows_v2 view not found or empty\n");
    }
    
    // Step 2: Check realized_pnl_by_market_v2
    console.log("STEP 2: Check realized_pnl_by_market_v2 view\n");
    
    const byMarket = await ch.query({
      query: `
        SELECT
          COUNT(*) as markets,
          SUM(realized_pnl_usd) as total_pnl,
          SUM(fill_count) as total_fills
        FROM realized_pnl_by_market_v2
        WHERE wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      `,
      format: "JSONCompact"
    });
    
    const marketText = await byMarket.text();
    const marketData = JSON.parse(marketText).data || [];
    
    if (marketData[0]) {
      console.log(`✓ realized_pnl_by_market_v2 exists`);
      console.log(`  Markets: ${marketData[0][0]}`);
      console.log(`  Total P&L: $${marketData[0][1]}`);
      console.log(`  Total fills: ${marketData[0][2]}\n`);
    }
    
    // Step 3: Query wallet_pnl_summary_v2
    console.log("STEP 3: THE FINAL ANSWER - Query wallet_pnl_summary_v2\n");
    
    const summary = await ch.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd,
          unrealized_pnl_usd,
          total_pnl_usd
        FROM wallet_pnl_summary_v2
        WHERE wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      `,
      format: "JSONCompact"
    });
    
    const summaryText = await summary.text();
    const summaryData = JSON.parse(summaryText).data || [];
    
    if (summaryData[0]) {
      const realized = summaryData[0][1];
      const unrealized = summaryData[0][2];
      const total = summaryData[0][3];
      
      console.log(`✓ FINAL RESULTS:\n`);
      console.log(`  Realized P&L:   $${realized}`);
      console.log(`  Unrealized P&L: $${unrealized}`);
      console.log(`  TOTAL P&L:      $${total}\n`);
      
      console.log(`  Expected:       $102,001.46`);
      console.log(`  Variance:       ${(((total - 102001.46) / 102001.46) * 100).toFixed(2)}%\n`);
      
      if (Math.abs(total - 99691.54) < 1) {
        console.log("✅ THIS IS THE -2.3% ACCURACY RESULT!\n");
      }
    } else {
      console.log("✗ wallet_pnl_summary_v2 view not found or empty\n");
      console.log("DIAGNOSIS: The views from realized-pnl-corrected.ts are either:");
      console.log("  1. Not created yet");
      console.log("  2. Created but broken (join issues)");
      console.log("  3. Created with wrong formula\n");
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
    console.log("\nDIAGNOSIS: The views probably don't exist or have issues");
  }
}

main();
