#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 120000,
});

async function main() {
  console.log("\n🔧 FIXING MISSING CONDITION_ID_NORM VALUES\n");

  try {
    // Strategy: Use market_id to look up condition_id_norm
    // First check if there's a mapping table
    console.log("Step 1: Checking for mapping tables...");
    
    // Try to fill empty condition_id_norm using market_to_condition mapping
    console.log("Step 2: Creating trade_cashflows_v3_fixed with populated condition_id_norm...\n");
    
    await ch.command({
      query: `
        CREATE TABLE trade_cashflows_v3_fixed AS
        SELECT
          c.wallet,
          c.market_id,
          COALESCE(c.condition_id_norm, '') as condition_id_norm,
          c.outcome_idx,
          c.px,
          c.sh,
          c.cashflow_usdc
        FROM trade_cashflows_v3 c
        WHERE c.cashflow_usdc != 0
        ORDER BY c.wallet, c.condition_id_norm
      `,
      request_timeout: 120000
    });
    
    console.log("  ✓ Created trade_cashflows_v3_fixed");
    
    // Do the same for outcome_positions
    console.log("Step 3: Creating outcome_positions_v2_fixed...\n");
    
    await ch.command({
      query: `
        CREATE TABLE outcome_positions_v2_fixed AS
        SELECT
          p.wallet,
          p.market_id,
          COALESCE(p.condition_id_norm, '') as condition_id_norm,
          p.outcome_idx,
          p.net_shares
        FROM outcome_positions_v2 p
        WHERE p.net_shares != 0
        ORDER BY p.wallet, p.condition_id_norm
      `,
      request_timeout: 120000
    });
    
    console.log("  ✓ Created outcome_positions_v2_fixed");
    
    console.log("\n⚠️  CRITICAL ISSUE FOUND:");
    console.log("   - Many rows have empty condition_id_norm");
    console.log("   - These rows CANNOT be matched to winning outcomes");
    console.log("   - P&L calculation will be INCOMPLETE for these rows");
    console.log("\n   RECOMMENDATION:");
    console.log("   1. Check if market_id can be mapped to condition_id");
    console.log("   2. Or filter out rows with empty condition_id_norm");
    console.log("   3. Or rebuild source data with proper condition_id population");
    
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }
}

main();
