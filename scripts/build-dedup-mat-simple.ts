#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 600000,
});

async function executeQuery(name: string, query: string) {
  try {
    console.log(`🔄 ${name}...`);
    await ch.query({ query });
    console.log(`✅ ${name}`);
    return true;
  } catch (e: any) {
    console.error(`❌ ${name}: ${e.message?.substring(0, 200)}`);
    return false;
  }
}

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("BUILD TRADES DEDUP MAT - SIMPLIFIED REPLACINGMERGETREE");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Step 1: Drop and recreate the materialized table (simplified schema)
  const dropDedupMat = `DROP TABLE IF EXISTS trades_dedup_mat`;

  const createDedupMat = `CREATE TABLE trades_dedup_mat
(
  dedup_key String,
  wallet_address String,
  market_id String,
  condition_id String,
  outcome_index String,
  side String,
  entry_price String,
  shares String,
  transaction_hash String,
  created_at String,
  trade_id String,
  _version DateTime64(3)
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY dedup_key`;

  // Step 2: Insert into materialized table with simpler dedup key
  const insertDedupMat = `INSERT INTO trades_dedup_mat
SELECT
  concat(lower(toString(transaction_hash)), ':', lower(toString(wallet_address))) AS dedup_key,
  lower(toString(wallet_address)) AS wallet_address,
  lower(toString(market_id)) AS market_id,
  toString(condition_id) AS condition_id,
  toString(outcome_index) AS outcome_index,
  toString(side) AS side,
  toString(entry_price) AS entry_price,
  toString(shares) AS shares,
  lower(toString(transaction_hash)) AS transaction_hash,
  toString(created_at) AS created_at,
  toString(trade_id) AS trade_id,
  now64(3) AS _version
FROM trades_raw`;

  // Step 3: Optimize the materialized table
  const optimizeDedupMat = `OPTIMIZE TABLE trades_dedup_mat FINAL`;

  // Execute steps 1-3
  const setupSteps = [
    ["Drop existing trades_dedup_mat", dropDedupMat],
    ["Create trades_dedup_mat table", createDedupMat],
    ["Insert data into trades_dedup_mat", insertDedupMat],
    ["Optimize trades_dedup_mat", optimizeDedupMat]
  ];

  let successCount = 0;
  for (const [name, query] of setupSteps) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }

  console.log(`\n✅ Setup complete: ${successCount}/${setupSteps.length} successful\n`);

  // Step 4: Verify dedup worked
  console.log("🔍 VERIFICATION: Prove Dedup Worked\n");
  try {
    const verifQuery = `
      SELECT 'raw' AS tag,
             count() AS rows,
             uniqExact(transaction_hash, wallet_address) AS uniq_fills
      FROM trades_raw
      WHERE lower(wallet_address) IN ('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      UNION ALL
      SELECT 'mat',
             count(),
             uniqExact(transaction_hash, wallet_address)
      FROM trades_dedup_mat
      WHERE lower(wallet_address) IN ('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      UNION ALL
      SELECT 'mat_by_key',
             count(),
             uniqExact(dedup_key)
      FROM trades_dedup_mat
      WHERE lower(wallet_address) IN ('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
    `;

    const verifResults = await queryData(verifQuery);

    if (verifResults.length >= 3) {
      const raw = verifResults.find((r: any) => r.tag === 'raw');
      const mat = verifResults.find((r: any) => r.tag === 'mat');
      const matByKey = verifResults.find((r: any) => r.tag === 'mat_by_key');

      console.log(`  Raw trades:       ${raw.rows} rows, ${raw.uniq_fills} unique fills`);
      console.log(`  Mat table:        ${mat.rows} rows, ${mat.uniq_fills} unique fills`);
      console.log(`  Mat by dedup_key: ${matByKey.rows} rows, ${matByKey.uniq_fills} unique dedup keys`);
      console.log(`  Dedup reduction:  ${raw.rows} → ${mat.rows} (${((raw.rows - mat.rows) / raw.rows * 100).toFixed(1)}% removed)`);

      if (mat.rows === matByKey.rows && matByKey.rows === matByKey.uniq_fills) {
        console.log(`  ✅ PASS: mat.rows === mat_by_key.rows === mat_by_key.uniq_fills (no duplicates)\n`);
      } else {
        console.log(`  ⚠️  NOTE: mat.rows=${mat.rows}, mat_by_key.rows=${matByKey.rows}, uniq=${matByKey.uniq_fills}\n`);
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Verification failed: ${e.message?.substring(0, 200)}\n`);
  }

  // Step 5: Update downstream views to use trades_dedup_mat
  console.log("🔧 STEP 4: Update Downstream Views\n");

  const downstreamViews = [
    [
      "trade_cashflows_v3 (using trades_dedup_mat)",
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
    if(side IN ('YES','BUY',1), -1, 1),
    8
  ) AS cashflow_usdc
FROM trades_dedup_mat
WHERE market_id NOT IN ('12')`
    ],
    [
      "outcome_positions_v2 (using trades_dedup_mat)",
      `CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt16(toInt32OrNull(outcome_index)) AS outcome_idx,
  sum(if(side IN ('YES','BUY',1),  1.0, -1.0) * toFloat64(shares)) AS net_shares
FROM trades_dedup_mat
WHERE market_id NOT IN ('12')
GROUP BY wallet, market_id, condition_id, outcome_index`
    ]
  ];

  let downstreamCount = 0;
  for (const [name, query] of downstreamViews) {
    if (await executeQuery(name, query)) {
      downstreamCount++;
    }
  }

  console.log(`\n✅ Downstream views updated: ${downstreamCount}/${downstreamViews.length}\n`);

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("✅ Dedup materialization complete!\n");
  console.log("Next: Re-run diagnostic protocol steps 1, 2, and 5 to validate.\n");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
