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
  console.log("UNDERSTANDING WHY SIMPLE APPROACH FAILED ($11.5M vs $99K)\n");
  
  try {
    // Check what the side field ACTUALLY contains
    console.log("Step 1: What are the actual side values?\n");
    
    const sideCheck = await ch.query({
      query: `
        SELECT 
          side,
          COUNT(*) as count,
          ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM trades_raw), 2) as pct
        FROM trades_raw
        WHERE wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
        GROUP BY side
        ORDER BY count DESC
      `,
      format: "JSONCompact"
    });
    
    const sideText = await sideCheck.text();
    const sideData = JSON.parse(sideText).data || [];
    
    for (const row of sideData) {
      console.log(`  side=${row[0]}: ${row[1]} trades (${row[2]}%)`);
    }
    
    // Check the distribution of cashflows
    console.log("\nStep 2: Cashflow distribution breakdown\n");
    
    const flows = await ch.query({
      query: `
        SELECT
          CASE 
            WHEN side = 1 THEN 'side=1 (BUY?)'
            WHEN side = 2 THEN 'side=2 (SELL?)'
            ELSE 'other'
          END as side_label,
          COUNT(*) as count,
          SUM(shares * entry_price) as total_value,
          ROUND(total_value / count, 4) as avg_trade_value
        FROM trades_raw
        WHERE wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
        GROUP BY side_label
      `,
      format: "JSONCompact"
    });
    
    const flowText = await flows.text();
    const flowData = JSON.parse(flowText).data || [];
    
    for (const row of flowData) {
      console.log(`  ${row[0]}`);
      console.log(`    Trades: ${row[1]}`);
      console.log(`    Total value: $${row[2]}`);
      console.log(`    Avg per trade: $${row[3]}\n`);
    }
    
    // THE KEY: Show what the simple formula is doing wrong
    console.log("Step 3: Why the simple formula is inflated\n");
    
    const simple = await ch.query({
      query: `
        SELECT
          'Simple formula' as method,
          SUM(
            CASE 
              WHEN side = 1 THEN -(shares * entry_price)
              WHEN side = 2 THEN (shares * entry_price)
              ELSE 0
            END
          ) as result
        FROM trades_raw
        WHERE wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      `,
      format: "JSONCompact"
    });
    
    const simpleText = await simple.text();
    const simpleData = JSON.parse(simpleText).data || [];
    
    if (simpleData[0]) {
      console.log(`Simple formula gives: $${simpleData[0][1]}`);
      console.log(`Expected: ~$99,691`);
      console.log(`Ratio: ${(parseFloat(simpleData[0][1]) / 99691).toFixed(1)}x too high\n`);
    }
    
    // THE ANSWER: What the correct formula does differently
    console.log("Step 4: What SHOULD happen\n");
    console.log("The correct formula from realized-pnl-corrected.ts does:");
    console.log("  1. Group trades by MARKET");
    console.log("  2. For each market:");
    console.log("     a. Calculate net cashflows (BUY negative, SELL positive)");
    console.log("     b. Check if market is RESOLVED");
    console.log("     c. Add settlement: (winning_shares × $1.00)");
    console.log("  3. Sum across all markets\n");
    console.log("This filters out UNRESOLVED markets where settlement=0");
    console.log("And only counts RESOLVED markets where we know the outcome\n");
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
