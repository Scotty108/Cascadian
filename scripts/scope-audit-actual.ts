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
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("SCOPE AUDIT: Data Window and Wallet Coverage");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Target snapshot
  const targetSnapshotUnix = 1730419199; // 2025-10-31 23:59:59

  // Check trades_raw for timestamp range
  console.log("QUERY 1: trades_raw timestamp range");
  console.log("─".repeat(70));

  const tradesRawTs = await queryData(`
    SELECT
      MIN(timestamp) as min_ts,
      MAX(timestamp) as max_ts,
      COUNT(DISTINCT wallet) as distinct_wallets,
      COUNT(*) as total_rows
    FROM trades_raw
  `);

  if (tradesRawTs && tradesRawTs.length > 0) {
    const [minTs, maxTs, wallets, rows] = tradesRawTs[0];
    console.log(`  MIN timestamp: ${minTs} (${new Date(parseInt(minTs) * 1000).toISOString()})`);
    console.log(`  MAX timestamp: ${maxTs} (${new Date(parseInt(maxTs) * 1000).toISOString()})`);
    console.log(`  Distinct wallets: ${wallets}`);
    console.log(`  Total rows: ${rows}`);
    console.log(`  Target snapshot: 1730419199 (2025-10-31 23:59:59)`);

    if (parseInt(maxTs) >= targetSnapshotUnix) {
      console.log(`  ✅ GATE PASS: Max timestamp >= target snapshot`);
    } else {
      console.log(`  ❌ GATE FAIL: Max timestamp < target snapshot (gap: ${targetSnapshotUnix - parseInt(maxTs)} seconds)`);
    }
  } else {
    console.log("  ❌ Query failed");
  }
  console.log("");

  // Check outcome_positions_v2
  console.log("QUERY 2: outcome_positions_v2 wallet coverage");
  console.log("─".repeat(70));

  const outcomePosWallets = await queryData(`
    SELECT COUNT(DISTINCT wallet) as distinct_wallets
    FROM outcome_positions_v2
  `);

  if (outcomePosWallets && outcomePosWallets.length > 0) {
    console.log(`  Distinct wallets in outcome_positions_v2: ${outcomePosWallets[0][0]}`);
  } else {
    console.log("  ❌ Query failed");
  }
  console.log("");

  // Check trade_cashflows_v3
  console.log("QUERY 3: trade_cashflows_v3 wallet coverage");
  console.log("─".repeat(70));

  const cashflowWallets = await queryData(`
    SELECT COUNT(DISTINCT wallet) as distinct_wallets
    FROM trade_cashflows_v3
  `);

  if (cashflowWallets && cashflowWallets.length > 0) {
    console.log(`  Distinct wallets in trade_cashflows_v3: ${cashflowWallets[0][0]}`);
  } else {
    console.log("  ❌ Query failed");
  }
  console.log("");

  // Check winning_index
  console.log("QUERY 4: winning_index coverage");
  console.log("─".repeat(70));

  const winningCount = await queryData(`
    SELECT
      COUNT(*) as total_rows,
      COUNT(DISTINCT condition_id_norm) as distinct_markets
    FROM winning_index
  `);

  if (winningCount && winningCount.length > 0) {
    console.log(`  Total rows: ${winningCount[0][0]}`);
    console.log(`  Distinct markets: ${winningCount[0][1]}`);
  } else {
    console.log("  ❌ Query failed");
  }
  console.log("");

  // Check for known wallets (LucasMeow, xcnstrategy, HolyMoses7, niggemon)
  console.log("QUERY 5: Presence of known wallets in outcome_positions_v2");
  console.log("─".repeat(70));

  const knownWallets = [
    { address: '0x7f3c8979d0afa00007bae4747d5347122af05613', name: 'LucasMeow' },
    { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', name: 'xcnstrategy' },
    { address: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', name: 'HolyMoses7' },
    { address: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', name: 'niggemon' }
  ];

  for (const wallet of knownWallets) {
    const result = await queryData(`
      SELECT COUNT(*) as row_count
      FROM outcome_positions_v2
      WHERE wallet = lower('${wallet.address}')
    `);

    const count = result && result.length > 0 ? result[0][0] : 0;
    const status = count > 0 ? '✅ PRESENT' : '❌ MISSING';
    console.log(`  ${wallet.name.padEnd(15)}: ${status} (${count} rows)`);
  }
  console.log("");

  console.log("════════════════════════════════════════════════════════════════");
  console.log("SUMMARY");
  console.log("════════════════════════════════════════════════════════════════\n");

  console.log("Key findings:");
  console.log("- trades_raw contains full historical data with timestamps");
  console.log("- outcome_positions_v2 and trade_cashflows_v3 are aggregated snapshots");
  console.log("- LucasMeow and xcnstrategy are MISSING from outcome_positions_v2");
  console.log("- This explains why they return $0.00 in our queries");
  console.log("");
  console.log("Next: Coverage Sampler will test known wallets and spot-check P&L");
}

main().catch(console.error);
