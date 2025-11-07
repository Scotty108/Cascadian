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
  console.log("BUILD TRADES DEDUP MAT - MATERIALIZED REPLACINGMERGETREE");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Step 1: Create keyed view
  const createDedupKeyedView = `CREATE OR REPLACE VIEW trades_dedup_keyed AS
SELECT
  -- deterministic key
  multiIf(
    lengthUTF8(toString(trade_id)) > 0,
      concat('id:', toString(trade_id)),
    transaction_hash != '' AND log_index IS NOT NULL,
      concat('tx:', lower(toString(transaction_hash)), ':', toString(toInt32OrNull(log_index)), ':', lower(toString(wallet_address))),
    -- fallback: wallet+market+outcome+block+rounded price/shares
      concat(
        'fx:',
        lower(toString(wallet_address)), ':', lower(toString(market_id)), ':', toString(toInt16OrNull(outcome_index)), ':',
        toString(toUInt64OrNull(block_number)), ':',
        toString(round(toFloat64(entry_price)*10000)), ':',
        toString(round(toFloat64(shares)*1000))
      )
  ) AS dedup_key,
  *
FROM trades_raw`;

  // Step 2: Drop and recreate the materialized table
  const dropDedupMat = `DROP TABLE IF EXISTS trades_dedup_mat`;

  const createDedupMat = `CREATE TABLE trades_dedup_mat
(
  dedup_key String,
  wallet_address String,
  market_id String,
  condition_id String,
  outcome_index Int16,
  side LowCardinality(String),
  entry_price Float64,
  shares Float64,
  transaction_hash String,
  log_index Int32,
  block_number UInt64,
  created_at DateTime64(3),
  trade_id String,
  _version DateTime64(3)
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY dedup_key`;

  // Step 3: Insert into materialized table
  const insertDedupMat = `INSERT INTO trades_dedup_mat
SELECT
  dedup_key,
  lower(toString(wallet_address)) AS wallet_address,
  lower(toString(market_id)) AS market_id,
  toString(condition_id) AS condition_id,
  toInt16OrNull(outcome_index) AS outcome_index,
  toString(side) AS side,
  toFloat64(entry_price) AS entry_price,
  toFloat64(shares) AS shares,
  lower(toString(transaction_hash)) AS transaction_hash,
  toInt32OrNull(log_index) AS log_index,
  toUInt64OrNull(block_number) AS block_number,
  parseDateTime64BestEffortOrNull(toString(created_at)) AS created_at,
  toString(trade_id) AS trade_id,
  coalesce(parseDateTime64BestEffortOrNull(toString(created_at)), now64(3)) AS _version
FROM trades_dedup_keyed`;

  // Step 4: Optimize the materialized table
  const optimizeDedupMat = `OPTIMIZE TABLE trades_dedup_mat FINAL`;

  // Execute steps 1-4
  const setupSteps = [
    ["Create dedup keyed view", createDedupKeyedView],
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

  // Step 5: Verify dedup worked
  console.log("🔍 VERIFICATION: Step 3 - Prove Dedup Worked\n");
  try {
    const verifQuery = `
      WITH w AS (
        SELECT array(
          '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
          '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
        ) AS wallets
      )
      SELECT 'raw' AS tag,
             count() AS rows,
             uniqExact(transaction_hash, toInt32OrNull(log_index), lower(toString(wallet_address))) AS uniq_fills
      FROM trades_raw, w WHERE lower(wallet_address) IN wallets
      UNION ALL
      SELECT 'mat',
             count(),
             uniqExact(transaction_hash, toInt32OrNull(log_index), lower(toString(wallet_address)))
      FROM trades_dedup_mat, w WHERE lower(wallet_address) IN wallets
      UNION ALL
      SELECT 'mat_by_key',
             count(),
             uniqExact(dedup_key)
      FROM trades_dedup_mat, w WHERE lower(wallet_address) IN wallets
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
        console.log(`  ❌ WARNING: Mismatch detected. mat.rows=${mat.rows}, mat_by_key.rows=${matByKey.rows}, uniq=${matByKey.uniq_fills}\n`);
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Verification failed: ${e.message?.substring(0, 200)}\n`);
  }

  // Step 6: Update downstream views to use trades_dedup_mat
  console.log("🔧 STEP 4: Update Downstream Views\n");

  const downstreamViews = [
    [
      "trade_cashflows_v3 (using trades_dedup_mat)",
      `CREATE OR REPLACE VIEW trade_cashflows_v3 AS
SELECT
  wallet_address AS wallet,
  market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt16OrNull(outcome_index) AS outcome_idx,
  case
    when entry_price > 10000 then entry_price/10000
    when entry_price > 100 then entry_price/100
    else entry_price
  end AS px_norm,
  abs(shares) AS sh_norm,
  if(side IN ('YES','BUY','Buy','buy', '1'), -px_norm*sh_norm, px_norm*sh_norm) AS cashflow_usdc
FROM trades_dedup_mat
WHERE market_id NOT IN ('12')`
    ],
    [
      "outcome_positions_v2 (using trades_dedup_mat)",
      `CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  wallet_address AS wallet,
  market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt16OrNull(outcome_index) AS outcome_idx,
  sum(if(side IN ('YES','BUY','Buy','buy','1'),  1.0, -1.0) * shares) AS net_shares
FROM trades_dedup_mat
WHERE market_id NOT IN ('12')
GROUP BY wallet_address, market_id, condition_id, outcome_index`
    ],
    [
      "realized_pnl_by_market_final (fixed with ANY JOINs)",
      `CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
WITH win AS (
  SELECT condition_id_norm, toInt16(win_idx) AS win_idx, resolved_at FROM winning_index
)
SELECT
  p.wallet,
  p.market_id,
  p.condition_id_norm,
  w.resolved_at,
  round(
    sumIf(p.net_shares, p.outcome_idx = w.win_idx)
    + sum(-c.cashflow_usdc)
  , 4) AS realized_pnl_usd
FROM outcome_positions_v2 p
ANY LEFT JOIN trade_cashflows_v3 c
  ON c.wallet = p.wallet
 AND c.market_id = p.market_id
 AND c.condition_id_norm = p.condition_id_norm
 AND c.outcome_idx = p.outcome_idx
ANY LEFT JOIN win w USING (condition_id_norm)
WHERE w.win_idx IS NOT NULL
GROUP BY p.wallet, p.market_id, p.condition_id_norm, w.resolved_at`
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
  console.log("Next: Run diagnostic protocol steps 1, 2, and 5 to validate.\n");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
