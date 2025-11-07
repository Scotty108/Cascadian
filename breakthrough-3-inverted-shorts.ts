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
  console.log("BREAKTHROUGH #3: TEST INVERTED FORMULA FOR SHORT POSITIONS");
  console.log("════════════════════════════════════════════════════════════════\n");

  console.log("HYPOTHESIS: For SHORT positions, formula should be inverted\n");

  // Test current formula on shorts vs longs separately
  console.log("1. CURRENT FORMULA: cashflows - net_shares (by position type)");
  console.log("─".repeat(70));

  let result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx FROM winning_index
    )
    SELECT 
      p.wallet,
      CASE WHEN p.net_shares > 0 THEN 'LONG' ELSE 'SHORT' END as position_type,
      count() as position_count,
      round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) AS pnl_current
    FROM outcome_positions_v2 AS p
    ANY LEFT JOIN trade_cashflows_v3 AS c 
      ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win AS w 
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE w.win_idx IS NOT NULL AND p.wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY p.wallet, position_type
    ORDER BY p.wallet, position_type
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const type = r[1];
      const count = r[2];
      const pnl = parseFloat(r[3]).toFixed(2);
      console.log(`  ${w}... | ${type.padEnd(5)} | ${count.toString().padStart(3)} positions | P&L = $${pnl}`);
    }
  }
  console.log("");

  // Test inverted formula
  console.log("2. INVERTED FORMULA: net_shares - cashflows (for shorts only)");
  console.log("─".repeat(70));

  result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx FROM winning_index
    )
    SELECT 
      p.wallet,
      round(
        sum(CASE 
          WHEN p.net_shares > 0 THEN toFloat64(c.cashflow_usdc) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx)
          ELSE sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) - toFloat64(c.cashflow_usdc)
        END),
        2
      ) AS pnl_inverted_for_shorts
    FROM outcome_positions_v2 AS p
    ANY LEFT JOIN trade_cashflows_v3 AS c 
      ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win AS w 
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE w.win_idx IS NOT NULL AND p.wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY p.wallet
    ORDER BY p.wallet
  `);

  if (result && result.length > 0) {
    console.log(`  Wallet | P&L (inverted for shorts)`);
    console.log(`  ${"─".repeat(45)}`);
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const pnl = parseFloat(r[1]).toFixed(2);
      console.log(`  ${w}... | $${pnl}`);
    }
  }
  console.log("");

  // Add unrealized to test
  console.log("3. INVERTED + UNREALIZED");
  console.log("─".repeat(70));

  result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx FROM winning_index
    ),
    realized_inverted AS (
      SELECT 
        p.wallet,
        round(
          sum(CASE 
            WHEN p.net_shares > 0 THEN toFloat64(c.cashflow_usdc) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx)
            ELSE sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) - toFloat64(c.cashflow_usdc)
          END),
          2
        ) AS realized
      FROM outcome_positions_v2 AS p
      ANY LEFT JOIN trade_cashflows_v3 AS c 
        ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
      ANY LEFT JOIN win AS w 
        ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
      WHERE w.win_idx IS NOT NULL
      GROUP BY p.wallet
    )
    SELECT 
      r.wallet,
      r.realized,
      u.unrealized_pnl_usd,
      round(r.realized + u.unrealized_pnl_usd, 2) as total
    FROM realized_inverted r
    LEFT JOIN wallet_unrealized_pnl_v2 u ON r.wallet = u.wallet
    WHERE r.wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    ORDER BY r.wallet
  `);

  if (result && result.length > 0) {
    console.log(`  Wallet | Realized | Unrealized | Total`);
    console.log(`  ${"─".repeat(55)}`);
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const realized = parseFloat(r[1]).toFixed(2);
      const unrealized = parseFloat(r[2]).toFixed(2);
      const total = parseFloat(r[3]).toFixed(2);
      console.log(`  ${w}... | $${realized.padStart(10)} | $${unrealized.padStart(10)} | $${total}`);
    }
  }
  console.log("");

  console.log("4. VARIANCE WITH INVERTED FORMULA");
  console.log("─".repeat(70));
  console.log(`  HolyMoses7: UI target = $89,975.16`);
  console.log(`  niggemon:   UI target = $102,001.46\n`);

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
