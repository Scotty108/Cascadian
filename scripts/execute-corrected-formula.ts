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
  console.log("EXECUTING CORRECTED P&L FORMULA (Phase 2 Implementation)");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  console.log("Formula Logic:");
  console.log("─".repeat(70));
  console.log("1. Join outcome_positions_v2 to winning_index on condition_id_norm");
  console.log("2. Sum net_shares where outcome_idx = win_idx");
  console.log("3. Sum all cashflows from trade_cashflows_v3");
  console.log("4. Realized P&L = net_shares_winning - total_cashflows\n");

  try {
    console.log("Creating temporary table: realized_pnl_corrected_v2...");
    
    await ch.query({
      query: `
        DROP TABLE IF EXISTS realized_pnl_corrected_v2
      `
    });

    await ch.query({
      query: `
        CREATE TABLE realized_pnl_corrected_v2 (
          wallet String,
          realized_pnl_usd Float64
        ) ENGINE = MergeTree()
        ORDER BY wallet
        AS
        SELECT
          p.wallet,
          round(
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) - 
            sumIf(toFloat64(c.cashflow_usdc), c.wallet = p.wallet),
            2
          ) AS realized_pnl_usd
        FROM outcome_positions_v2 AS p
        ANY LEFT JOIN winning_index AS w ON w.condition_id_norm = p.condition_id_norm
        ANY LEFT JOIN trade_cashflows_v3 AS c ON 
          (c.wallet = p.wallet) AND 
          (c.condition_id_norm = p.condition_id_norm)
        WHERE w.win_idx IS NOT NULL
        GROUP BY p.wallet
      `
    });

    console.log("✅ Table created successfully\n");

    // Now test the results
    console.log("════════════════════════════════════════════════════════════════");
    console.log("TESTING RESULTS");
    console.log("════════════════════════════════════════════════════════════════\n");

    const result = await ch.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd,
          CASE
            WHEN lower(wallet) = lower('${niggemon}') THEN 'niggemon'
            WHEN lower(wallet) = lower('${holymoses}') THEN 'HolyMoses7'
            ELSE 'OTHER'
          END as wallet_name
        FROM realized_pnl_corrected_v2
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        ORDER BY wallet
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
      console.log(`  Address: ${wallet}`);
      console.log(`  Calculated: $${pnl.toFixed(2)}`);
      console.log(`  Expected:   $${expected.toFixed(2)}`);
      if (variance !== null) {
        console.log(`  Variance:   ${variance.toFixed(2)}%`);
        console.log(`  Status:     ${Math.abs(variance) <= 5 ? "✅ PASS" : "❌ FAIL"}`);
      }
    }

    console.log("\n" + "═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`❌ Error: ${e.message}\n`);
  }
}

main().catch(console.error);
