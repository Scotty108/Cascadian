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
  console.log("TESTING THIRD CLAUDE FORMULA (PER-CONDITION AGGREGATION)");
  console.log("Using outcome_positions_v2 + trade_cashflows_v3");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  try {
    const result = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT condition_id_norm, toInt16(win_idx) AS win_idx
          FROM winning_index
          WHERE win_idx IS NOT NULL
        ),
        per_condition_pnl AS (
          SELECT
            p.wallet,
            p.condition_id_norm,
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx + 1) AS win_shares,
            sum(toFloat64(c.cashflow_usdc)) AS total_cashflows
          FROM outcome_positions_v2 AS p
          ANY LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
          ANY LEFT JOIN trade_cashflows_v3 AS c ON 
            (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
          WHERE w.win_idx IS NOT NULL
          GROUP BY p.wallet, p.condition_id_norm
        )
        SELECT
          wallet,
          round(sum(win_shares - total_cashflows), 2) AS realized_pnl_usd,
          CASE
            WHEN lower(wallet) = lower('${niggemon}') THEN 'niggemon'
            WHEN lower(wallet) = lower('${holymoses}') THEN 'HolyMoses7'
            ELSE 'OTHER'
          END as name
        FROM per_condition_pnl
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        GROUP BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Results:");
    console.log("─".repeat(70));

    const expectedValues: Record<string, number> = {
      niggemon: 102001,
      "HolyMoses7": 89975
    };

    for (const row of data) {
      const wallet = row[0];
      const pnl = parseFloat(row[1]);
      const name = row[2];

      const expected = expectedValues[name];
      const variance = expected ? ((pnl - expected) / expected) * 100 : null;

      console.log(`\n${name}:`);
      console.log(`  Calculated: $${pnl.toFixed(2)}`);
      console.log(`  Expected:   $${expected.toFixed(2)}`);
      console.log(`  Variance:   ${variance.toFixed(2)}%`);
      console.log(`  Status:     ${Math.abs(variance) <= 5 ? "✅ PASS" : "❌ FAIL"}`);
    }

    console.log("\n" + "═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
