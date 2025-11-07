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
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║     EXAMINING RESOLVED_TRADES AND P&L CALCULATION              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Check resolved_trades_v2
  console.log("STEP 1: Check resolved_trades_v2\n");
  const rv2 = await ch.query({
    query: `
      SELECT
        wallet,
        count() as trade_count,
        sum(realized_pnl_usd) as total_pnl
      FROM resolved_trades_v2
      WHERE wallet = lower('${wallet}')
      GROUP BY wallet
    `,
    format: "JSONCompact"
  });

  const rv2Text = await rv2.text();
  const rv2Data = JSON.parse(rv2Text).data;
  if (rv2Data.length > 0) {
    const [w, count, pnl] = rv2Data[0];
    console.log(`  Wallet: ${w}`);
    console.log(`  Trades: ${count}`);
    console.log(`  Total P&L: $${pnl?.toFixed(2) || '0.00'}\n`);
  } else {
    console.log("  (no data)\n");
  }

  // Check trade_cashflows_v3
  console.log("STEP 2: Check trade_cashflows_v3\n");
  const cf3 = await ch.query({
    query: `
      SELECT
        wallet,
        count() as trade_count,
        sum(cashflow_usdc) as total_cashflows,
        count(DISTINCT condition_id_norm) as unique_conditions
      FROM trade_cashflows_v3
      WHERE wallet = lower('${wallet}')
      GROUP BY wallet
    `,
    format: "JSONCompact"
  });

  const cf3Text = await cf3.text();
  const cf3Data = JSON.parse(cf3Text).data;
  if (cf3Data.length > 0) {
    const [w, count, cashflows, conditions] = cf3Data[0];
    console.log(`  Wallet: ${w}`);
    console.log(`  Trades: ${count}`);
    console.log(`  Total Cashflows: $${cashflows?.toFixed(2) || '0.00'}`);
    console.log(`  Unique Conditions: ${conditions}\n`);
  } else {
    console.log("  (no data)\n");
  }

  // Check if there's a winning_index table
  console.log("STEP 3: Check if winning_index exists\n");
  try {
    const wi = await ch.query({
      query: "SELECT count() as cnt FROM winning_index LIMIT 1",
      format: "JSONCompact"
    });

    const wiText = await wi.text();
    const wiData = JSON.parse(wiText).data;
    console.log(`  winning_index exists: ${wiData[0][0]} records\n`);
  } catch (e: any) {
    console.log(`  winning_index does NOT exist: ${e.message.substring(0, 50)}...\n`);
  }

  // Check actual tables that exist
  console.log("STEP 4: Show TABLES to find what exists\n");
  const tables = await ch.query({
    query: "SHOW TABLES LIKE '%win%'",
    format: "JSONCompact"
  });

  const tablesText = await tables.text();
  const tablesData = JSON.parse(tablesText).data;
  console.log("  Tables with 'win' in name:");
  for (const row of tablesData) {
    console.log(`    - ${row[0]}`);
  }

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                     END DIAGNOSIS                              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

main().catch(console.error);
