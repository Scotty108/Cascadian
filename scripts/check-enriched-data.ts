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
  console.log("ENRICHED TABLES: REALIZED P&L TOTALS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const tables = [
    'trades_enriched_with_condition',
    'trades_with_recovered_cid',
    'trades_enriched',
    'trades_dedup'
  ];

  for (const table of tables) {
    console.log(`TABLE: ${table}`);
    console.log("─".repeat(70));

    const result = await queryData(`
      SELECT 
        wallet_address,
        count() as trade_count,
        sum(toFloat64(realized_pnl_usd)) as total_pnl,
        countIf(is_resolved = 1) as resolved_trades,
        min(timestamp) as earliest,
        max(timestamp) as latest
      FROM ${table}
      WHERE wallet_address IN (lower('${wallet1}'), lower('${wallet2}'))
      GROUP BY wallet_address
      ORDER BY wallet_address
    `);

    if (result && result.length > 0) {
      for (const r of result) {
        const w = r[0].substring(0, 12);
        const count = r[1];
        const pnl = parseFloat(r[2] || '0').toFixed(2);
        const resolved = r[3];
        console.log(`  ${w}... : ${count} trades (${resolved} resolved) | Total P&L: $${pnl}`);
      }
    } else {
      console.log("  (no data)");
    }
    console.log("");
  }

  console.log("UI TARGETS FOR COMPARISON");
  console.log("─".repeat(70));
  console.log(`  HolyMoses7:  $89,975.16`);
  console.log(`  niggemon:    $102,001.46\n`);

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
