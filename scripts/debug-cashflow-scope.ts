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
  console.log("DEBUGGING CASHFLOW SCOPE - RESOLVED vs ALL");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    const result = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT 
            condition_id_norm,
            toInt16(win_idx) AS win_idx
          FROM winning_index
        )
        SELECT 
          'Cashflows (ALL conditions)' as scope,
          round(sum(toFloat64(c.cashflow_usdc)), 2) as total_cashflows,
          round(sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) as winning_shares,
          round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) as formula_result
        FROM outcome_positions_v2 AS p
        ANY LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        ANY LEFT JOIN trade_cashflows_v3 AS c ON 
          (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
        WHERE lower(p.wallet) = lower('${niggemon}') AND w.win_idx IS NOT NULL
        
        UNION ALL
        
        SELECT 
          'Cashflows (RESOLVED only)' as scope,
          round(sum(toFloat64(c.cashflow_usdc)), 2) as total_cashflows,
          round(sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) as winning_shares,
          round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) as formula_result
        FROM outcome_positions_v2 AS p
        ANY INNER JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        ANY LEFT JOIN trade_cashflows_v3 AS c ON 
          (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
        WHERE lower(p.wallet) = lower('${niggemon}') AND w.win_idx IS NOT NULL
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Analysis:");
    console.log("─".repeat(70));
    for (const row of data) {
      const scope = row[0];
      const cashflows = parseFloat(row[1]);
      const winning = parseFloat(row[2]);
      const result = parseFloat(row[3]);
      
      console.log(`\n${scope}:`);
      console.log(`  Total Cashflows: $${cashflows.toFixed(2)}`);
      console.log(`  Winning Shares:  $${winning.toFixed(2)}`);
      console.log(`  Result:          $${result.toFixed(2)}`);
    }

    console.log("\n\nExpected (from RECONCILIATION_FINAL_REPORT):");
    console.log("─".repeat(70));
    console.log(`Realized: $185,095.73`);
    console.log(`(This should match one of the results above)`);

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
