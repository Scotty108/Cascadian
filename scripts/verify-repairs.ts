#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 30000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return null;
  }
}

async function main() {
  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("FIX #2: VERIFY REPAIRED VIEWS");
  console.log("══════════════════════════════════════════════════════════════\n");

  // Test 1: Verify realized_pnl_by_market_final works
  console.log("TEST 1: realized_pnl_by_market_final");
  console.log("─".repeat(60));
  let result = await queryData(`
    SELECT count(*) as total_rows, count(DISTINCT wallet) as unique_wallets
    FROM realized_pnl_by_market_final
  `);
  if (result) {
    console.log(`  ✅ Executes: ${result[0][0]} total rows, ${result[0][1]} wallets\n`);
  } else {
    console.log(`  ❌ Failed to execute\n`);
  }

  // Test 2: Verify wallet_realized_pnl_final works
  console.log("TEST 2: wallet_realized_pnl_final");
  console.log("─".repeat(60));
  result = await queryData(`
    SELECT count(*) as total_wallets
    FROM wallet_realized_pnl_final
  `);
  if (result) {
    console.log(`  ✅ Executes: ${result[0][0]} wallets with realized PnL\n`);
  } else {
    console.log(`  ❌ Failed to execute\n`);
  }

  // Test 3: Verify wallet_pnl_summary_final works
  console.log("TEST 3: wallet_pnl_summary_final");
  console.log("─".repeat(60));
  result = await queryData(`
    SELECT count(*) as total_wallets
    FROM wallet_pnl_summary_final
  `);
  if (result) {
    console.log(`  ✅ Executes: ${result[0][0]} wallets in PnL summary\n`);
  } else {
    console.log(`  ❌ Failed to execute\n`);
  }

  // Test 4: Query our target wallets
  console.log("TEST 4: TARGET WALLETS - realized_pnl_final");
  console.log("─".repeat(60));
  result = await queryData(`
    SELECT wallet, realized_pnl_usd
    FROM wallet_realized_pnl_final
    WHERE wallet IN (
      lower('${wallet1}'),
      lower('${wallet2}')
    )
    ORDER BY wallet
  `);
  if (result && result.length > 0) {
    for (const row of result) {
      console.log(`  ${row[0].substring(0, 12)}... : $${parseFloat(row[1]).toFixed(2)}`);
    }
  } else {
    console.log(`  ℹ️  No realized PnL found for target wallets (this may be normal if no resolved positions)`);
  }
  console.log("");

  // Test 5: Verify unrealized_pnl_v2 works
  console.log("TEST 5: wallet_unrealized_pnl_v2");
  console.log("─".repeat(60));
  result = await queryData(`
    SELECT wallet, unrealized_pnl_usd
    FROM wallet_unrealized_pnl_v2
    WHERE wallet IN (
      lower('${wallet1}'),
      lower('${wallet2}')
    )
    ORDER BY wallet
  `);
  if (result && result.length > 0) {
    for (const row of result) {
      console.log(`  ${row[0].substring(0, 12)}... : $${parseFloat(row[1]).toFixed(2)}`);
    }
    console.log(`  ✅ Unrealized PnL is working\n`);
  } else {
    console.log(`  ⚠️  Unrealized PnL not found for target wallets\n`);
  }

  // Test 6: Query both realized and unrealized combined
  console.log("TEST 6: COMBINED P&L (realized + unrealized)");
  console.log("─".repeat(60));
  result = await queryData(`
    SELECT 
      wallet,
      realized_pnl_usd,
      unrealized_pnl_usd,
      total_pnl_usd
    FROM wallet_pnl_summary_final
    WHERE wallet IN (
      lower('${wallet1}'),
      lower('${wallet2}')
    )
    ORDER BY wallet
  `);
  if (result && result.length > 0) {
    console.log(`  Wallet                    | Realized    | Unrealized   | Total`);
    console.log(`  ${"─".repeat(80)}`);
    for (const row of result) {
      const w = row[0].substring(0, 10);
      const r = parseFloat(row[1]).toFixed(2);
      const u = parseFloat(row[2]).toFixed(2);
      const t = parseFloat(row[3]).toFixed(2);
      console.log(`  ${w}... | $${r.padStart(10)} | $${u.padStart(10)} | $${t}`);
    }
    console.log(`\n  ✅ P&L summary is working\n`);
  } else {
    console.log(`  ⚠️  No P&L summary found\n`);
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log("✅ ALL VERIFICATION TESTS COMPLETE");
  console.log("══════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
