#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function testApproach(name: string, query: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      const pnl = parseFloat(data[0][0]);
      const diff = Math.abs(pnl - 102001);
      const pct = (diff / 102001 * 100).toFixed(1);
      
      console.log(`${name.padEnd(50)}: $${pnl.toFixed(2)}`);
      if (diff < 5000) {
        console.log(`  ✅ MATCH! (${pct}% off)\n`);
        return true;
      } else {
        console.log(`  (${pct}% off)\n`);
      }
    }
  } catch (e: any) {
    console.log(`${name.padEnd(50)}: ERROR\n`);
  }
  return false;
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TESTING: CASHFLOW SCOPES (OFFSET = 0)");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  // Approach A: All cashflows
  await testApproach(
    "A) Shares (offset 0) + ALL cashflows",
    `
    WITH winning_outcomes AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index
      WHERE win_idx IS NOT NULL
    ),
    per_condition AS (
      SELECT
        sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) AS win_shares,
        sum(toFloat64(c.cashflow_usdc)) AS cashflows
      FROM outcome_positions_v2 AS p
      LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
      LEFT JOIN trade_cashflows_v3 AS c ON 
        (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
      WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
      GROUP BY p.condition_id_norm
    )
    SELECT round(sum(win_shares * 1.00 + cashflows), 2) FROM per_condition
    `
  );

  // Approach B: Shares only
  await testApproach(
    "B) Shares (offset 0) ONLY, no cashflows",
    `
    WITH winning_outcomes AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index
      WHERE win_idx IS NOT NULL
    ),
    per_condition AS (
      SELECT
        sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) AS win_shares
      FROM outcome_positions_v2 AS p
      LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
      WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
      GROUP BY p.condition_id_norm
    )
    SELECT round(sum(win_shares * 1.00), 2) FROM per_condition
    `
  );

  // Approach C: Only positive winning shares
  await testApproach(
    "C) Only POSITIVE winning shares (offset 0)",
    `
    WITH winning_outcomes AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index
      WHERE win_idx IS NOT NULL
    ),
    per_condition AS (
      SELECT
        sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) AS win_shares
      FROM outcome_positions_v2 AS p
      LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
      WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
      GROUP BY p.condition_id_norm
    )
    SELECT round(sum(CASE WHEN win_shares > 0 THEN win_shares * 1.00 ELSE 0 END), 2) FROM per_condition
    `
  );

  console.log("═".repeat(70));
  console.log("Expected: $102,001");
  console.log("═".repeat(70) + "\n");
}

main().catch(console.error);
