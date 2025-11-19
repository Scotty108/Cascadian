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
  console.log("MANUAL CALCULATION: What is P&L for resolved conditions only?");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  // Get baseline from trade_cashflows_v3 (resolved only)
  console.log("APPROACH 1: Sum of trade_cashflows_v3 (already calculated per-trade PnL for resolved)");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          SUM(CAST(cashflow_usdc AS Float64)) as total_pnl
        FROM trade_cashflows_v3
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      console.log(`  ${row[0].substring(0,12)}...: $${parseFloat(row[1]).toFixed(2)}\n`);
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  console.log("EXPECTED VALUES (from Polymarket):");
  console.log("─".repeat(70));
  console.log(`  niggemon:    $102,001.46`);
  console.log(`  HolyMoses7:  $89,975.16\n`);

  console.log("════════════════════════════════════════════════════════════════");
  console.log("QUESTION: Are trade_cashflows_v3 values already including settlement?");
  console.log("Or are they just individual trade cashflows?");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Check a sample from trade_cashflows_v3
  console.log("SAMPLE: First 5 rows from trade_cashflows_v3 for niggemon");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          cashflow_usdc,
          CAST(cashflow_usdc AS String) as cf_str
        FROM trade_cashflows_v3
        WHERE lower(wallet) = lower('${niggemon}')
        ORDER BY condition_id_norm, outcome_idx
        LIMIT 5
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      const cf = parseFloat(row[3]);
      console.log(`  cond=${row[1].substring(0,16)}... outcome_idx=${row[2]} → P&L=$${cf.toFixed(2)}`);
    }
    console.log();
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
