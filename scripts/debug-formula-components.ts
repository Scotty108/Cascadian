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
  console.log("DEBUGGING FORMULA COMPONENTS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    console.log("Components for niggemon:\n");
    
    const result = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT 
            condition_id_norm,
            toInt16(win_idx) AS win_idx
          FROM winning_index
        )
        SELECT 
          'TOTAL CASHFLOWS' as component,
          sum(toFloat64(c.cashflow_usdc)) as value
        FROM trade_cashflows_v3 AS c
        WHERE lower(c.wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT
          'WINNING SHARES' as component,
          sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) as value
        FROM outcome_positions_v2 AS p
        ANY LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        WHERE lower(p.wallet) = lower('${niggemon}') AND w.win_idx IS NOT NULL
        
        UNION ALL
        
        SELECT
          'FORMULA: cashflows - winning' as component,
          (sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx)) as value
        FROM outcome_positions_v2 AS p
        ANY LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        ANY LEFT JOIN trade_cashflows_v3 AS c ON 
          (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
        WHERE lower(p.wallet) = lower('${niggemon}') AND w.win_idx IS NOT NULL
        
        UNION ALL
        
        SELECT
          'FORMULA: winning - cashflows' as component,
          (sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) - sum(toFloat64(c.cashflow_usdc))) as value
        FROM outcome_positions_v2 AS p
        ANY LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        ANY LEFT JOIN trade_cashflows_v3 AS c ON 
          (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
        WHERE lower(p.wallet) = lower('${niggemon}') AND w.win_idx IS NOT NULL
        
        UNION ALL
        
        SELECT
          'UNREALIZED P&L' as component,
          unrealized_pnl_usd as value
        FROM wallet_unrealized_pnl_v2
        WHERE lower(wallet) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Component Breakdown:");
    console.log("─".repeat(70));
    for (const row of data) {
      const component = row[0];
      const value = parseFloat(row[1]);
      console.log(`${component.padEnd(35)}: $${value.toFixed(2)}`);
    }
    
    console.log("\nExpected Results (from RECONCILIATION_FINAL_REPORT):");
    console.log("─".repeat(70));
    console.log(`Realized:   $185,095.73`);
    console.log(`Unrealized: -$85,404.19`);
    console.log(`Total:      $99,691.54`);

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
