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
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TESTING FORMULA VARIANTS");
  console.log("════════════════════════════════════════════════════════════════\n");

  console.log("VARIANT A: Current formula (cashflows - net_shares)");
  console.log("─".repeat(70));
  
  let result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx FROM winning_index
    )
    SELECT 
      p.wallet,
      round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) AS pnl
    FROM outcome_positions_v2 p
    ANY LEFT JOIN trade_cashflows_v3 c ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win w ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE w.win_idx IS NOT NULL AND p.wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY p.wallet
    ORDER BY p.wallet
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      console.log(`  ${r[0].substring(0, 12)}... : $${parseFloat(r[1]).toFixed(2)}`);
    }
  }
  console.log("");

  console.log("VARIANT B: Just sum cashflows (ignore net_shares)");
  console.log("─".repeat(70));
  
  result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx FROM winning_index
    )
    SELECT 
      p.wallet,
      round(sum(toFloat64(c.cashflow_usdc)), 2) AS pnl
    FROM outcome_positions_v2 p
    ANY LEFT JOIN trade_cashflows_v3 c ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win w ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE w.win_idx IS NOT NULL AND p.wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY p.wallet
    ORDER BY p.wallet
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      console.log(`  ${r[0].substring(0, 12)}... : $${parseFloat(r[1]).toFixed(2)}`);
    }
  }
  console.log("");

  console.log("VARIANT C: net_shares only (ignore cashflows)");
  console.log("─".repeat(70));
  
  result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx FROM winning_index
    )
    SELECT 
      p.wallet,
      round(sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) AS pnl
    FROM outcome_positions_v2 p
    ANY LEFT JOIN win w ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE w.win_idx IS NOT NULL AND p.wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY p.wallet
    ORDER BY p.wallet
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      console.log(`  ${r[0].substring(0, 12)}... : $${parseFloat(r[1]).toFixed(2)}`);
    }
  }
  console.log("");

  console.log("UI TARGETS FOR REFERENCE");
  console.log("─".repeat(70));
  console.log(`  HolyMoses7:  $89,975.16`);
  console.log(`  niggemon:    $102,001.46`);
  console.log("");

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
