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
  console.log("CREATING FINAL P&L VIEW (FIXED)");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  try {
    // Direct query without creating a view
    console.log("Computing realized P&L:\n");
    
    const result = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT condition_id_norm, toInt16(win_idx) AS win_idx
          FROM winning_index
          WHERE win_idx IS NOT NULL
        ),
        pnl_by_condition AS (
          SELECT
            p.wallet,
            p.condition_id_norm,
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx + 1) AS winning_shares,
            sum(toFloat64(c.cashflow_usdc)) AS total_cashflows
          FROM outcome_positions_v2 AS p
          LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
          LEFT JOIN trade_cashflows_v3 AS c ON 
            (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
          WHERE w.win_idx IS NOT NULL
          GROUP BY p.wallet, p.condition_id_norm
        )
        SELECT
          lower(p.wallet) AS wallet,
          round(sum(p.winning_shares - p.total_cashflows), 2) AS realized_pnl_usd,
          CASE
            WHEN lower(p.wallet) = lower('${niggemon}') THEN 'niggemon'
            WHEN lower(p.wallet) = lower('${holymoses}') THEN 'HolyMoses7'
            ELSE 'OTHER'
          END as name
        FROM pnl_by_condition AS p
        WHERE lower(p.wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        GROUP BY lower(p.wallet)
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

    let anyPass = false;
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
      const passed = Math.abs(variance) <= 5;
      console.log(`  Status:     ${passed ? "✅ PASS" : "❌ FAIL"}`);
      if (passed) anyPass = true;
    }

    console.log("\n" + "═".repeat(70));
    if (anyPass) {
      console.log("✅ AT LEAST ONE WALLET MATCHES!");
    } else {
      console.log("❌ FORMULA STILL NOT WORKING");
      console.log("\nThe formula (winning_shares - cashflows) is not producing expected results.");
      console.log("This suggests either:");
      console.log("1. The formula itself is incorrect");
      console.log("2. The data sources are not the right ones");
      console.log("3. There's a sign issue or aggregation problem");
    }
    console.log("═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
