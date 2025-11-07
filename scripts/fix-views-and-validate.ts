#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
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
  console.log("FIX VIEWS & VALIDATE DATA");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // First check how much data we have
  console.log("📊 Data volume check:\n");
  try {
    const counts = await queryData(`
      SELECT 
        (SELECT count() FROM trades_raw) as trades_raw_rows,
        (SELECT count(DISTINCT wallet_address) FROM trades_raw) as unique_wallets,
        (SELECT count() FROM trades_dedup_mat) as dedup_mat_rows
    `);
    const data = counts[0];
    console.log(`  trades_raw: ${data.trades_raw_rows} rows`);
    console.log(`  unique wallets: ${data.unique_wallets}`);
    console.log(`  trades_dedup_mat: ${data.dedup_mat_rows} rows\n`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Fix views - just use the columns as they are, no type conversion needed
  console.log("🔧 Fixing downstream views:\n");

  const views = [
    [
      "outcome_positions_v2",
      `CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  outcome_index AS outcome_idx,
  sum(if(side = 1,  1.0, -1.0) * toFloat64(shares)) AS net_shares
FROM trades_dedup_mat
WHERE outcome_index IS NOT NULL
GROUP BY wallet, market_id, condition_id_norm, outcome_index`
    ],
    [
      "trade_cashflows_v3",
      `CREATE OR REPLACE VIEW trade_cashflows_v3 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  outcome_index AS outcome_idx,
  toFloat64(entry_price) AS px,
  toFloat64(shares) AS sh,
  round(
    toFloat64(entry_price) * toFloat64(shares) *
    if(side = 1, -1, 1),
    8
  ) AS cashflow_usdc
FROM trades_dedup_mat
WHERE outcome_index IS NOT NULL`
    ]
  ];

  for (const [name, query] of views) {
    await executeQuery(name, query);
  }

  console.log("\n✅ Views fixed\n");

  // Quick check on position data
  console.log("📈 Position sample check:\n");
  try {
    const sample = await queryData(`
      SELECT 
        wallet,
        count() as position_count,
        sum(abs(net_shares)) as total_shares
      FROM outcome_positions_v2
      GROUP BY wallet
      LIMIT 10
    `);
    console.log(JSON.stringify(sample, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }
}

main().catch(console.error);
