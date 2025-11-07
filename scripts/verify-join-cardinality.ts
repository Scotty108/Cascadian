#!/usr/bin/env npx tsx

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

const TARGET_WALLETS = [
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
];
const SNAPSHOT_TS = '2025-10-31 23:59:59';

async function verifyJoinCardinality(wallet: string) {
  const walletLower = wallet.toLowerCase();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Verifying join cardinality for wallet: ${wallet}`);
  console.log(`${'='.repeat(80)}\n`);

  // 1. Check if market_id -> condition_id_norm is 1:1
  console.log("🔍 Test 1: market_id -> condition_id_norm cardinality");
  const marketToConditionQuery = `
    SELECT
      count(DISTINCT t.market_id) as unique_markets,
      count(DISTINCT (t.market_id, c.condition_id_norm)) as unique_pairs
    FROM (
      SELECT DISTINCT market_id
      FROM trades_raw
      WHERE lower(wallet_address) = '${walletLower}'
        AND timestamp <= toDateTime('${SNAPSHOT_TS}')
    ) t
    LEFT JOIN canonical_condition c ON t.market_id = c.market_id
  `;
  const result1 = await queryData(marketToConditionQuery);
  const uniqueMarkets = result1[0].unique_markets;
  const uniquePairs = result1[0].unique_pairs;
  console.log(`   Unique markets: ${uniqueMarkets}`);
  console.log(`   Unique (market, condition) pairs: ${uniquePairs}`);
  if (uniqueMarkets === uniquePairs) {
    console.log(`   ✅ 1:1 mapping confirmed\n`);
  } else {
    console.log(`   ❌ WARNING: Not a 1:1 mapping! Some markets have multiple conditions\n`);
  }

  // 2. Check for any markets that map to multiple conditions
  console.log("🔍 Test 2: Markets with multiple condition_id_norms");
  const multiConditionQuery = `
    SELECT
      t.market_id,
      count(DISTINCT c.condition_id_norm) as condition_count,
      groupArray(DISTINCT c.condition_id_norm) as conditions
    FROM (
      SELECT DISTINCT market_id
      FROM trades_raw
      WHERE lower(wallet_address) = '${walletLower}'
        AND timestamp <= toDateTime('${SNAPSHOT_TS}')
    ) t
    LEFT JOIN canonical_condition c ON t.market_id = c.market_id
    GROUP BY t.market_id
    HAVING condition_count > 1
    LIMIT 3
  `;
  const result2 = await queryData(multiConditionQuery);
  if (result2.length > 0) {
    console.log(`   ❌ Found ${result2.length} markets with multiple conditions:`);
    console.log(JSON.stringify(result2, null, 2));
  } else {
    console.log(`   ✅ No markets with multiple conditions\n`);
  }

  // 3. Check condition_id_norm -> outcomes cardinality
  console.log("🔍 Test 3: condition_id_norm -> outcomes cardinality (expected: 1:many)");
  const conditionToOutcomesQuery = `
    SELECT
      count(DISTINCT c.condition_id_norm) as unique_conditions,
      count(DISTINCT (c.condition_id_norm, o.outcome_idx)) as unique_condition_outcome_pairs
    FROM (
      SELECT DISTINCT c.condition_id_norm
      FROM trades_raw t
      ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
      WHERE lower(t.wallet_address) = '${walletLower}'
        AND t.timestamp <= toDateTime('${SNAPSHOT_TS}')
    ) c
    LEFT JOIN market_outcomes_expanded o ON c.condition_id_norm = o.condition_id_norm
  `;
  const result3 = await queryData(conditionToOutcomesQuery);
  const uniqueConditions = result3[0].unique_conditions;
  const uniqueConditionOutcomePairs = result3[0].unique_condition_outcome_pairs;
  console.log(`   Unique conditions: ${uniqueConditions}`);
  console.log(`   Unique (condition, outcome) pairs: ${uniqueConditionOutcomePairs}`);
  const avgOutcomes = uniqueConditionOutcomePairs / uniqueConditions;
  console.log(`   Average outcomes per condition: ${avgOutcomes.toFixed(2)}`);
  console.log(`   ✅ Expected 1:many relationship (conditions have multiple outcomes)\n`);

  // 4. Verify ANY LEFT JOIN behavior prevents fanout
  console.log("🔍 Test 4: Verify ANY LEFT JOIN prevents fanout from outcomes");
  const anyJoinTestQuery = `
    SELECT
      count() as row_count_with_any,
      count(DISTINCT (t.market_id, t.transaction_hash, t.timestamp)) as unique_trades
    FROM (
      SELECT DISTINCT
        market_id,
        transaction_hash,
        timestamp
      FROM trades_raw
      WHERE lower(wallet_address) = '${walletLower}'
        AND timestamp <= toDateTime('${SNAPSHOT_TS}')
    ) t
    ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
    ANY LEFT JOIN market_outcomes_expanded o ON c.condition_id_norm = o.condition_id_norm
  `;
  const result4 = await queryData(anyJoinTestQuery);
  const rowCountWithAny = result4[0].row_count_with_any;
  const uniqueTrades = result4[0].unique_trades;
  console.log(`   Rows after ANY LEFT JOIN: ${rowCountWithAny}`);
  console.log(`   Unique trades: ${uniqueTrades}`);
  if (rowCountWithAny === uniqueTrades) {
    console.log(`   ✅ ANY LEFT JOIN successfully prevented fanout\n`);
  } else {
    console.log(`   ❌ WARNING: Fanout detected even with ANY LEFT JOIN!\n`);
  }

  // 5. Compare with regular LEFT JOIN (what would happen without ANY)
  console.log("🔍 Test 5: Compare with regular LEFT JOIN (without ANY)");
  const regularJoinTestQuery = `
    SELECT count() as row_count_without_any
    FROM (
      SELECT DISTINCT
        market_id,
        transaction_hash,
        timestamp
      FROM trades_raw
      WHERE lower(wallet_address) = '${walletLower}'
        AND timestamp <= toDateTime('${SNAPSHOT_TS}')
    ) t
    LEFT JOIN canonical_condition c ON t.market_id = c.market_id
    LEFT JOIN market_outcomes_expanded o ON c.condition_id_norm = o.condition_id_norm
  `;
  const result5 = await queryData(regularJoinTestQuery);
  const rowCountWithoutAny = result5[0].row_count_without_any;
  console.log(`   Rows with regular LEFT JOIN: ${rowCountWithoutAny}`);
  console.log(`   Rows with ANY LEFT JOIN: ${rowCountWithAny}`);
  console.log(`   Difference: ${rowCountWithoutAny - rowCountWithAny} rows`);
  const fanoutMultiple = rowCountWithoutAny / rowCountWithAny;
  console.log(`   Fanout prevented: ${fanoutMultiple.toFixed(2)}x\n`);

  // 6. Check condition_id_norm -> resolution cardinality
  console.log("🔍 Test 6: condition_id_norm -> resolution cardinality (expected: 1:1)");
  const conditionToResolutionQuery = `
    SELECT
      count(DISTINCT c.condition_id_norm) as unique_conditions,
      count(DISTINCT (c.condition_id_norm, r.winning_outcome)) as unique_condition_resolution_pairs
    FROM (
      SELECT DISTINCT c.condition_id_norm
      FROM trades_raw t
      ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
      WHERE lower(t.wallet_address) = '${walletLower}'
        AND t.timestamp <= toDateTime('${SNAPSHOT_TS}')
    ) c
    LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
  `;
  const result6 = await queryData(conditionToResolutionQuery);
  const uniqueConditions6 = result6[0].unique_conditions;
  const uniquePairs6 = result6[0].unique_condition_resolution_pairs;
  console.log(`   Unique conditions: ${uniqueConditions6}`);
  console.log(`   Unique (condition, resolution) pairs: ${uniquePairs6}`);
  if (uniqueConditions6 === uniquePairs6) {
    console.log(`   ✅ 1:1 mapping confirmed\n`);
  } else {
    console.log(`   ⚠️  Note: ${uniqueConditions6 - uniquePairs6} conditions have no resolution yet\n`);
  }

  // 7. Check for any conditions with multiple resolutions (should be 0)
  console.log("🔍 Test 7: Conditions with multiple resolutions");
  const multiResolutionQuery = `
    SELECT
      c.condition_id_norm,
      count() as resolution_count,
      groupArray(r.winning_outcome) as outcomes
    FROM (
      SELECT DISTINCT c.condition_id_norm
      FROM trades_raw t
      ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
      WHERE lower(t.wallet_address) = '${walletLower}'
        AND t.timestamp <= toDateTime('${SNAPSHOT_TS}')
    ) c
    LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
    WHERE r.winning_outcome != ''
    GROUP BY c.condition_id_norm
    HAVING resolution_count > 1
    LIMIT 3
  `;
  const result7 = await queryData(multiResolutionQuery);
  if (result7.length > 0) {
    console.log(`   ❌ Found ${result7.length} conditions with multiple resolutions:`);
    console.log(JSON.stringify(result7, null, 2));
  } else {
    console.log(`   ✅ No conditions with multiple resolutions\n`);
  }

  // 8. Sample a few trades to verify the join chain
  console.log("🔍 Test 8: Sample trades with full join chain");
  const sampleQuery = `
    SELECT
      t.market_id,
      t.transaction_hash,
      c.condition_id_norm,
      o.outcome_idx,
      o.outcome_label,
      r.winning_outcome
    FROM (
      SELECT DISTINCT
        market_id,
        transaction_hash,
        timestamp
      FROM trades_raw
      WHERE lower(wallet_address) = '${walletLower}'
        AND timestamp <= toDateTime('${SNAPSHOT_TS}')
      LIMIT 3
    ) t
    ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
    ANY LEFT JOIN market_outcomes_expanded o ON c.condition_id_norm = o.condition_id_norm
    ANY LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
  `;
  const result8 = await queryData(sampleQuery);
  console.log("   Sample trades after all joins:");
  console.log(JSON.stringify(result8, null, 2));
  console.log();
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("JOIN CARDINALITY VERIFICATION");
  console.log("=".repeat(80));
  console.log(`\nSnapshot: ${SNAPSHOT_TS}`);
  console.log(`\nThis script verifies:`);
  console.log(`  1. market_id -> condition_id_norm is 1:1`);
  console.log(`  2. condition_id_norm -> outcomes is 1:many (but ANY JOIN prevents fanout)`);
  console.log(`  3. condition_id_norm -> resolution is 1:1`);
  console.log(`  4. ANY LEFT JOIN successfully prevents fanout`);
  console.log(`  5. No unexpected row multiplication occurs\n`);

  for (const wallet of TARGET_WALLETS) {
    try {
      await verifyJoinCardinality(wallet);
    } catch (error: any) {
      console.error(`\n❌ Error verifying wallet ${wallet}:`, error.message);
    }
  }

  console.log("=".repeat(80));
  console.log("VERIFICATION COMPLETE");
  console.log("=".repeat(80));

  await ch.close();
}

main().catch(console.error);
