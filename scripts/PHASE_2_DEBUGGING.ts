#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 60000,
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
  const lucasMeow = '0x7f3c8979d0afa00007bae4747d5347122af05613';
  const xcnstrategy = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("\n" + "═".repeat(80));
  console.log("PHASE 2 DEBUGGING: Why are LucasMeow & xcnstrategy returning $0.00?");
  console.log("═".repeat(80) + "\n");

  // Test 1: Do these wallets exist in outcome_positions_v2?
  console.log("TEST 1: Check if wallets exist in outcome_positions_v2");
  console.log("─".repeat(80));

  let result = await queryData(`
    SELECT
      wallet,
      count() as position_count,
      count(DISTINCT market_id) as markets
    FROM outcome_positions_v2
    WHERE wallet IN (lower('${lucasMeow}'), lower('${xcnstrategy}'))
    GROUP BY wallet
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      console.log(`  ${r[0].substring(0, 12)}... : ${r[1]} positions across ${r[2]} markets`);
    }
  } else {
    console.log(`  ❌ NO DATA FOUND - Wallets not in outcome_positions_v2!`);
  }
  console.log("");

  // Test 2: Do they exist in trade_cashflows_v3?
  console.log("TEST 2: Check if wallets exist in trade_cashflows_v3");
  console.log("─".repeat(80));

  result = await queryData(`
    SELECT
      wallet,
      count() as cashflow_count,
      sum(toFloat64(cashflow_usdc)) as total_cashflow
    FROM trade_cashflows_v3
    WHERE wallet IN (lower('${lucasMeow}'), lower('${xcnstrategy}'))
    GROUP BY wallet
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      console.log(`  ${r[0].substring(0, 12)}... : ${r[1]} cashflows | Total: $${parseFloat(r[2]).toFixed(2)}`);
    }
  } else {
    console.log(`  ❌ NO DATA FOUND - Wallets not in trade_cashflows_v3!`);
  }
  console.log("");

  // Test 3: Do they have any resolved positions in winning_index?
  console.log("TEST 3: Check if wallets have resolved positions (winning_index join)");
  console.log("─".repeat(80));

  result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index
    )
    SELECT
      p.wallet,
      count() as total_positions,
      countIf(w.win_idx IS NOT NULL) as resolved_positions
    FROM outcome_positions_v2 AS p
    LEFT JOIN win AS w
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE p.wallet IN (lower('${lucasMeow}'), lower('${xcnstrategy}'))
    GROUP BY p.wallet
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      const w = r[0];
      const total = r[1];
      const resolved = r[2];
      const pct = total > 0 ? ((resolved / total) * 100).toFixed(1) : '0';
      console.log(`  ${w.substring(0, 12)}... : ${total} total | ${resolved} resolved (${pct}%)`);
    }
  } else {
    console.log(`  ❌ NO DATA FOUND`);
  }
  console.log("");

  // Test 4: Run simplified realized P&L query (no joins)
  console.log("TEST 4: Simplified realized P&L (outcome_positions_v2 only)");
  console.log("─".repeat(80));

  result = await queryData(`
    SELECT
      wallet,
      count() as position_count,
      round(sum(toFloat64(net_shares)), 2) as total_net_shares
    FROM outcome_positions_v2
    WHERE wallet IN (lower('${lucasMeow}'), lower('${xcnstrategy}'))
    GROUP BY wallet
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      console.log(`  ${r[0].substring(0, 12)}... : ${r[1]} positions | Net shares: ${r[2]}`);
    }
  } else {
    console.log(`  ❌ NO DATA FOUND`);
  }
  console.log("");

  // Test 5: Try the full formula on LucasMeow only
  console.log("TEST 5: Full formula on LucasMeow (verbose debugging)");
  console.log("─".repeat(80));

  result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index
      LIMIT 10
    )
    SELECT
      count() as rows_processed,
      countIf(w.win_idx IS NOT NULL) as rows_with_winner,
      round(sum(toFloat64(c.cashflow_usdc)), 2) as total_cashflow,
      round(sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) as total_winning_shares
    FROM outcome_positions_v2 AS p
    ANY LEFT JOIN trade_cashflows_v3 AS c
      ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win AS w
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE p.wallet = lower('${lucasMeow}')
      AND w.win_idx IS NOT NULL
  `);

  if (result && result.length > 0) {
    const r = result[0];
    console.log(`  Rows processed: ${r[0]}`);
    console.log(`  Rows with winner match: ${r[1]}`);
    console.log(`  Total cashflow: $${r[2]}`);
    console.log(`  Total winning shares: ${r[3]}`);

    if (r[0] > 0 && r[1] === 0) {
      console.log(`  ⚠️ ISSUE FOUND: Positions exist but NO winner matches!`);
    }
  } else {
    console.log(`  ❌ NO DATA FOUND`);
  }
  console.log("");

  console.log("═".repeat(80));
  console.log("DEBUGGING COMPLETE");
  console.log("═".repeat(80) + "\n");
}

main().catch(console.error);
