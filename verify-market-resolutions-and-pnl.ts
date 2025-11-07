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
  console.log("VERIFYING market_resolutions_final TABLE\n");
  
  try {
    // Step 1: Check table exists and has data
    const tableCheck = await ch.query({
      query: `
        SELECT 
          count() as total_rows,
          uniq(condition_id_norm) as unique_conditions,
          min(resolved_at) as earliest_resolution,
          max(resolved_at) as latest_resolution
        FROM market_resolutions_final
      `,
      format: "JSONCompact"
    });
    
    const tableText = await tableCheck.text();
    const tableData = JSON.parse(tableText).data?.[0];
    
    console.log("✅ market_resolutions_final TABLE EXISTS:");
    console.log(`   Rows: ${tableData?.[0]?.toLocaleString() || 'N/A'}`);
    console.log(`   Unique conditions: ${tableData?.[1]?.toLocaleString() || 'N/A'}`);
    console.log(`   Date range: ${tableData?.[2]} to ${tableData?.[3]}\n`);
    
    // Step 2: Sample the data structure
    console.log("SAMPLE RESOLUTION DATA:");
    const sample = await ch.query({
      query: `
        SELECT 
          condition_id_norm,
          winning_outcome,
          resolved_at
        FROM market_resolutions_final 
        LIMIT 3
      `,
      format: "JSONCompact"
    });
    
    const sampleText = await sample.text();
    const sampleData = JSON.parse(sampleText).data || [];
    
    for (const row of sampleData) {
      console.log(`   ${row[0].substring(0,16)}... won: '${row[1]}' at ${row[2]}`);
    }
    
    // Step 3: THE CRITICAL QUERY - Direct P&L calculation using market_resolutions_final
    console.log("\n═══════════════════════════════════════════════════════════\n");
    console.log("CALCULATING P&L USING market_resolutions_final:\n");
    
    const pnlQuery = `
      SELECT
        lower(t.wallet_address) as wallet,
        COUNT(*) as total_trades,
        
        -- CASHFLOWS: Sum of all trade costs/proceeds
        SUM(
          CASE 
            WHEN lower(t.side) = 'buy' THEN -(t.shares * t.entry_price)
            WHEN lower(t.side) = 'sell' THEN (t.shares * t.entry_price)
            ELSE 0
          END
        ) as cashflows,
        
        -- SETTLEMENT: Shares held in winning outcome at resolution
        SUM(
          CASE 
            WHEN m.winning_outcome IS NOT NULL 
            AND t.outcome_index = indexOf(splitByString(',', replaceAll(m.winning_outcome, ' ', '')), '') - 1
            THEN t.shares
            ELSE 0
          END
        ) as winning_shares,
        
        -- FINAL P&L
        cashflows + winning_shares as realized_pnl_usd
        
      FROM trades_raw t
      
      -- Join to resolution data using market_id
      LEFT JOIN condition_market_map cm ON lower(t.market_id) = lower(cm.market_id)
      LEFT JOIN market_resolutions_final m 
        ON lower(replaceAll(cm.condition_id, '0x', '')) = lower(m.condition_id_norm)
      
      WHERE lower(t.wallet_address) IN (
        lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      )
      GROUP BY wallet
      ORDER BY realized_pnl_usd DESC
    `;
    
    const pnlResult = await ch.query({
      query: pnlQuery,
      format: "JSONCompact"
    });
    
    const pnlText = await pnlResult.text();
    const pnlData = JSON.parse(pnlText).data || [];
    
    console.log("niggemon P&L RESULT:");
    if (pnlData[0]) {
      console.log(`  Wallet: ${pnlData[0][0].substring(0, 10)}...`);
      console.log(`  Total trades: ${pnlData[0][1]}`);
      console.log(`  Cashflows: $${pnlData[0][2]}`);
      console.log(`  Winning shares: ${pnlData[0][3]}`);
      console.log(`  Realized P&L: $${pnlData[0][4]}`);
      console.log(`\n  Target (Polymarket): $101,949.55`);
      console.log(`  Expected variance: -2.3% → $99,691.54`);
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
