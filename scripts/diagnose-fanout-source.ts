#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 60000,
});

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n🔍 DIAGNOSE FANOUT SOURCE\n");

  // Check trades_dedup_mat row count
  try {
    const trades = await queryData(`SELECT count() as cnt FROM trades_dedup_mat`);
    console.log(`1) trades_dedup_mat rows: ${trades[0]?.cnt}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check unique wallet/market/outcome combos in raw trades
  try {
    const unique = await queryData(`
      SELECT count(DISTINCT (wallet_address, market_id, outcome_index)) as unique_combos
      FROM trades_dedup_mat
      WHERE outcome_index IS NOT NULL
    `);
    console.log(`2) Unique wallet/market/outcome in trades: ${unique[0]?.unique_combos}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check outcome_positions_v3 row count
  try {
    const pos = await queryData(`SELECT count() as cnt FROM outcome_positions_v3`);
    console.log(`3) outcome_positions_v3 rows: ${pos[0]?.cnt}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check unique wallet/market in outcome_positions
  try {
    const unique = await queryData(`
      SELECT count(DISTINCT (wallet, market_id, idx)) as unique_combos
      FROM outcome_positions_v3
    `);
    console.log(`4) Unique wallet/market/idx in outcome_positions_v3: ${unique[0]?.unique_combos}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Find markets with multiple condition_ids
  try {
    const multi = await queryData(`
      SELECT count() as cnt
      FROM (
        SELECT market_id
        FROM outcome_positions_v3
        GROUP BY market_id
        HAVING count(DISTINCT condition_id_norm) > 1
      )
    `);
    console.log(`\n5) Markets with MULTIPLE condition_id_norms: ${multi[0]?.cnt}`);
    
    if (multi[0]?.cnt > 0) {
      const samples = await queryData(`
        SELECT market_id, arrayDistinct(groupArray(condition_id_norm)) as condition_ids, count() as row_count
        FROM outcome_positions_v3
        GROUP BY market_id
        HAVING count(DISTINCT condition_id_norm) > 1
        LIMIT 5
      `);
      console.log(`\n   Samples of multi-condition markets:`);
      console.log(JSON.stringify(samples, null, 2));
    }
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check if condition_id varies per market (it shouldn't)
  try {
    const cardCheck = await queryData(`
      SELECT 
        count(DISTINCT market_id) as markets,
        count(DISTINCT (market_id, condition_id_norm)) as market_condition_pairs
      FROM outcome_positions_v3
    `);
    const data = cardCheck[0];
    console.log(`\n6) Cardinality check:`);
    console.log(`   Markets: ${data.markets}`);
    console.log(`   Market-condition pairs: ${data.market_condition_pairs}`);
    if (data.market_condition_pairs === data.markets) {
      console.log(`   ✅ 1:1 mapping (correct)`);
    } else {
      console.log(`   ⚠️  Multiple conditions per market (FANOUT SOURCE!)`);
    }
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }
}

main().catch(console.error);
