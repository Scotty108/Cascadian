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
  console.log("TEST: THREE CASHFLOW APPROACHES (OFFSET = 0)");
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
          'A) win_shares + ALL cashflows' AS approach,
          round(
            sum(sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx)) * 1.00 +
            sum(toFloat64(c.cashflow_usdc)),
            2
          ) AS pnl
        FROM outcome_positions_v2 AS p
        LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        LEFT JOIN trade_cashflows_v3 AS c ON 
          (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
        WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT
          'B) win_shares (shares only, no cashflows)' AS approach,
          round(
            sum(sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx)) * 1.00,
            2
          ) AS pnl
        FROM outcome_positions_v2 AS p
        LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT
          'C) Only POSITIVE win_shares' AS approach,
          round(
            sum(
              CASE WHEN sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) > 0
                THEN sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) * 1.00
                ELSE 0
              END
            ),
            2
          ) AS pnl
        FROM outcome_positions_v2 AS p
        LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
        GROUP BY 1
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Results:");
    console.log("─".repeat(70));

    for (const row of data) {
      const approach = row[0];
      const pnl = parseFloat(row[1]);
      
      console.log(`\n${approach}`);
      console.log(`  P&L: $${pnl.toFixed(2)}`);
      
      const diff = Math.abs(pnl - 102001);
      if (diff < 5000) {
        console.log(`  ✅ CLOSE! (${diff.toFixed(0)} away)`);
      } else if (diff < 50000) {
        console.log(`  ⚠️  DISTANT (${(diff/102001*100).toFixed(1)}% off)`);
      } else {
        console.log(`  ❌ WRONG (${(diff/102001*100).toFixed(0)}% off)`);
      }
    }

    console.log("\n" + "═".repeat(70));
    console.log("Expected: $102,001");
    console.log("═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
