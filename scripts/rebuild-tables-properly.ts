#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 300000,
});

async function main() {
  console.log("\n🔧 REBUILDING TABLES WITH PROPER DATA QUALITY\n");

  try {
    console.log("Step 1: Creating outcome_positions_v2_fixed (filtering out zero net_shares and empty condition_id_norm)...");
    
    await ch.command({
      query: `
        CREATE TABLE outcome_positions_v2_fixed
        ENGINE = MergeTree()
        ORDER BY (wallet, condition_id_norm)
        AS SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          net_shares
        FROM outcome_positions_v2
        WHERE net_shares != 0 AND condition_id_norm != ''
      `
    });
    
    console.log("  ✅ Created outcome_positions_v2_fixed (with valid condition_id_norm only)");
    
    console.log("\nStep 2: Creating trade_cashflows_v3_fixed (filtering out zero cashflow and empty condition_id_norm)...");
    
    await ch.command({
      query: `
        CREATE TABLE trade_cashflows_v3_fixed
        ENGINE = MergeTree()
        ORDER BY (wallet, condition_id_norm)
        AS SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          cashflow_usdc
        FROM trade_cashflows_v3
        WHERE cashflow_usdc != 0 AND condition_id_norm != ''
      `
    });
    
    console.log("  ✅ Created trade_cashflows_v3_fixed (with valid condition_id_norm only)");
    
    // Get row counts
    const result = await ch.query({
      query: `
        SELECT 'outcome_positions_v2_fixed' as tbl, COUNT(*) as cnt FROM outcome_positions_v2_fixed
        UNION ALL
        SELECT 'trade_cashflows_v3_fixed', COUNT(*) FROM trade_cashflows_v3_fixed
      `,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data;
    
    console.log("\n📊 Row Counts:");
    for (const [name, cnt] of data) {
      console.log(`  ${name}: ${cnt}`);
    }
    
    console.log("\n⚠️  DATA QUALITY REPORT:");
    console.log("  - Filtered out rows with empty condition_id_norm");
    console.log("  - These rows cannot contribute to P&L calculations");
    console.log("  - Remaining rows have complete data for reliable joins");
    
    console.log("\n✅ Fixed tables created!");
    
  } catch (e: any) {
    console.error(`❌ Error: ${e.message}`);
  }
}

main();
