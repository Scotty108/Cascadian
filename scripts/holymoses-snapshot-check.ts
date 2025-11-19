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
  const snapshotDate = '2025-10-31 23:59:59';

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("HOLYMOSES7: SNAPSHOT-AWARE P&L CALCULATION");
  console.log(`════════════════════════════════════════════════════════════════`);
  console.log(`Snapshot Date: ${snapshotDate}\n`);

  // Check what's in outcome_positions_v2 at snapshot
  console.log("1. OUTCOME_POSITIONS_V2 (with timestamp filter)");
  console.log("─".repeat(70));

  let result = await queryData(`
    SELECT
      count() as total_positions,
      count(DISTINCT market_id) as markets,
      min(toDateTime(created_at)) as earliest_trade,
      max(toDateTime(created_at)) as latest_trade
    FROM outcome_positions_v2
    WHERE wallet = lower('${wallet1}')
      AND toDateTime(created_at) <= toDateTime('${snapshotDate}')
  `);

  if (result && result.length > 0) {
    const r = result[0];
    console.log(`  Positions at snapshot: ${r[0]}`);
    console.log(`  Markets: ${r[1]}`);
    console.log(`  Date range: ${r[2]} to ${r[3]}\n`);
  }

  // Check trade_cashflows_v3
  console.log("2. TRADE_CASHFLOWS_V3 (with timestamp filter)");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT
      count() as total_flows,
      count(DISTINCT market_id) as markets,
      min(toDateTime(created_at)) as earliest,
      max(toDateTime(created_at)) as latest
    FROM trade_cashflows_v3
    WHERE wallet = lower('${wallet1}')
      AND toDateTime(created_at) <= toDateTime('${snapshotDate}')
  `);

  if (result && result.length > 0) {
    const r = result[0];
    console.log(`  Cashflow records: ${r[0]}`);
    console.log(`  Markets: ${r[1]}`);
    console.log(`  Date range: ${r[2]} to ${r[3]}\n`);
  }

  // Calculate realized P&L with snapshot filter
  console.log("3. REALIZED P&L (with snapshot filter)");
  console.log("─".repeat(70));

  result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index
    )
    SELECT
      round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) AS realized_pnl_usd
    FROM outcome_positions_v2 AS p
    ANY LEFT JOIN trade_cashflows_v3 AS c
      ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win AS w
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE p.wallet = lower('${wallet1}')
      AND toDateTime(p.created_at) <= toDateTime('${snapshotDate}')
      AND w.win_idx IS NOT NULL
  `);

  let snapshotRealized = 0;
  if (result && result.length > 0) {
    snapshotRealized = parseFloat(result[0][0] || '0');
    console.log(`  Realized P&L (at snapshot): $${snapshotRealized.toFixed(2)}\n`);
  }

  // Get unrealized at snapshot
  console.log("4. UNREALIZED P&L (at snapshot)");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT
      round(unrealized_pnl_usd, 2) as unrealized
    FROM wallet_unrealized_pnl_v2
    WHERE wallet = lower('${wallet1}')
  `);

  let unrealized = 0;
  if (result && result.length > 0) {
    unrealized = parseFloat(result[0][0] || '0');
    console.log(`  Unrealized P&L: $${unrealized.toFixed(2)}\n`);
  }

  // Total at snapshot
  const totalAtSnapshot = snapshotRealized + unrealized;

  console.log("5. SUMMARY");
  console.log("─".repeat(70));
  console.log(`  Realized (snapshot): $${snapshotRealized.toFixed(2)}`);
  console.log(`  Unrealized: $${unrealized.toFixed(2)}`);
  console.log(`  Total (snapshot): $${totalAtSnapshot.toFixed(2)}\n`);

  console.log(`  UI Target: $89,975.16`);
  console.log(`  Gap: $${(89975.16 - totalAtSnapshot).toFixed(2)}`);
  console.log(`  Match? ${Math.abs(89975.16 - totalAtSnapshot) < 100 ? '✅ YES' : '❌ NO'}\n`);

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
