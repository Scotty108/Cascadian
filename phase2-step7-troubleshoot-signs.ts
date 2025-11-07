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
  console.log("PHASE 2 STEP 7: TROUBLESHOOTING - CHECK CASHFLOW SIGNS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    console.log("1. Cashflow sum from flows_by_condition_v1:\n");
    
    const result1 = await ch.query({
      query: `SELECT round(sum(cash_usd), 2) FROM flows_by_condition_v1 WHERE lower(wallet) = lower('${niggemon}')`,
      format: "JSONCompact"
    });

    const text1 = await result1.text();
    const data1 = JSON.parse(text1).data || [];
    const cashSum = parseFloat(data1[0][0]);
    console.log(`   Total cashflows: $${cashSum.toFixed(2)}\n`);

    console.log("2. Testing alternative formula (shares - cashflows):\n");
    
    const result2 = await ch.query({
      query: `
        SELECT
          round(sum(realized_pnl_usd), 2) AS current_formula,
          round(sum(win_shares) - sum(cash_usd), 2) AS alt_formula
        FROM realized_pnl_by_condition_v3
        WHERE lower(wallet) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const text2 = await result2.text();
    const data2 = JSON.parse(text2).data || [];
    const current = parseFloat(data2[0][0]);
    const alt = parseFloat(data2[0][1]);

    console.log(`   Current (cash + shares): $${current.toFixed(2)}`);
    console.log(`   Alternative (shares - cash): $${alt.toFixed(2)}`);
    console.log(`   Expected target: $102,001\n`);

    console.log("3. Analyzing components:\n");
    
    const result3 = await ch.query({
      query: `
        SELECT
          round(sum(cash_usd), 2) AS total_cashflows,
          round(sum(win_shares), 2) AS total_win_shares,
          round(sum(win_shares) - sum(cash_usd), 2) AS alt_result
        FROM realized_pnl_by_condition_v3
        WHERE lower(wallet) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const text3 = await result3.text();
    const data3 = JSON.parse(text3).data || [];
    const cf = parseFloat(data3[0][0]);
    const ws = parseFloat(data3[0][1]);
    const result = parseFloat(data3[0][2]);

    console.log(`   Cashflows:     $${cf.toFixed(2)}`);
    console.log(`   Win shares:    $${ws.toFixed(2)}`);
    console.log(`   Result:        $${result.toFixed(2)}\n`);

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
