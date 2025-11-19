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
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("INSPECTING: trade_cashflows_v3 vs expected schema");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  // Sample some rows from trade_cashflows_v3
  console.log("Sample rows from trade_cashflows_v3:\n");
  
  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          cashflow_usdc
        FROM trade_cashflows_v3
        WHERE lower(wallet) = lower('${niggemon}')
        ORDER BY cashflow_usdc DESC
        LIMIT 10
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Column: wallet, condition_id_norm, outcome_idx, cashflow_usdc");
    console.log("─".repeat(70));
    for (const row of data) {
      console.log(`${row[0].substring(0,12)}..., ${row[1].substring(0,8)}..., ${row[2]}, $${parseFloat(row[3]).toFixed(2)}`);
    }

    // Check: is trade_cashflows_v3 pre-aggregated or per-trade?
    console.log("\n\nChecking if trade_cashflows_v3 is pre-aggregated:\n");
    
    const result2 = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT(wallet, condition_id_norm, outcome_idx)) as unique_combos,
          (COUNT(*) / COUNT(DISTINCT(wallet, condition_id_norm, outcome_idx))) as avg_rows_per_combo
        FROM trade_cashflows_v3
        WHERE lower(wallet) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const text2 = await result2.text();
    const data2 = JSON.parse(text2).data || [];
    
    if (data2.length > 0) {
      const totalRows = parseInt(data2[0][0]);
      const uniqueCombos = parseInt(data2[0][1]);
      const avgRows = parseFloat(data2[0][2]);
      
      console.log(`Total rows: ${totalRows}`);
      console.log(`Unique (wallet, condition, outcome) combos: ${uniqueCombos}`);
      console.log(`Avg rows per combo: ${avgRows.toFixed(2)}`);
      
      if (avgRows < 1.5) {
        console.log(`✅ Appears to be pre-aggregated (1 row per combo)\n`);
      } else {
        console.log(`❌ Appears to be per-trade data (multiple rows per combo)\n`);
      }
    }

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
