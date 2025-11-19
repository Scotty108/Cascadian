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
  console.log("COVERAGE ANALYSIS: outcome_positions vs other sources");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Count outcomes in outcome_positions_v2
  console.log("1. outcome_positions_v2 counts:");
  console.log("─".repeat(70));
  
  let result = await queryData(`
    SELECT 
      wallet,
      count(DISTINCT market_id) as market_count,
      count(DISTINCT condition_id_norm) as condition_count,
      count() as position_count
    FROM outcome_positions_v2
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY wallet
    ORDER BY wallet
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      console.log(`  ${r[0].substring(0, 12)}... : ${r[3]} positions across ${r[1]} markets`);
    }
  }
  console.log("");

  // Count in realized_inputs_v1
  console.log("2. realized_inputs_v1 counts:");
  console.log("─".repeat(70));
  
  result = await queryData(`
    SELECT 
      wallet,
      count(DISTINCT market_id) as market_count,
      count(DISTINCT condition_id_norm) as condition_count,
      count() as position_count
    FROM realized_inputs_v1
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY wallet
    ORDER BY wallet
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      console.log(`  ${r[0].substring(0, 12)}... : ${r[3]} positions across ${r[1]} markets`);
    }
  }
  console.log("");

  // Try computing from realized_inputs_v1
  console.log("3. P&L from realized_inputs_v1:");
  console.log("─".repeat(70));
  
  result = await queryData(`
    SELECT 
      wallet,
      round(sum(toFloat64(cashflow_usd)) - sumIf(toFloat64(net_shares), idx = winning_outcome), 2) AS pnl
    FROM realized_inputs_v1
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY wallet
    ORDER BY wallet
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      console.log(`  ${r[0].substring(0, 12)}... : $${parseFloat(r[1]).toFixed(2)}`);
    }
  }
  console.log("");

  console.log("4. UI TARGETS:");
  console.log("─".repeat(70));
  console.log(`  HolyMoses7:  $89,975.16`);
  console.log(`  niggemon:    $102,001.46`);
  console.log("");

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
