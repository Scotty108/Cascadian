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
  console.log("CRITICAL TEST: OFFSET = 0 vs OFFSET = +1 (SIMPLE)");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    // Test Offset = 0 (exact match)
    console.log("Testing OFFSET = 0 (exact match):\n");
    
    const result1 = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT condition_id_norm, toInt16(win_idx) AS win_idx
          FROM winning_index
          WHERE win_idx IS NOT NULL
        ),
        per_condition AS (
          SELECT
            p.wallet,
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) AS win_shares,
            sum(toFloat64(c.cashflow_usdc)) AS cashflows
          FROM outcome_positions_v2 AS p
          LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
          LEFT JOIN trade_cashflows_v3 AS c ON 
            (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
          WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
          GROUP BY p.wallet, p.condition_id_norm
        )
        SELECT
          round(sum(win_shares * 1.00 + cashflows), 2) AS pnl,
          round(sum(win_shares), 2) AS total_win_shares,
          round(sum(cashflows), 2) AS total_cashflows
        FROM per_condition
      `,
      format: "JSONCompact"
    });

    const text1 = await result1.text();
    const data1 = JSON.parse(text1).data || [];
    if (data1.length > 0) {
      const pnl = parseFloat(data1[0][0]);
      const winShares = parseFloat(data1[0][1]);
      const cashflows = parseFloat(data1[0][2]);
      console.log(`  P&L:               $${pnl.toFixed(2)}`);
      console.log(`  Winning shares:    $${winShares.toFixed(2)}`);
      console.log(`  Cashflows:         $${cashflows.toFixed(2)}`);
      if (Math.abs(pnl - 102001) < 5000) {
        console.log(`  ✅ MATCHES EXPECTED!\n`);
      } else {
        console.log(`  ❌ Does not match\n`);
      }
    }

    // Test Offset = +1
    console.log("Testing OFFSET = +1:\n");
    
    const result2 = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT condition_id_norm, toInt16(win_idx) AS win_idx
          FROM winning_index
          WHERE win_idx IS NOT NULL
        ),
        per_condition AS (
          SELECT
            p.wallet,
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx + 1) AS win_shares,
            sum(toFloat64(c.cashflow_usdc)) AS cashflows
          FROM outcome_positions_v2 AS p
          LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
          LEFT JOIN trade_cashflows_v3 AS c ON 
            (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
          WHERE w.win_idx IS NOT NULL AND lower(p.wallet) = lower('${niggemon}')
          GROUP BY p.wallet, p.condition_id_norm
        )
        SELECT
          round(sum(win_shares * 1.00 + cashflows), 2) AS pnl,
          round(sum(win_shares), 2) AS total_win_shares,
          round(sum(cashflows), 2) AS total_cashflows
        FROM per_condition
      `,
      format: "JSONCompact"
    });

    const text2 = await result2.text();
    const data2 = JSON.parse(text2).data || [];
    if (data2.length > 0) {
      const pnl = parseFloat(data2[0][0]);
      const winShares = parseFloat(data2[0][1]);
      const cashflows = parseFloat(data2[0][2]);
      console.log(`  P&L:               $${pnl.toFixed(2)}`);
      console.log(`  Winning shares:    $${winShares.toFixed(2)}`);
      console.log(`  Cashflows:         $${cashflows.toFixed(2)}`);
      if (Math.abs(pnl - 102001) < 5000) {
        console.log(`  ✅ MATCHES EXPECTED!\n`);
      } else {
        console.log(`  ❌ Does not match\n`);
      }
    }

    console.log("═".repeat(70));
    console.log("Expected: niggemon P&L ≈ $102,001");
    console.log("═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
