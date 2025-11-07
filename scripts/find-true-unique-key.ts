#!/usr/bin/env npx tsx

/**
 * Find the TRUE unique key for fills in trades_raw
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

const TARGET_WALLETS = [
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
];

async function queryData<T = any>(query: string): Promise<T[]> {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    throw e;
  }
}

async function checkSchema() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("1. CHECK SCHEMA FOR UNIQUE IDENTIFIERS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const schemaQuery = `
    SELECT
      name,
      type
    FROM system.columns
    WHERE
      database = currentDatabase()
      AND table = 'trades_raw'
    ORDER BY position
  `;

  const columns = await queryData<{ name: string; type: string }>(schemaQuery);

  console.log("Available columns in trades_raw:\n");
  for (const col of columns) {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  }
  console.log();
}

async function testUniquenessCandidates() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("2. TEST UNIQUENESS OF VARIOUS KEY COMBINATIONS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const query = `
    SELECT
      count() as total_rows,
      count(DISTINCT trade_id) as uniq_trade_id,
      count(DISTINCT (transaction_hash, wallet_address, shares, entry_price)) as uniq_tx_wallet_shares_price,
      count(DISTINCT (transaction_hash, wallet_address, shares, entry_price, usd_value)) as uniq_tx_wallet_full,
      count(DISTINCT (transaction_hash, wallet_address, timestamp, shares, entry_price, side)) as uniq_tx_wallet_timestamp_full,
      count(DISTINCT (transaction_hash, market_id, shares, entry_price, side)) as uniq_tx_market_fill,
      count(DISTINCT (transaction_hash, condition_id, shares, entry_price, side)) as uniq_tx_condition_fill
    FROM trades_raw
    WHERE lower(wallet_address) IN (
      '${TARGET_WALLETS[0]}',
      '${TARGET_WALLETS[1]}'
    )
  `;

  const results = await queryData(query);
  const stats = results[0];

  console.log("Uniqueness test results:\n");
  console.log(`Total rows:                                                ${stats.total_rows}`);
  console.log(`─────────────────────────────────────────────────────────────────────────────`);
  console.log(`trade_id:                                                  ${stats.uniq_trade_id} ${stats.uniq_trade_id === stats.total_rows ? '✅' : '❌'}`);
  console.log(`(tx_hash, wallet, shares, price):                          ${stats.uniq_tx_wallet_shares_price} ${stats.uniq_tx_wallet_shares_price === stats.total_rows ? '✅' : '❌'}`);
  console.log(`(tx_hash, wallet, shares, price, usd_value):               ${stats.uniq_tx_wallet_full} ${stats.uniq_tx_wallet_full === stats.total_rows ? '✅' : '❌'}`);
  console.log(`(tx_hash, wallet, timestamp, shares, price, side):         ${stats.uniq_tx_wallet_timestamp_full} ${stats.uniq_tx_wallet_timestamp_full === stats.total_rows ? '✅' : '❌'}`);
  console.log(`(tx_hash, market_id, shares, price, side):                 ${stats.uniq_tx_market_fill} ${stats.uniq_tx_market_fill === stats.total_rows ? '✅' : '❌'}`);
  console.log(`(tx_hash, condition_id, shares, price, side):              ${stats.uniq_tx_condition_fill} ${stats.uniq_tx_condition_fill === stats.total_rows ? '✅' : '❌'}`);
  console.log();

  return stats;
}

async function checkForTrueDuplicates() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("3. CHECK FOR TRUE DUPLICATES (IDENTICAL ROWS)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const query = `
    SELECT
      transaction_hash,
      lower(wallet_address) as wallet,
      timestamp,
      side,
      shares,
      entry_price,
      usd_value,
      market_id,
      count() as dup_count
    FROM trades_raw
    WHERE lower(wallet_address) IN (
      '${TARGET_WALLETS[0]}',
      '${TARGET_WALLETS[1]}'
    )
    GROUP BY
      transaction_hash,
      wallet,
      timestamp,
      side,
      shares,
      entry_price,
      usd_value,
      market_id
    HAVING count() > 1
    ORDER BY dup_count DESC
    LIMIT 10
  `;

  const duplicates = await queryData(query);

  if (duplicates.length === 0) {
    console.log("✅ NO TRUE DUPLICATES FOUND!\n");
    console.log("All rows are unique when considering (tx_hash, wallet, timestamp, side, shares, price, value, market_id).\n");
    console.log("This confirms that what appeared as 'duplicates' by trade_id are actually");
    console.log("legitimate distinct fills that should ALL be preserved.\n");
    return 0;
  } else {
    console.log(`❌ Found ${duplicates.length} groups of true duplicates:\n`);
    for (const [idx, dup] of duplicates.entries()) {
      console.log(`${idx + 1}. tx: ${dup.transaction_hash.substring(0, 20)}... | wallet: ${dup.wallet.substring(0, 10)}...`);
      console.log(`   timestamp: ${dup.timestamp} | side: ${dup.side} | shares: ${dup.shares} | price: ${dup.entry_price}`);
      console.log(`   Duplicate count: ${dup.dup_count}\n`);
    }
    return duplicates.length;
  }
}

async function recommendUniqueKey(stats: any, hasTrueDups: number) {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("4. RECOMMENDATION");
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (hasTrueDups === 0) {
    console.log("✅ CONCLUSION: No deduplication needed!\n");
    console.log("All rows in trades_raw represent unique, legitimate fills.");
    console.log("The 'duplicates' identified by trade_id are actually multiple fills");
    console.log("within a single transaction, which is expected behavior.\n");

    console.log("RECOMMENDED APPROACH:\n");
    console.log("1. DO NOT deduplicate by trade_id");
    console.log("2. Use ALL rows in trades_raw for P&L calculations");
    console.log("3. If a unique key is needed for joins, use composite key:\n");
    console.log("   (transaction_hash, wallet_address, shares, entry_price, usd_value)\n");
    console.log("4. Or generate a synthetic unique key:\n");
    console.log("   row_number() OVER (ORDER BY transaction_hash, timestamp, shares)\n");

    console.log("\nSQL PATTERN FOR UNIQUE KEY:\n");
    console.log("```sql");
    console.log("SELECT");
    console.log("  *,");
    console.log("  row_number() OVER (");
    console.log("    ORDER BY transaction_hash, timestamp, shares, entry_price");
    console.log("  ) as unique_fill_id");
    console.log("FROM trades_raw");
    console.log("```\n");

  } else {
    console.log("⚠️  TRUE DUPLICATES DETECTED\n");
    console.log(`Found ${hasTrueDups} groups of identical rows that should be deduped.\n`);
    console.log("RECOMMENDED APPROACH:\n");
    console.log("1. Deduplicate using composite key:");
    console.log("   (transaction_hash, wallet_address, timestamp, side, shares, entry_price, usd_value, market_id)");
    console.log("2. Keep most recent row (by created_at) for each duplicate group\n");

    console.log("SQL PATTERN:\n");
    console.log("```sql");
    console.log("SELECT *");
    console.log("FROM (");
    console.log("  SELECT");
    console.log("    *,");
    console.log("    row_number() OVER (");
    console.log("      PARTITION BY transaction_hash, wallet_address, timestamp,");
    console.log("                   side, shares, entry_price, usd_value, market_id");
    console.log("      ORDER BY created_at DESC");
    console.log("    ) AS rn");
    console.log("  FROM trades_raw");
    console.log(")");
    console.log("WHERE rn = 1");
    console.log("```\n");
  }
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  FIND TRUE UNIQUE KEY FOR FILLS                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  try {
    await checkSchema();
    const stats = await testUniquenessCandidates();
    const hasTrueDups = await checkForTrueDuplicates();
    await recommendUniqueKey(stats, hasTrueDups);

    console.log("════════════════════════════════════════════════════════════════");
    console.log("✅ Analysis Complete");
    console.log("════════════════════════════════════════════════════════════════\n");

  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    process.exit(1);
  }
}

main().catch(console.error);
