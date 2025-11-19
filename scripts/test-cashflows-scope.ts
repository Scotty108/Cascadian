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
  console.log("TEST: CASHFLOWS SCOPE - Only count for conditions with winning shares");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    const result = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT condition_id_norm, toInt16(win_idx) AS win_idx
          FROM winning_index
          WHERE win_idx IS NOT NULL
        ),
        per_condition AS (
          SELECT
            p.wallet,
            p.condition_id_norm,
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) AS win_shares_offset_0,
            sum(toFloat64(c.cashflow_usdc)) AS all_cashflows
          FROM outcome_positions_v2 AS p
          LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
          LEFT JOIN trade_cashflows_v3 AS c ON 
            (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
          WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
          GROUP BY p.wallet, p.condition_id_norm
        ),
        with_scope AS (
          SELECT
            wallet,
            condition_id_norm,
            win_shares_offset_0,
            all_cashflows,
            -- Only include cashflows if there are winning shares
            CASE WHEN win_shares_offset_0 > 0 THEN all_cashflows ELSE 0 END AS cashflows_from_winners_only
          FROM per_condition
        )
        SELECT
          'ALL cashflows' AS scope,
          round(sum(win_shares_offset_0 * 1.00 + all_cashflows), 2) AS pnl
        FROM with_scope
        
        UNION ALL
        
        SELECT
          'Only winning condition cashflows' AS scope,
          round(sum(win_shares_offset_0 * 1.00 + cashflows_from_winners_only), 2) AS pnl
        FROM with_scope
        
        UNION ALL
        
        SELECT
          'Zero cashflows (shares only)' AS scope,
          round(sum(win_shares_offset_0 * 1.00), 2) AS pnl
        FROM with_scope
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Results (using OFFSET = 0):");
    console.log("─".repeat(70));

    for (const row of data) {
      const scope = row[0];
      const pnl = parseFloat(row[1]);
      
      console.log(`\n${scope}:`);
      console.log(`  P&L: $${pnl.toFixed(2)}`);
      if (Math.abs(pnl - 102001) < 5000) {
        console.log(`  ✅ MATCHES EXPECTED ($102,001)!`);
      }
    }

    console.log("\n" + "═".repeat(70));
    console.log("Expected: ~$102,001");
    console.log("═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
