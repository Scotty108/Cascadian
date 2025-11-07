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
  console.log("BREAKTHROUGH #1: ENRICHED TABLE DIRECT QUERY");
  console.log("Source: trades_enriched_with_condition (has fees + realized_pnl_usd)");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Query resolved trades with realized_pnl_usd directly
  console.log("QUERY: Sum realized_pnl_usd for resolved trades (is_resolved=1)");
  console.log("Filters: snapshot ≤ 2025-10-31 23:59:59");
  console.log("─".repeat(70));

  let result = await queryData(`
    SELECT 
      wallet_address,
      count() as trade_count,
      countIf(is_resolved = 1) as resolved_count,
      sum(toFloat64(realized_pnl_usd)) as total_realized_pnl_raw,
      round(sum(toFloat64(realized_pnl_usd)), 2) as total_realized_pnl
    FROM trades_enriched_with_condition
    WHERE wallet_address IN (lower('${wallet1}'), lower('${wallet2}'))
      AND created_at <= toDateTime('2025-10-31 23:59:59')
    GROUP BY wallet_address
    ORDER BY wallet_address
  `);

  if (result && result.length > 0) {
    console.log(`\n  Wallet       | Trades | Resolved | Total Realized P&L`);
    console.log(`  ${"─".repeat(65)}`);
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const trades = r[1];
      const resolved = r[2];
      const pnl = parseFloat(r[4]).toFixed(2);
      console.log(`  ${w}... | ${trades} | ${resolved} | $${pnl}`);
    }
  }
  console.log("");

  // Now test with resolved-only filter
  console.log("REFINED: Only trades where is_resolved=1");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT 
      wallet_address,
      count() as trade_count,
      round(sum(toFloat64(realized_pnl_usd)), 2) as total_realized_pnl
    FROM trades_enriched_with_condition
    WHERE wallet_address IN (lower('${wallet1}'), lower('${wallet2}'))
      AND created_at <= toDateTime('2025-10-31 23:59:59')
      AND is_resolved = 1
    GROUP BY wallet_address
    ORDER BY wallet_address
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const trades = r[1];
      const pnl = parseFloat(r[2]).toFixed(2);
      console.log(`  ${w}... : ${trades} trades | P&L = $${pnl}`);
    }
  } else {
    console.log("  (no resolved trades found)");
  }
  console.log("");

  // Show UI targets for comparison
  console.log("COMPARISON TO UI TARGETS");
  console.log("─".repeat(70));
  console.log(`  HolyMoses7:  $89,975.16`);
  console.log(`  niggemon:    $102,001.46\n`);

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
