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
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  
  console.log("\n📊 CALCULATING CORRECT P&L FROM FIRST PRINCIPLES\n");
  
  // P&L = Cost basis + Payout
  // For each resolved condition where wallet has position:
  //   Cost basis = sum(USDC spent on all outcomes)
  //   Payout = shares_of_winning_outcome * $1.00
  
  try {
    const result = await ch.query({
      query: `
        SELECT
          ROUND(SUM(payout_value) - SUM(cost_basis), 2) as pnl_correct
        FROM (
          SELECT
            p.condition_id_norm,
            SUM(CASE 
              WHEN p.outcome_idx = w.winning_index THEN p.net_shares
              ELSE 0 
            END) as winning_shares,
            SUM(ABS(p.net_shares)) as total_cost_basis,
            CASE 
              WHEN SUM(CASE WHEN p.outcome_idx = w.winning_index THEN p.net_shares ELSE 0 END) > 0
              THEN SUM(CASE WHEN p.outcome_idx = w.winning_index THEN p.net_shares ELSE 0 END) * 1.0
              ELSE 0
            END as payout_value,
            total_cost_basis as cost_basis
          FROM outcome_positions_v2 p
          INNER JOIN market_resolutions_final w ON p.condition_id_norm = w.condition_id_norm
          WHERE p.wallet = lower('${wallet}')
          GROUP BY p.condition_id_norm, w.winning_index
        )
      `,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data;
    console.log("Correct P&L calculation:");
    console.log(`  Result: $${data[0][0]}`);
    console.log(`  Expected: $101,949.55`);
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
