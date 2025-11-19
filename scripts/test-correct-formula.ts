#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function queryExists(tableName: string): Promise<boolean> {
  try {
    const result = await ch.query({
      query: `SELECT 1 FROM ${tableName} LIMIT 1`,
      format: "JSONCompact"
    });
    await result.text();
    return true;
  } catch (e: any) {
    return false;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TABLE EXISTENCE CHECK");
  console.log("════════════════════════════════════════════════════════════════\n");

  const tables = [
    'trades_raw',
    'trade_flows_v2',
    'canonical_condition',
    'market_outcomes_expanded',
    'winning_index',
    'trade_cashflows_v3',
    'outcome_positions_v2',
    'wallet_realized_pnl_v2',
    'wallet_pnl_summary_v2',
    'portfolio_mtm_detailed'
  ];

  for (const table of tables) {
    const exists = await queryExists(table);
    console.log(`${exists ? '✅' : '❌'} ${table}`);
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TESTING CORRECT FORMULA ON AVAILABLE TABLES");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  // Try the correct formula using trade_flows_v2
  console.log("APPROACH 1: Using trade_flows_v2 + winning_index (CORRECT FORMULA)");
  console.log("─".repeat(70));
  
  try {
    const result = await ch.query({
      query: `
        SELECT
          tf.wallet,
          count(*) as trade_count,
          sum(CAST(tf.cashflow_usdc AS Float64)) as total_cashflows,
          sum(CAST(tf.delta_shares AS Float64)) as net_shares,
          CAST(tf.wallet AS String) as wallet_str
        FROM trade_flows_v2 tf
        WHERE lower(tf.wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        GROUP BY tf.wallet
        ORDER BY tf.wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      console.log("✅ trade_flows_v2 exists and has data\n");
      for (const row of data) {
        const wallet = row[0];
        const count = row[1];
        const cashflows = parseFloat(row[2] || "0");
        const shares = parseFloat(row[3] || "0");
        console.log(`  Wallet: ${wallet.substring(0, 12)}...`);
        console.log(`    Trades: ${count}`);
        console.log(`    Total cashflows: $${cashflows.toFixed(2)}`);
        console.log(`    Net shares: ${shares.toFixed(2)}\n`);
      }
    } else {
      console.log("❌ No data found in trade_flows_v2\n");
    }
  } catch (e: any) {
    console.log(`❌ Error: ${e.message}\n`);
  }

  // Try winning_index directly
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("APPROACH 2: Using trade_cashflows_v3 + winning_index");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT
          c.wallet,
          count(*) as resolved_trades,
          sum(CAST(c.cashflow_usdc AS Float64)) as resolved_pnl,
          countIf(c.cashflow_usdc > 0) as winning_trades,
          countIf(c.cashflow_usdc < 0) as losing_trades
        FROM trade_cashflows_v3 c
        INNER JOIN winning_index w ON c.condition_id_norm = w.condition_id_norm
        WHERE lower(c.wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        GROUP BY c.wallet
        ORDER BY c.wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      console.log("✅ Resolved trades found via trade_cashflows_v3 + winning_index\n");
      for (const row of data) {
        const wallet = row[0];
        const count = row[1];
        const pnl = parseFloat(row[2] || "0");
        const wins = row[3];
        const losses = row[4];
        console.log(`  Wallet: ${wallet.substring(0, 12)}...`);
        console.log(`    Resolved trades: ${count}`);
        console.log(`    P&L (resolved only): $${pnl.toFixed(2)}`);
        console.log(`    Winning: ${wins}, Losing: ${losses}\n`);
      }
    } else {
      console.log("❌ No resolved trades found\n");
    }
  } catch (e: any) {
    console.log(`❌ Error: ${e.message}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
