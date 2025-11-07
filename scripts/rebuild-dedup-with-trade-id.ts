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
  console.log("REBUILD trades_dedup_mat WITH CORRECT KEY: trade_id");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Step 1: Create dedup view using trade_id as primary key
  const dedupView = `CREATE OR REPLACE VIEW trades_dedup_view AS
SELECT *
FROM
(
  SELECT
    *,
    row_number() OVER (
      PARTITION BY trade_id
      ORDER BY created_at DESC, timestamp DESC
    ) AS rn
  FROM trades_raw
)
WHERE rn = 1`;

  if (await executeQuery("Create trades_dedup_view (trade_id as key)", dedupView)) {
    console.log();
  }

  // Step 2: Verify view works
  try {
    const count = await queryData(`
      SELECT
        count() as total_rows,
        count(DISTINCT trade_id) as uniq_trade_ids,
        count(DISTINCT (transaction_hash, lower(wallet_address))) as uniq_tx_wallet
      FROM trades_dedup_view
    `);
    const data = count[0];
    console.log(`View verification:`);
    console.log(`  Total rows: ${data.total_rows}`);
    console.log(`  Unique trade_ids: ${data.uniq_trade_ids}`);
    console.log(`  Unique (tx, wallet): ${data.uniq_tx_wallet}\n`);
  } catch (e: any) {
    console.error("View verification error:", e.message?.substring(0, 100));
  }

  // Step 3: Drop old bad table
  if (await executeQuery("DROP old trades_dedup_mat", "DROP TABLE IF EXISTS trades_dedup_mat")) {
    console.log();
  }

  // Step 4: Create new materialized table with ReplacingMergeTree
  const createMat = `CREATE TABLE trades_dedup_mat
ENGINE = ReplacingMergeTree(_version)
ORDER BY (trade_id)
SETTINGS index_granularity = 8192
AS
SELECT
  trade_id,
  wallet_address,
  market_id,
  timestamp,
  side,
  entry_price,
  exit_price,
  shares,
  usd_value,
  pnl,
  is_closed,
  transaction_hash,
  created_at,
  close_price,
  fee_usd,
  slippage_usd,
  hours_held,
  bankroll_at_entry,
  outcome,
  fair_price_at_entry,
  pnl_gross,
  pnl_net,
  return_pct,
  condition_id,
  was_win,
  tx_timestamp,
  canonical_category,
  raw_tags,
  realized_pnl_usd,
  is_resolved,
  resolved_outcome,
  outcome_index,
  recovery_status,
  toUInt64(toUnixTimestamp64Milli(now64())) AS _version
FROM trades_dedup_view`;

  if (await executeQuery("Create new trades_dedup_mat with ReplacingMergeTree", createMat)) {
    console.log();

    // Verify the new table
    try {
      const verify = await queryData(`
        SELECT
          count() as final_rows,
          count(DISTINCT trade_id) as final_uniq_trades,
          count(DISTINCT (transaction_hash, lower(wallet_address))) as final_uniq_tx_wallet
        FROM trades_dedup_mat
      `);
      const data = verify[0];
      console.log(`Final table verification:`);
      console.log(`  Total rows: ${data.final_rows}`);
      console.log(`  Unique trade_ids: ${data.final_uniq_trades}`);
      console.log(`  Unique (tx, wallet): ${data.final_uniq_tx_wallet}`);
      console.log(`  Status: ${data.final_rows === data.final_uniq_trades ? '✅ PASS (no duplicates)' : '⚠️  WARNING (duplicates remain)'}\n`);
    } catch (e: any) {
      console.error("Final verification error:", e.message?.substring(0, 100));
    }
  }

  // Step 5: Test P&L using realized_pnl_usd column from trades_raw
  console.log("🎯 STEP: Check realized_pnl_usd from raw data\n");
  try {
    const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
    const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

    const pnl = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        round(sum(realized_pnl_usd), 2) as total_realized_pnl
      FROM trades_dedup_mat
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of pnl) {
      const expected = row.wallet === wallet1 ? 89975.16 : 102001.46;
      const calculated = parseFloat(row.total_realized_pnl);
      const variance = Math.abs(calculated - expected) / expected * 100;
      console.log(`  ${row.wallet.substring(0, 10)}...`);
      console.log(`    Calculated: $${row.total_realized_pnl}`);
      console.log(`    Expected:   $${expected}`);
      console.log(`    Variance:   ${variance.toFixed(2)}%`);
      console.log(`    Status:     ${variance <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 200)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════");
}

main().catch(console.error);
