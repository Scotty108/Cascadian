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
  const snapshot = '2025-10-31 23:59:59';

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("PROBE A: SNAPSHOT DRIFT ANALYSIS");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Check max timestamps in source tables
  console.log("1. MAX TIMESTAMPS IN SOURCE TABLES");
  console.log("─".repeat(70));

  let result = await queryData(`
    SELECT 
      'outcome_positions_v2' as table_name,
      wallet,
      max(trade_timestamp) as max_timestamp,
      countIf(trade_timestamp <= toDateTime('${snapshot}')) as before_snapshot,
      count() as total,
      round(countIf(trade_timestamp <= toDateTime('${snapshot}')) * 100.0 / count(), 2) as pct_before
    FROM outcome_positions_v2
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY wallet
    UNION ALL
    SELECT 
      'trade_cashflows_v3',
      wallet,
      max(trade_timestamp) as max_timestamp,
      countIf(trade_timestamp <= toDateTime('${snapshot}')) as before_snapshot,
      count() as total,
      round(countIf(trade_timestamp <= toDateTime('${snapshot}')) * 100.0 / count(), 2) as pct_before
    FROM trade_cashflows_v3
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY wallet
    ORDER BY table_name, wallet
  `);

  if (result && result.length > 0) {
    console.log(`  Table                 | Wallet      | Max Timestamp       | Before Snapshot | %`);
    console.log(`  ${"─".repeat(75)}`);
    for (const r of result) {
      const t = r[0];
      const w = r[1].substring(0, 10);
      const ts = r[2]?.toString().substring(0, 19) || "NULL";
      const before = r[3];
      const total = r[4];
      const pct = r[5];
      console.log(`  ${t.padEnd(20)} | ${w}... | ${ts} | ${before}/${total} | ${pct}%`);
    }
  }
  console.log("");

  // Compute realized PnL WITHOUT timestamp filter
  console.log("2. REALIZED P&L WITHOUT SNAPSHOT FILTER");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT 
      wallet,
      realized_pnl_usd
    FROM wallet_realized_pnl_final
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    ORDER BY wallet
  `);

  if (result && result.length > 0) {
    console.log(`  Wallet      | P&L (No Filter)`);
    console.log(`  ${"─".repeat(40)}`);
    for (const r of result) {
      const w = r[0].substring(0, 10);
      const pnl = parseFloat(r[1]).toFixed(2);
      console.log(`  ${w}... | $${pnl}`);
    }
  }
  console.log("");

  // Compute realized PnL WITH strict snapshot filter
  console.log("3. REALIZED P&L WITH STRICT SNAPSHOT FILTER (≤ 2025-10-31 23:59:59)");
  console.log("─".repeat(70));

  result = await queryData(`
    WITH win AS (
      SELECT 
        condition_id_norm, 
        toInt16(win_idx) AS win_idx, 
        resolved_at 
      FROM default.winning_index
    ),
    positions_filtered AS (
      SELECT *
      FROM outcome_positions_v2
      WHERE trade_timestamp <= toDateTime('${snapshot}')
    ),
    cashflows_filtered AS (
      SELECT *
      FROM trade_cashflows_v3
      WHERE trade_timestamp <= toDateTime('${snapshot}')
    )
    SELECT 
      p.wallet,
      round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) AS realized_pnl_usd_filtered
    FROM positions_filtered AS p
    ANY LEFT JOIN cashflows_filtered AS c 
      ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win AS w 
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE w.win_idx IS NOT NULL AND p.wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY p.wallet
    ORDER BY p.wallet
  `);

  if (result && result.length > 0) {
    console.log(`  Wallet      | P&L (With Filter)`);
    console.log(`  ${"─".repeat(40)}`);
    for (const r of result) {
      const w = r[0].substring(0, 10);
      const pnl = parseFloat(r[1]).toFixed(2);
      console.log(`  ${w}... | $${pnl}`);
    }
  }
  console.log("");

  // Report delta
  console.log("4. VARIANCE DELTA ANALYSIS");
  console.log("─".repeat(70));

  const ui_targets = {
    [wallet1.toLowerCase()]: 89975.16,
    [wallet2.toLowerCase()]: 102001.46
  };

  console.log(`  HolyMoses7 (0xa4b366...):  UI target = $${ui_targets[wallet1.toLowerCase()].toFixed(2)}`);
  console.log(`  niggemon (0xeb6f0a...):    UI target = $${ui_targets[wallet2.toLowerCase()].toFixed(2)}\n`);

  console.log("  CONCLUSION:");
  console.log("  If variance reduces by >10% with snapshot filter, ROOT CAUSE = snapshot drift");
  console.log("  Otherwise, drift is not the primary blocker.\n");

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
