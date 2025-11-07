#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 45000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSONCompact' });
    const text = await result.text();
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return null;
  }
}

async function main() {
  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("DIAGNOSIS: Formula Sign Inversion");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Check sample data from outcome_positions_v2
  console.log("PROBE A: outcome_positions_v2 data (first wallet's first market)");
  console.log("─".repeat(70));

  let results = await queryData(`
    SELECT 
      wallet,
      market_id,
      condition_id_norm,
      outcome_idx,
      net_shares,
      count() as position_count
    FROM outcome_positions_v2
    WHERE wallet = lower('${wallet1}')
    GROUP BY wallet, market_id, condition_id_norm, outcome_idx, net_shares
    ORDER BY market_id, outcome_idx
    LIMIT 5
  `);

  if (results && results.length > 0) {
    console.log(`  Sample positions for wallet:`);
    for (const r of results) {
      console.log(`    Market: ${r[1]?.substring(0, 16)}... | Cond: ${r[2]?.substring(0, 12)}... | Outcome: ${r[3]} | Net Shares: ${r[4]}`);
    }
  }
  console.log("");

  // Check trade_cashflows_v3 sample
  console.log("PROBE B: trade_cashflows_v3 sample data");
  console.log("─".repeat(70));

  results = await queryData(`
    SELECT 
      wallet,
      market_id,
      condition_id_norm,
      cashflow_usdc,
      count() as flows
    FROM trade_cashflows_v3
    WHERE wallet = lower('${wallet1}')
    GROUP BY wallet, market_id, condition_id_norm, cashflow_usdc
    LIMIT 5
  `);

  if (results && results.length > 0) {
    console.log(`  Sample cashflows for wallet:`);
    for (const r of results) {
      console.log(`    Cashflow: $${parseFloat(r[3]).toFixed(2)}`);
    }
  }
  console.log("");

  // Check current formula output
  console.log("PROBE C: Current realized_pnl_by_market_final output");
  console.log("─".repeat(70));

  results = await queryData(`
    SELECT 
      wallet,
      market_id,
      realized_pnl_usd
    FROM realized_pnl_by_market_final
    WHERE wallet = lower('${wallet1}')
    LIMIT 5
  `);

  if (results && results.length > 0) {
    console.log(`  Sample P&L values:`);
    for (const r of results) {
      console.log(`    Market: ${r[1]?.substring(0, 20)}... | P&L: $${parseFloat(r[2]).toFixed(2)}`);
    }
  }
  console.log("");

  // Check inverted formula output
  console.log("PROBE D: Test INVERTED formula (swap signs)");
  console.log("─".repeat(70));

  results = await queryData(`
    WITH win AS (
      SELECT 
        condition_id_norm, 
        toInt16(win_idx) AS win_idx, 
        resolved_at 
      FROM default.winning_index
    )
    SELECT 
      p.wallet AS wallet,
      p.market_id AS market_id,
      round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 4) AS inverted_pnl_usd
    FROM default.outcome_positions_v2 AS p
    ANY LEFT JOIN default.trade_cashflows_v3 AS c 
      ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win AS w 
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE w.win_idx IS NOT NULL AND p.wallet = lower('${wallet1}')
    GROUP BY p.wallet, p.market_id
    LIMIT 5
  `);

  if (results && results.length > 0) {
    console.log(`  Inverted formula test (cashflows - net_shares):`);
    for (const r of results) {
      console.log(`    Market: ${r[1]?.substring(0, 20)}... | Inverted P&L: $${parseFloat(r[2]).toFixed(2)}`);
    }
    console.log(`\n  ℹ️  If inverted values are positive and match expected range, formula needs to be swapped.`);
  }
  console.log("");

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
