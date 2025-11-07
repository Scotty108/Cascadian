#!/usr/bin/env npx tsx

/**
 * Investigate trade_id duplicates
 *
 * This script examines specific examples of duplicate trade_ids
 * to understand why they exist and what differentiates them.
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

const TARGET_WALLETS = {
  holymoses7: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  niggemon: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
};

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

async function findDuplicateExamples(wallet: string, limit: number = 5) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Wallet: ${wallet.substring(0, 10)}...`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Find trade_ids with multiple rows
  const duplicateTradeIdsQuery = `
    SELECT
      trade_id,
      count() as dup_count
    FROM trades_raw
    WHERE lower(wallet_address) = '${wallet}'
    GROUP BY trade_id
    HAVING count() > 1
    ORDER BY dup_count DESC
    LIMIT ${limit}
  `;

  const duplicateTradeIds = await queryData<{ trade_id: string; dup_count: number }>(
    duplicateTradeIdsQuery
  );

  console.log(`Found ${duplicateTradeIds.length} duplicate trade_ids (showing top ${limit}):\n`);

  for (const [idx, dup] of duplicateTradeIds.entries()) {
    console.log(`${idx + 1}. trade_id: ${dup.trade_id} (${dup.dup_count} copies)`);

    // Get all rows for this trade_id
    const detailsQuery = `
      SELECT
        trade_id,
        timestamp,
        created_at,
        side,
        shares,
        entry_price,
        usd_value,
        transaction_hash,
        market_id,
        condition_id,
        outcome
      FROM trades_raw
      WHERE
        lower(wallet_address) = '${wallet}'
        AND trade_id = '${dup.trade_id}'
      ORDER BY timestamp DESC, created_at DESC
    `;

    const details = await queryData(detailsQuery);

    for (const [rowIdx, row] of details.entries()) {
      console.log(`   Row ${rowIdx + 1}:`);
      console.log(`     timestamp:        ${row.timestamp}`);
      console.log(`     created_at:       ${row.created_at}`);
      console.log(`     side:             ${row.side}`);
      console.log(`     shares:           ${row.shares}`);
      console.log(`     entry_price:      ${row.entry_price}`);
      console.log(`     usd_value:        ${row.usd_value}`);
      console.log(`     transaction_hash: ${row.transaction_hash?.substring(0, 20)}...`);
      console.log(`     market_id:        ${row.market_id || 'NULL'}`);
      console.log(`     condition_id:     ${row.condition_id?.substring(0, 20) || 'NULL'}...`);
      console.log(`     outcome:          ${row.outcome}`);
    }

    console.log();
  }
}

async function analyzeDuplicatePatterns(wallet: string) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Duplicate Pattern Analysis: ${wallet.substring(0, 10)}...`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Simplified analysis
  const analysisQuery = `
    SELECT
      count(DISTINCT trade_id) as total_dup_trade_ids,
      count(*) as total_dup_rows,
      round(avg(cnt), 2) as avg_copies_per_trade,
      max(cnt) as max_copies_per_trade
    FROM (
      SELECT
        trade_id,
        count(*) as cnt
      FROM trades_raw
      WHERE lower(wallet_address) = '${wallet}'
      GROUP BY trade_id
      HAVING count() > 1
    )
  `;

  const analysis = await queryData(analysisQuery);
  const stats = analysis[0];

  console.log(`Total duplicate trade_ids:        ${stats.total_dup_trade_ids}`);
  console.log(`Total duplicate rows:             ${stats.total_dup_rows}`);
  console.log(`Average copies per trade:         ${stats.avg_copies_per_trade}`);
  console.log(`Maximum copies per trade:         ${stats.max_copies_per_trade}`);
  console.log();
}

async function verifyDedupLogic(wallet: string) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Verify Dedup Logic: ${wallet.substring(0, 10)}...`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Test the dedup window function
  const testQuery = `
    WITH deduped AS (
      SELECT *
      FROM (
        SELECT
          *,
          row_number() OVER (
            PARTITION BY trade_id
            ORDER BY timestamp DESC, created_at DESC
          ) AS rn
        FROM trades_raw
        WHERE lower(wallet_address) = '${wallet}'
      )
      WHERE rn = 1
    )
    SELECT
      count() as post_dedup_count,
      count(DISTINCT trade_id) as unique_trade_ids,
      count() - count(DISTINCT trade_id) as remaining_duplicates
    FROM deduped
  `;

  const result = await queryData(testQuery);
  const stats = result[0];

  console.log(`Post-dedup row count:       ${stats.post_dedup_count}`);
  console.log(`Unique trade_ids:           ${stats.unique_trade_ids}`);
  console.log(`Remaining duplicates:       ${stats.remaining_duplicates}`);
  console.log();

  if (stats.remaining_duplicates === 0) {
    console.log(`✅ Dedup logic VERIFIED: All duplicates successfully removed`);
  } else {
    console.log(`❌ Dedup logic FAILED: ${stats.remaining_duplicates} duplicates remain`);
  }
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  INVESTIGATE TRADE_ID DUPLICATES                               ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  try {
    // Investigate HolyMoses7
    await findDuplicateExamples(TARGET_WALLETS.holymoses7, 3);
    await analyzeDuplicatePatterns(TARGET_WALLETS.holymoses7);
    await verifyDedupLogic(TARGET_WALLETS.holymoses7);

    // Investigate niggemon
    await findDuplicateExamples(TARGET_WALLETS.niggemon, 3);
    await analyzeDuplicatePatterns(TARGET_WALLETS.niggemon);
    await verifyDedupLogic(TARGET_WALLETS.niggemon);

    console.log("\n════════════════════════════════════════════════════════════════");
    console.log("✅ Investigation Complete");
    console.log("════════════════════════════════════════════════════════════════\n");

  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    process.exit(1);
  }
}

main().catch(console.error);
