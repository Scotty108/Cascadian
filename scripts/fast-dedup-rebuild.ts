#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

async function executeQuery(name: string, query: string) {
  try {
    console.log(`🔄 ${name}...`);
    await ch.query({ query });
    console.log(`✅ ${name}`);
    return true;
  } catch (e: any) {
    console.error(`❌ ${name}: ${e.message?.substring(0, 300)}`);
    return false;
  }
}

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    return [];
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("FAST DEDUP REBUILD - DROP BAD TABLE, START FRESH");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Step 1: Drop the bad table
  if (await executeQuery("DROP bad trades_dedup_mat", "DROP TABLE IF EXISTS trades_dedup_mat")) {
    console.log();
  }

  // Step 2: Create dedup view using row_number
  const dedupView = `CREATE OR REPLACE VIEW trades_dedup_view AS
SELECT * EXCEPT rn
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY transaction_hash, lower(wallet_address)
      ORDER BY created_at
    ) AS rn
  FROM trades_raw
)
WHERE rn = 1`;

  if (await executeQuery("Create trades_dedup_view", dedupView)) {
    console.log();
  }

  // Step 3: Verify view works
  try {
    const count = await queryData(`
      SELECT 
        count() as total_rows,
        count(DISTINCT (transaction_hash, lower(wallet_address))) as uniq_fills
      FROM trades_dedup_view
    `);
    const data = count[0];
    console.log(`View verification:`);
    console.log(`  Total rows: ${data.total_rows}`);
    console.log(`  Unique fills: ${data.uniq_fills}\n`);
  } catch (e: any) {
    console.error("View verification error:", e.message?.substring(0, 100));
  }

  // Step 4: Create materialized table from view (using simple MergeTree)
  const createMat = `CREATE TABLE trades_dedup_mat
ENGINE = MergeTree
ORDER BY (lower(wallet_address), market_id, outcome_index)
SETTINGS index_granularity = 8192
AS
SELECT * FROM trades_dedup_view`;

  if (await executeQuery("Create trades_dedup_mat from view", createMat)) {
    console.log();

    // Verify the new table
    try {
      const verify = await queryData(`
        SELECT 
          count() as final_rows,
          count(DISTINCT (transaction_hash, lower(wallet_address))) as final_uniq
        FROM trades_dedup_mat
      `);
      const data = verify[0];
      console.log(`Final table verification:`);
      console.log(`  Total rows: ${data.final_rows}`);
      console.log(`  Unique fills: ${data.final_uniq}`);
      console.log(`  Status: ${data.final_rows === data.final_uniq ? '✅ PASS (no duplicates)' : '⚠️  WARNING (duplicates remain)'}\n`);
    } catch (e: any) {
      console.error("Final verification error:", e.message?.substring(0, 100));
    }
  }

  // Step 5: Re-point downstream views to trades_dedup_mat
  console.log("\n🔧 Updating downstream views:\n");

  const views = [
    [
      "outcome_positions_v2 (using dedup_mat)",
      `CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt16(toInt32OrNull(outcome_index)) AS outcome_idx,
  sum(if(side IN (1, 'YES','BUY','Buy','buy'),  1.0, -1.0) * toFloat64(shares)) AS net_shares
FROM trades_dedup_mat
GROUP BY wallet, market_id, condition_id_norm, outcome_idx`
    ],
    [
      "trade_cashflows_v3 (using dedup_mat)",
      `CREATE OR REPLACE VIEW trade_cashflows_v3 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt16(toInt32OrNull(outcome_index)) AS outcome_idx,
  toFloat64(entry_price) AS px,
  toFloat64(shares) AS sh,
  round(
    toFloat64(entry_price) * toFloat64(shares) *
    if(side IN (1, 'YES','BUY','Buy','buy'), -1, 1),
    8
  ) AS cashflow_usdc
FROM trades_dedup_mat`
    ]
  ];

  let successCount = 0;
  for (const [name, query] of views) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }
  console.log(`\n✅ Views updated: ${successCount}/${views.length}\n`);

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("✅ REBUILD COMPLETE");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
