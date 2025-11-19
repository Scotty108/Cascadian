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
  console.log("CHECKING ENRICHED TABLES WITH PRE-CALCULATED REALIZED P&L");
  console.log("════════════════════════════════════════════════════════════════\n");

  // trades_enriched_with_condition
  console.log("TABLE: trades_enriched_with_condition");
  console.log("─".repeat(70));

  let result = await queryData(`
    SELECT 
      wallet,
      count() as trade_count,
      sum(toFloat64(realized_pnl_usd)) as total_pnl,
      min(timestamp) as earliest,
      max(timestamp) as latest
    FROM trades_enriched_with_condition
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY wallet
    ORDER BY wallet
  `);

  if (result && result.length > 0) {
    console.log("Per-wallet results:");
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const count = r[1];
      const pnl = parseFloat(r[2] || '0').toFixed(2);
      console.log(`  ${w}... : ${count} trades | Total P&L: $${pnl}`);
    }
  } else {
    console.log("  (no data for target wallets)");
  }
  console.log("");

  // trades_with_recovered_cid
  console.log("TABLE: trades_with_recovered_cid");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT 
      wallet,
      count() as trade_count,
      sum(toFloat64(realized_pnl_usd)) as total_pnl,
      min(timestamp) as earliest,
      max(timestamp) as latest
    FROM trades_with_recovered_cid
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY wallet
    ORDER BY wallet
  `);

  if (result && result.length > 0) {
    console.log("Per-wallet results:");
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const count = r[1];
      const pnl = parseFloat(r[2] || '0').toFixed(2);
      console.log(`  ${w}... : ${count} trades | Total P&L: $${pnl}`);
    }
  } else {
    console.log("  (no data for target wallets)");
  }
  console.log("");

  // Check other raw trade tables
  console.log("TABLE: trades_enriched");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT 
      wallet,
      count() as trade_count,
      sum(toFloat64(realized_pnl_usd)) as total_pnl
    FROM trades_enriched
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY wallet
    ORDER BY wallet
  `);

  if (result && result.length > 0) {
    console.log("Per-wallet results:");
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const count = r[1];
      const pnl = parseFloat(r[2] || '0').toFixed(2);
      console.log(`  ${w}... : ${count} trades | Total P&L: $${pnl}`);
    }
  } else {
    console.log("  (no data for target wallets)");
  }
  console.log("");

  console.log("UI TARGETS FOR COMPARISON");
  console.log("─".repeat(70));
  console.log(`  HolyMoses7:  $89,975.16`);
  console.log(`  niggemon:    $102,001.46\n`);

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
