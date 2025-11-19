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
    throw new Error(e.message);
  }
}

async function main() {
  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("VERIFICATION: REPAIRED VIEWS");
  console.log("══════════════════════════════════════════════════════════════\n");

  // Test 1: realized_pnl_by_market_final
  console.log("TEST 1: realized_pnl_by_market_final");
  console.log("─".repeat(60));
  try {
    const result = await queryData(`
      SELECT count(*) as total_rows, count(DISTINCT wallet) as unique_wallets
      FROM realized_pnl_by_market_final
    `);
    console.log(`  ✅ Executes: ${result[0][0]} total rows, ${result[0][1]} unique wallets\n`);
  } catch (e: any) {
    console.log(`  ❌ ERROR: ${e.message.substring(0, 100)}\n`);
  }

  // Test 2: wallet_realized_pnl_final
  console.log("TEST 2: wallet_realized_pnl_final");
  console.log("─".repeat(60));
  try {
    const result = await queryData(`
      SELECT count(*) as total_wallets
      FROM wallet_realized_pnl_final
    `);
    console.log(`  ✅ Executes: ${result[0][0]} wallets\n`);
  } catch (e: any) {
    console.log(`  ❌ ERROR: ${e.message.substring(0, 100)}\n`);
  }

  // Test 3: wallet_pnl_summary_final
  console.log("TEST 3: wallet_pnl_summary_final");
  console.log("─".repeat(60));
  try {
    const result = await queryData(`
      SELECT count(*) as total_wallets
      FROM wallet_pnl_summary_final
    `);
    console.log(`  ✅ Executes: ${result[0][0]} wallets\n`);
  } catch (e: any) {
    console.log(`  ❌ ERROR: ${e.message.substring(0, 100)}\n`);
  }

  // Test 4: wallet_unrealized_pnl_v2
  console.log("TEST 4: wallet_unrealized_pnl_v2");
  console.log("─".repeat(60));
  try {
    const result = await queryData(`
      SELECT count(*) as total_wallets
      FROM wallet_unrealized_pnl_v2
    `);
    console.log(`  ✅ Executes: ${result[0][0]} wallets with unrealized PnL\n`);
  } catch (e: any) {
    console.log(`  ❌ ERROR: ${e.message.substring(0, 100)}\n`);
  }

  // Test 5: Query target wallets - combined P&L
  console.log("TEST 5: COMBINED P&L FOR TARGET WALLETS");
  console.log("─".repeat(60));
  try {
    const result = await queryData(`
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
    
    console.log(`  Wallet                    | Realized    | Unrealized   | Total`);
    console.log(`  ${"─".repeat(75)}`);
    
    if (result.length > 0) {
      for (const row of result) {
        const w = row[0].substring(0, 10);
        const r = parseFloat(row[1]).toFixed(2);
        const u = parseFloat(row[2]).toFixed(2);
        const t = parseFloat(row[3]).toFixed(2);
        console.log(`  ${w}... | $${r.padStart(10)} | $${u.padStart(10)} | $${t}`);
      }
      console.log(`\n  ✅ P&L summary working!\n`);
    } else {
      console.log(`  ℹ️  No data found for target wallets\n`);
    }
  } catch (e: any) {
    console.log(`  ❌ ERROR: ${e.message.substring(0, 100)}\n`);
  }

  // Test 6: coverage check on curated tables
  console.log("TEST 6: COVERAGE CHECK (outcome_positions_v2 JOIN winning_index)");
  console.log("─".repeat(60));
  try {
    const result = await queryData(`
      SELECT
        count(DISTINCT t.wallet) as unique_wallets,
        count(DISTINCT t.market_id) as unique_markets,
        count(DISTINCT t.condition_id_norm) as unique_conditions,
        countIf(w.win_idx IS NOT NULL) as resolved_positions,
        count() as total_positions,
        round(countIf(w.win_idx IS NOT NULL) * 100.0 / count(), 2) as coverage_pct
      FROM outcome_positions_v2 t
      LEFT JOIN winning_index w ON t.condition_id_norm = w.condition_id_norm
    `);
    
    if (result.length > 0) {
      const r = result[0];
      console.log(`  Total positions:     ${r[4]}`);
      console.log(`  Resolved positions:  ${r[3]} (${r[5]}% coverage)`);
      console.log(`  Unique wallets:      ${r[0]}`);
      console.log(`  Unique markets:      ${r[1]}`);
      console.log(`  Unique conditions:   ${r[2]}\n`);
      console.log(`  ✅ Curated chain has ${r[5]}% coverage\n`);
    }
  } catch (e: any) {
    console.log(`  ❌ ERROR: ${e.message.substring(0, 100)}\n`);
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log("✅ VERIFICATION COMPLETE");
  console.log("══════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
