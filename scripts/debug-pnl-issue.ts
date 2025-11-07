#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 30000,
});

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  console.log("\n🔍 DEBUG: Check raw cashflows and positions\n");

  // Check what's in trade_cashflows_v3
  console.log("📊 Sample cashflows for HolyMoses7:");
  try {
    const cashflows = await queryData(`
      SELECT 
        wallet,
        market_id,
        condition_id_norm,
        outcome_idx,
        px,
        sh,
        cashflow_usdc
      FROM trade_cashflows_v3
      WHERE wallet = lower('${wallet1}')
      LIMIT 5
    `);
    console.log(JSON.stringify(cashflows, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 200));
  }

  // Check what's in outcome_positions_v2
  console.log("\n📊 Sample positions for HolyMoses7:");
  try {
    const positions = await queryData(`
      SELECT 
        wallet,
        market_id,
        condition_id_norm,
        outcome_idx,
        net_shares
      FROM outcome_positions_v2
      WHERE wallet = lower('${wallet1}')
      LIMIT 5
    `);
    console.log(JSON.stringify(positions, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 200));
  }

  // Check realized_pnl aggregation
  console.log("\n📊 Realized PnL breakdown for HolyMoses7:");
  try {
    const pnl = await queryData(`
      SELECT 
        wallet,
        market_id,
        condition_id_norm,
        realized_pnl_usd,
        count() as market_count
      FROM realized_pnl_by_market_final
      WHERE wallet = lower('${wallet1}')
      GROUP BY wallet, market_id, condition_id_norm
      ORDER BY abs(realized_pnl_usd) DESC
      LIMIT 10
    `);
    console.log(JSON.stringify(pnl, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 200));
  }
}

main().catch(console.error);
