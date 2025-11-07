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

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  console.log("\n📋 DEBUG: Check what data exists\n");

  // Check outcome_positions_v2
  console.log("1. outcome_positions_v2 sample:");
  try {
    const positions = await queryData(`
      SELECT
        wallet,
        condition_id_norm,
        outcome_idx,
        count() as cnt
      FROM outcome_positions_v2
      WHERE wallet IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet, condition_id_norm, outcome_idx
      LIMIT 5
    `);
    console.log(JSON.stringify(positions, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check winning_index
  console.log("\n2. winning_index sample:");
  try {
    const winning = await queryData(`
      SELECT *
      FROM winning_index
      LIMIT 5
    `);
    console.log(JSON.stringify(winning, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check if any matches exist
  console.log("\n3. Check join match:");
  try {
    const match = await queryData(`
      SELECT
        p.wallet,
        p.condition_id_norm,
        p.outcome_idx,
        w.condition_id_norm as w_condition,
        w.win_idx,
        count() as cnt
      FROM outcome_positions_v2 p
      ANY LEFT JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      WHERE p.wallet IN ('${wallet1}', '${wallet2}')
      GROUP BY p.wallet, p.condition_id_norm, p.outcome_idx, w.condition_id_norm, w.win_idx
      LIMIT 10
    `);
    console.log(JSON.stringify(match, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Simple check without winning_index
  console.log("\n4. Simple P&L without winning_index join:");
  try {
    const simple = await queryData(`
      SELECT
        p.wallet,
        round(sum(greatest(p.net_shares, 0)), 4) AS total_longs,
        round(sum(greatest(-p.net_shares, 0)), 4) AS total_shorts,
        round(sum(c.cashflow_usdc), 4) AS cashflow_total
      FROM outcome_positions_v2 p
      ANY LEFT JOIN trade_cashflows_v3 c USING (wallet, market_id, condition_id_norm, outcome_idx)
      WHERE p.wallet IN ('${wallet1}', '${wallet2}')
      GROUP BY p.wallet
    `);
    console.log(JSON.stringify(simple, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }
}

main().catch(console.error);
