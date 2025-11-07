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
  const wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'; // niggemon

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("INVESTIGATION: Why is niggemon showing only $117 instead of $102k?");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Check schema of trades_enriched to see what columns exist
  console.log("STEP 1: Check trades_enriched table schema");
  console.log("─".repeat(70));
  const schema = await queryData(`
    SELECT name, type FROM system.columns
    WHERE table = 'trades_enriched' AND database = 'default'
    ORDER BY position
  `);

  if (schema && schema.length > 0) {
    for (const [col, type] of schema) {
      console.log(`  ${col}: ${type}`);
    }
  }
  console.log("");

  // Check if realized_pnl_usd is calculated or stored
  console.log("STEP 2: Sample trades for niggemon - check P&L fields");
  console.log("─".repeat(70));
  const samples = await queryData(`
    SELECT
      tx_hash,
      timestamp,
      side,
      amount,
      price_usd,
      total_cost_usd,
      is_resolved,
      resolved_timestamp,
      realized_pnl_usd
    FROM trades_enriched
    WHERE wallet_address = lower('${wallet}')
    LIMIT 5
  `);

  if (samples && samples.length > 0) {
    for (const row of samples) {
      console.log(`  tx: ${row[0].substring(0, 12)}...`);
      console.log(`    timestamp: ${row[1]}`);
      console.log(`    side: ${row[2]} | amount: ${row[3]} | price: $${row[4]}`);
      console.log(`    resolved: ${row[6]} | resolved_ts: ${row[7]}`);
      console.log(`    realized_pnl: $${row[8]}`);
    }
  }
  console.log("");

  // Compare resolved vs unresolved trades and their P&L contribution
  console.log("STEP 3: P&L breakdown - resolved vs unresolved");
  console.log("─".repeat(70));
  const breakdown = await queryData(`
    SELECT
      is_resolved,
      count() as trade_count,
      sum(toFloat64(realized_pnl_usd)) as total_pnl,
      avg(toFloat64(realized_pnl_usd)) as avg_pnl
    FROM trades_enriched
    WHERE wallet_address = lower('${wallet}')
    GROUP BY is_resolved
  `);

  if (breakdown && breakdown.length > 0) {
    for (const row of breakdown) {
      const resolved = row[0] === '1' ? 'RESOLVED' : 'UNRESOLVED';
      console.log(`  ${resolved}: ${row[1]} trades | Total: $${parseFloat(row[2] || '0').toFixed(2)} | Avg: $${parseFloat(row[3] || '0').toFixed(2)}`);
    }
  }
  console.log("");

  // Check if the issue is that unresolved trades are being excluded from calculations
  console.log("STEP 4: Check unrealized P&L fields (if they exist)");
  console.log("─".repeat(70));
  const unrealized = await queryData(`
    SELECT COUNT(*) as row_count FROM trades_enriched
    WHERE wallet_address = lower('${wallet}')
      AND is_resolved = 0
  `);

  if (unrealized && unrealized.length > 0) {
    console.log(`  Unresolved trades in this wallet: ${unrealized[0][0]}`);
    console.log(`  These are likely open positions that should contribute to unrealized P&L`);
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("HYPOTHESIS: realized_pnl_usd only calculated for resolved trades.");
  console.log("Unresolved trades (open positions) not included in P&L sums.");
  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
