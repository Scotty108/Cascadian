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

  console.log("\n🔍 DEBUG: Condition matching\n");

  // Check how many positions vs resolved
  console.log("1. Resolved conditions in winning_index:");
  try {
    const resolved = await queryData(`
      SELECT count() as resolved_count
      FROM winning_index
    `);
    console.log(`   Total resolved: ${resolved[0].resolved_count}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check positions conditions
  console.log("\n2. Conditions with wallet trades:");
  try {
    const conditions = await queryData(`
      SELECT count(DISTINCT condition_id_norm) as traded_conditions
      FROM outcome_positions_v2
      WHERE wallet IN ('${wallet1}', '${wallet2}')
    `);
    console.log(`   Traded conditions: ${conditions[0].traded_conditions}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check overlapping conditions
  console.log("\n3. Overlap: positions with resolved winners:");
  try {
    const overlap = await queryData(`
      SELECT count(DISTINCT p.condition_id_norm) as with_winners
      FROM outcome_positions_v2 p
      INNER JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      WHERE p.wallet IN ('${wallet1}', '${wallet2}')
    `);
    console.log(`   Positions with resolved winners: ${overlap[0].with_winners}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check if there are unrealized positions
  console.log("\n4. Positions without resolved winners:");
  try {
    const unresolved = await queryData(`
      SELECT count(DISTINCT p.condition_id_norm) as unresolved_count
      FROM outcome_positions_v2 p
      LEFT JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      WHERE p.wallet IN ('${wallet1}', '${wallet2}')
        AND w.condition_id_norm IS NULL
    `);
    console.log(`   Unresolved conditions: ${unresolved[0].unresolved_count}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check realized P&L only for RESOLVED positions
  console.log("\n5. Realized P&L (only RESOLVED positions):");
  try {
    const realized = await queryData(`
      SELECT
        p.wallet,
        round(sum(
          if(p.outcome_idx = w.win_idx, greatest(p.net_shares, 0), 0) +
          if(p.outcome_idx != w.win_idx, greatest(-p.net_shares, 0), 0)
        ), 4) AS settlement_usd,
        round(sum(c.cashflow_usdc), 4) AS cashflow_total,
        round(settlement_usd + cashflow_total, 2) AS realized_pnl_usd
      FROM outcome_positions_v2 p
      INNER JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      LEFT JOIN trade_cashflows_v3 c USING (wallet, market_id, condition_id_norm, outcome_idx)
      WHERE p.wallet IN ('${wallet1}', '${wallet2}')
      GROUP BY p.wallet
    `);
    console.log(JSON.stringify(realized, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check what portion of their positions are resolved
  console.log("\n6. P&L breakdown - resolved vs unresolved:");
  try {
    const breakdown = await queryData(`
      SELECT
        p.wallet,
        round(sum(
          if(p.outcome_idx = w.win_idx, greatest(p.net_shares, 0), 0) +
          if(p.outcome_idx != w.win_idx, greatest(-p.net_shares, 0), 0)
        ), 4) AS resolved_settlement,
        round(sum(if(w.condition_id_norm IS NOT NULL, c.cashflow_usdc, 0)), 4) AS resolved_cashflow,
        round(round(sum(
          if(p.outcome_idx = w.win_idx, greatest(p.net_shares, 0), 0) +
          if(p.outcome_idx != w.win_idx, greatest(-p.net_shares, 0), 0)
        ), 4) + round(sum(if(w.condition_id_norm IS NOT NULL, c.cashflow_usdc, 0)), 4), 2) AS resolved_pnl
      FROM outcome_positions_v2 p
      LEFT JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      LEFT JOIN trade_cashflows_v3 c USING (wallet, market_id, condition_id_norm, outcome_idx)
      WHERE p.wallet IN ('${wallet1}', '${wallet2}')
      GROUP BY p.wallet
    `);
    console.log(JSON.stringify(breakdown, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }
}

main().catch(console.error);
