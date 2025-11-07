#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 30000,
});

async function main() {
  console.log("\n🔍 EXAMINING ACTUAL DATA\n");

  try {
    // Check outcome_positions_v2 with non-empty condition_id_norm
    const pos = await ch.query({
      query: `
        SELECT wallet, condition_id_norm, outcome_idx, net_shares
        FROM outcome_positions_v2
        WHERE condition_id_norm != ''
        LIMIT 5
      `,
      format: "JSONCompact"
    });
    const posText = await pos.text();
    const posData = JSON.parse(posText).data || [];
    
    console.log("outcome_positions_v2 (non-empty condition_id_norm):");
    console.log(`  Rows found: ${posData.length}`);
    for (const row of posData.slice(0, 3)) {
      console.log(`    wallet=${row[0].substring(0,20)}..., cid=${row[1].substring(0,30)}..., idx=${row[2]}, shares=${row[3]}`);
    }
    
    // Check trade_cashflows_v3 with non-empty condition_id_norm
    const cash = await ch.query({
      query: `
        SELECT wallet, market_id, condition_id_norm, outcome_idx, cashflow_usdc
        FROM trade_cashflows_v3
        WHERE condition_id_norm != ''
        LIMIT 5
      `,
      format: "JSONCompact"
    });
    const cashText = await cash.text();
    const cashData = JSON.parse(cashText).data || [];
    
    console.log("\ntrade_cashflows_v3 (non-empty condition_id_norm):");
    console.log(`  Rows found: ${cashData.length}`);
    for (const row of cashData.slice(0, 3)) {
      console.log(`    wallet=${row[0].substring(0,20)}..., mid=${row[1]}, cid=${row[2].substring(0,20)}..., idx=${row[3]}, cash=${row[4]}`);
    }
    
    // Check how many rows have empty condition_id_norm
    const emptyCount = await ch.query({
      query: `SELECT 'outcome_positions_v2' as tbl, countIf(condition_id_norm = '') as empty_count FROM outcome_positions_v2
               UNION ALL
               SELECT 'trade_cashflows_v3', countIf(condition_id_norm = '') FROM trade_cashflows_v3`,
      format: "JSONCompact"
    });
    const emptyText = await emptyCount.text();
    const emptyData = JSON.parse(emptyText).data || [];
    
    console.log("\nEmpty condition_id_norm counts:");
    for (const row of emptyData) {
      console.log(`  ${row[0]}: ${row[1]} rows have empty condition_id_norm`);
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
