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
  const wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';

  console.log("\n📊 DEBUG REALIZED PnL CALCULATION\n");

  // Check what the realized_pnl view returns
  try {
    const pnl = await queryData(`
      SELECT 
        *
      FROM realized_pnl_by_market_final
      WHERE wallet = lower('${wallet}')
      LIMIT 5
    `);
    
    console.log(`Sample realized PnL rows:`);
    console.log(JSON.stringify(pnl, null, 2));
  } catch (e: any) {
    console.error("Error in realized_pnl view:", e.message?.substring(0, 200));
  }

  // Manually check the calculation for one wallet/market/condition
  try {
    const manual = await queryData(`
      WITH win AS (
        SELECT condition_id_norm, toInt16(win_idx) AS win_idx FROM winning_index
      )
      SELECT
        p.wallet,
        p.market_id,
        p.condition_id_norm,
        p.outcome_idx,
        p.net_shares,
        sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) as winning_shares,
        sum(toFloat64(c.cashflow_usdc)) as total_cashflow,
        w.win_idx
      FROM outcome_positions_v2 p
      ANY LEFT JOIN trade_cashflows_v3 c
        ON c.wallet = p.wallet
       AND c.market_id = p.market_id
       AND c.condition_id_norm = p.condition_id_norm
      ANY LEFT JOIN win w
        ON lower(replaceAll(w.condition_id_norm,'0x','')) = lower(replaceAll(p.condition_id_norm,'0x',''))
      WHERE p.wallet = lower('${wallet}')
      GROUP BY p.wallet, p.market_id, p.condition_id_norm, p.outcome_idx, p.net_shares, w.win_idx
      LIMIT 3
    `);
    
    console.log(`\nManual calculation (sample):`);
    console.log(JSON.stringify(manual, null, 2));
  } catch (e: any) {
    console.error("Error in manual calc:", e.message?.substring(0, 200));
  }
}

main().catch(console.error);
