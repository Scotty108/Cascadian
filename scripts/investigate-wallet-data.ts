#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 60000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSONCompact' });
    const text = await result.text();
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return null;
  }
}

async function main() {
  const lucasMeow = '0x7f3c8979d0afa00007bae4747d5347122af05613';
  const xcnstrategy = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("ROOT CAUSE INVESTIGATION: Where are LucasMeow & xcnstrategy?");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Check if they exist in ANY table
  console.log("STEP 1: Check all available tables for these wallets");
  console.log("─".repeat(70));

  const tables = [
    'trades_raw',
    'erc1155_transfers',
    'erc20_transfers',
    'outcome_positions_v2',
    'trade_cashflows_v3',
    'trades_enriched_with_condition',
    'trades_enriched',
    'wallet_unrealized_pnl_v2',
  ];

  const results = {};

  for (const table of tables) {
    const result = await queryData(`
      SELECT COUNT(*) as cnt
      FROM ${table}
      WHERE wallet IN (lower('${lucasMeow}'), lower('${xcnstrategy}'))
         OR wallet_address IN (lower('${lucasMeow}'), lower('${xcnstrategy}'))
    `);

    const count = result && result.length > 0 ? result[0][0] : 0;
    results[table] = count;
    console.log(`  ${table.padEnd(40)}: ${count} rows`);
  }
  console.log("");

  // Count total rows in each table to see scale
  console.log("STEP 2: Sample of wallets that DO exist in outcome_positions_v2");
  console.log("─".repeat(70));

  const walletSample = await queryData(`
    SELECT DISTINCT wallet
    FROM outcome_positions_v2
    LIMIT 20
  `);

  if (walletSample && walletSample.length > 0) {
    for (const row of walletSample) {
      console.log(`  ${row[0]}`);
    }
  }
  console.log("");

  // Check if the issue is case sensitivity
  console.log("STEP 3: Check for case-sensitivity issues");
  console.log("─".repeat(70));

  const caseSensitive = await queryData(`
    SELECT DISTINCT wallet
    FROM outcome_positions_v2
    WHERE lower(wallet) = lower('${lucasMeow}')
       OR lower(wallet) = lower('${xcnstrategy}')
  `);

  if (caseSensitive && caseSensitive.length > 0) {
    console.log(`  Found ${caseSensitive.length} wallets with case-insensitive match:`);
    for (const row of caseSensitive) {
      console.log(`    ${row[0]}`);
    }
  } else {
    console.log(`  ❌ No case-insensitive matches found in outcome_positions_v2`);
  }
  console.log("");

  // Check trades_raw to see if these wallets have ANY activity
  console.log("STEP 4: Check trades_raw for wallet activity");
  console.log("─".repeat(70));

  const rawTrades = await queryData(`
    SELECT
      wallet,
      count() as trade_count,
      min(timestamp) as earliest_trade,
      max(timestamp) as latest_trade
    FROM trades_raw
    WHERE wallet IN (lower('${lucasMeow}'), lower('${xcnstrategy}'))
    GROUP BY wallet
  `);

  if (rawTrades && rawTrades.length > 0) {
    for (const row of rawTrades) {
      console.log(`  ${row[0].substring(0, 12)}... : ${row[1]} trades`);
      console.log(`    Earliest: ${row[2]} | Latest: ${row[3]}`);
    }
  } else {
    console.log(`  ❌ No trades found in trades_raw for these wallets`);
  }
  console.log("");

  // Check if we have snapshot date filtering issue
  console.log("STEP 5: Check if snapshot filtering is excluding these wallets");
  console.log("─".repeat(70));

  const snapshotCheck = await queryData(`
    SELECT
      wallet,
      count() as trade_count,
      countIf(timestamp <= 1730419199) as before_snapshot,
      countIf(timestamp > 1730419199) as after_snapshot
    FROM trades_raw
    WHERE wallet IN (lower('${lucasMeow}'), lower('${xcnstrategy}'))
    GROUP BY wallet
  `);

  if (snapshotCheck && snapshotCheck.length > 0) {
    for (const row of snapshotCheck) {
      console.log(`  ${row[0].substring(0, 12)}...`);
      console.log(`    Total: ${row[1]} | Before snapshot (Oct 31): ${row[2]} | After: ${row[3]}`);
    }
  } else {
    console.log(`  Note: No data in trades_raw for these wallets`);
  }
  console.log("");

  console.log("════════════════════════════════════════════════════════════════");
  console.log("CONCLUSION");
  console.log("════════════════════════════════════════════════════════════════");

  const hasAnyData = Object.values(results).some((v) => v > 0);
  if (!hasAnyData) {
    console.log("❌ These wallets have NO data in ANY table in the database.");
    console.log("Possible causes:");
    console.log("  1. Data import/backfill incomplete for these wallets");
    console.log("  2. Wallets may be brand new (joined after snapshot date)");
    console.log("  3. Data may need to be loaded from blockchain manually");
  } else {
    console.log("✅ Wallets exist in database but may be in wrong pipeline stage");
  }
  console.log("");
}

main().catch(console.error);
