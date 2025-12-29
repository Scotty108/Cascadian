#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function executeQuery(query: string, name: string) {
  try {
    await ch.command({ query });
    console.log(`  ✅ ${name}`);
    return true;
  } catch (e: any) {
    const err = e.message.split('\n')[0];
    console.error(`  ❌ ${name}: ${err.substring(0, 80)}`);
    return false;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("CREATING FINAL P&L VIEWS");
  console.log("Formula: (win_shares - cashflows) per condition, then summed");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Drop old views
  console.log("Step 1: Cleanup...\n");
  await executeQuery(`DROP VIEW IF EXISTS pnl_final_by_condition`, "Drop old view");
  await executeQuery(`DROP VIEW IF EXISTS wallet_pnl_final_formula`, "Drop old view");

  // Create new formula views
  console.log("\nStep 2: Create pnl_final_by_condition...\n");
  await executeQuery(`
    CREATE OR REPLACE VIEW pnl_final_by_condition AS
    WITH winning_outcomes AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index
      WHERE win_idx IS NOT NULL
    )
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
  `, "pnl_final_by_condition");

  console.log("\nStep 3: Create wallet_pnl_final_formula...\n");
  await executeQuery(`
    CREATE OR REPLACE VIEW wallet_pnl_final_formula AS
    SELECT
      lower(wallet) as wallet,
      round(sum(winning_shares - total_cashflows), 2) AS realized_pnl_usd
    FROM pnl_final_by_condition
    GROUP BY wallet
  `, "wallet_pnl_final_formula");

  console.log("\n" + "═".repeat(70));
  console.log("Testing final formula:\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd,
          CASE
            WHEN wallet = lower('${niggemon}') THEN 'niggemon'
            WHEN wallet = lower('${holymoses}') THEN 'HolyMoses7'
            ELSE 'OTHER'
          END as name
        FROM wallet_pnl_final_formula
        WHERE wallet IN (lower('${niggemon}'), lower('${holymoses}'))
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

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

      console.log(`${name}:`);
      console.log(`  Calculated: $${pnl.toFixed(2)}`);
      console.log(`  Expected:   $${expected.toFixed(2)}`);
      console.log(`  Variance:   ${variance.toFixed(2)}%`);
      console.log(`  Status:     ${Math.abs(variance) <= 5 ? "✅ PASS" : "❌ FAIL"}\n`);
    }

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
