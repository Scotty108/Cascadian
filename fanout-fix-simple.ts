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
  console.log("FANOUT FIX: Test aggregating cashflows FIRST");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  console.log("Approach 1: Current (JOIN raw trade_cashflows_v3):\n");
  
  try {
    const result1 = await ch.query({
      query: `
        WITH winning_outcomes AS (SELECT condition_id_norm, toInt16(win_idx) AS win_idx FROM winning_index WHERE win_idx IS NOT NULL)
        SELECT round(sum(
          sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) * 1.00 +
          sum(toFloat64(c.cashflow_usdc))
        ), 2) AS pnl
        FROM outcome_positions_v2 AS p
        LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        LEFT JOIN trade_cashflows_v3 AS c ON (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
        WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
        GROUP BY p.condition_id_norm
      `,
      format: "JSONCompact"
    });

    const text1 = await result1.text();
    const data1 = JSON.parse(text1).data || [];
    if (data1.length > 0) {
      console.log(`  Result: $${parseFloat(data1[0][0]).toFixed(2)}`);
    }
  } catch (e: any) {
    console.log(`  Error: ${e.message.split('\n')[0].substring(0, 50)}`);
  }

  console.log("\nApproach 2: Fixed (pre-aggregate cashflows):\n");

  try {
    const result2 = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT condition_id_norm, toInt16(win_idx) AS win_idx
          FROM winning_index
          WHERE win_idx IS NOT NULL
        ),
        agg_cf AS (
          SELECT
            lower(wallet) AS wallet,
            condition_id_norm,
            sum(toFloat64(cashflow_usdc)) AS cf_sum
          FROM trade_cashflows_v3
          GROUP BY wallet, condition_id_norm
        )
        SELECT round(sum(winning_shares * 1.00 + coalesce(cf_sum, 0)), 2) AS pnl
        FROM (
          SELECT
            p.wallet,
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) AS winning_shares,
            a.cf_sum
          FROM outcome_positions_v2 AS p
          LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
          LEFT JOIN agg_cf AS a ON lower(p.wallet) = a.wallet AND p.condition_id_norm = a.condition_id_norm
          WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
          GROUP BY p.wallet, p.condition_id_norm, a.cf_sum
        )
      `,
      format: "JSONCompact"
    });

    const text2 = await result2.text();
    const data2 = JSON.parse(text2).data || [];
    if (data2.length > 0) {
      const pnl = parseFloat(data2[0][0]);
      console.log(`  Result: $${pnl.toFixed(2)}`);
      
      const diff = Math.abs(pnl - 102001);
      if (diff < 5000) {
        console.log(`  ✅ MATCH!`);
      }
    }
  } catch (e: any) {
    console.log(`  Error: ${e.message.split('\n')[0].substring(0, 50)}`);
  }

  console.log("\n" + "═".repeat(70));
  console.log("Expected: $102,001");
  console.log("═".repeat(70) + "\n");
}

main().catch(console.error);
