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
  console.log("CRITICAL TEST: OFFSET = 0 vs OFFSET = +1");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    const result = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT condition_id_norm, toInt16(win_idx) AS win_idx
          FROM winning_index
          WHERE win_idx IS NOT NULL
        )
        SELECT
          'OFFSET = 0 (exact match)' AS test,
          round(sum(
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) * 1.00 +
            sum(toFloat64(c.cashflow_usdc))
          ), 2) AS net_pnl,
          round(sumIf(
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx),
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) > 0
          ), 2) AS winning_shares_sum,
          countIf(sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) > 0) AS win_conditions
        FROM outcome_positions_v2 AS p
        LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        LEFT JOIN trade_cashflows_v3 AS c ON 
          (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
        WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
        GROUP BY 1
        
        UNION ALL
        
        SELECT
          'OFFSET = +1' AS test,
          round(sum(
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx + 1) * 1.00 +
            sum(toFloat64(c.cashflow_usdc))
          ), 2) AS net_pnl,
          round(sumIf(
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx + 1),
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx + 1) > 0
          ), 2) AS winning_shares_sum,
          countIf(sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx + 1) > 0) AS win_conditions
        FROM outcome_positions_v2 AS p
        LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        LEFT JOIN trade_cashflows_v3 AS c ON 
          (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
        WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
        GROUP BY 1
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Comparison (RESOLVED TRADES ONLY):");
    console.log("─".repeat(70));

    for (const row of data) {
      const test = row[0];
      const pnl = parseFloat(row[1]);
      const winShares = parseFloat(row[2]);
      const winCount = parseInt(row[3]);

      console.log(`\n${test}:`);
      console.log(`  NET P&L:           $${pnl.toFixed(2)}`);
      console.log(`  Winning shares:    $${winShares.toFixed(2)}`);
      console.log(`  Win conditions:    ${winCount}`);
      
      if (Math.abs(pnl - 102001) < 5000) {
        console.log(`  ✅ MATCHES EXPECTED ($102,001)!`);
      }
    }

    console.log("\n" + "═".repeat(70));
    console.log("Expected: niggemon P&L ≈ $102,001");
    console.log("═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
