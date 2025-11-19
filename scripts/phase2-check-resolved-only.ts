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
  console.log("TESTING: ONLY INCLUDE CASHFLOWS FROM RESOLVED CONDITIONS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    console.log("Testing different cashflow scopes for niggemon:\n");
    
    const result = await ch.query({
      query: `
        SELECT
          'ALL conditions' as scope,
          round(sum(f.cash_usd), 2) AS cashflows,
          round(sum(ws.win_shares), 2) AS win_shares,
          round(sum(f.cash_usd) + sum(ws.win_shares), 2) AS pnl
        FROM flows_by_condition_v1 AS f
        LEFT JOIN winning_shares_v1 AS ws ON 
          f.wallet = ws.wallet AND f.condition_id_norm = ws.condition_id_norm
        WHERE lower(f.wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT
          'RESOLVED CONDITIONS ONLY' as scope,
          round(sum(f.cash_usd), 2) AS cashflows,
          round(sum(ws.win_shares), 2) AS win_shares,
          round(sum(f.cash_usd) + sum(ws.win_shares), 2) AS pnl
        FROM flows_by_condition_v1 AS f
        INNER JOIN winning_shares_v1 AS ws ON 
          f.wallet = ws.wallet AND f.condition_id_norm = ws.condition_id_norm
        WHERE lower(f.wallet) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Results:");
    console.log("─".repeat(70));
    for (const row of data) {
      const scope = row[0];
      const cf = parseFloat(row[1]);
      const ws = parseFloat(row[2]);
      const pnl = parseFloat(row[3]);
      
      console.log(`\n${scope}:`);
      console.log(`  Cashflows:  $${cf.toFixed(2)}`);
      console.log(`  Win shares: $${ws.toFixed(2)}`);
      console.log(`  P&L:        $${pnl.toFixed(2)}`);
    }

    console.log("\n" + "═".repeat(70));
    console.log("Expected: $102,001");
    console.log("═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
