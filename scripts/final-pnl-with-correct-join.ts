#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`  Query error: ${e.message?.substring(0, 200)}`);
    return [];
  }
}

const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("FINAL P&L CALCULATION - PROPER JOIN WITH NORMALIZATION");
  console.log("════════════════════════════════════════════════════════════════\n");

  // DEBUG: Verify we can match at least ONE trade to a resolved market
  console.log("🔍 DEBUG: Check if ANY trades match ANY resolved markets\n");
  try {
    const debug = await queryData(`
      SELECT
        lower(t.wallet_address) as wallet,
        count() as matches,
        countDistinct(lower(replaceAll(t.condition_id, '0x', ''))) as unique_conditions_in_match
      FROM trades_raw t
      INNER JOIN winning_index w
        ON lower(replaceAll(t.condition_id, '0x', '')) = w.condition_id_norm
      WHERE lower(t.wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
    `);

    if (debug.length > 0) {
      for (const row of debug) {
        console.log(`  ${row.wallet.substring(0, 12)}...`);
        console.log(`    Matches found: ${row.matches}`);
        console.log(`    Unique resolved conditions: ${row.unique_conditions_in_match}\n`);
      }
    } else {
      console.log("  ❌ NO MATCHES FOUND\n");
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  // If we found matches, compute the P&L
  console.log("💰 REALIZED P&L (Using normalized join):\n");
  try {
    const pnl = await queryData(`
      SELECT
        lower(t.wallet_address) as wallet,
        count(DISTINCT t.trade_id) as num_trades,
        round(sum(
          -- SETTLEMENT: $1 per share on winning outcome
          CASE
            WHEN t.outcome_index = w.win_idx THEN t.shares
            WHEN t.outcome_index != w.win_idx THEN 0
            ELSE 0
          END
        ), 2) AS settlement_usd,
        round(sum(
          -- SIGNED CASHFLOWS: BUY=-cost, SELL=+proceeds
          CASE
            WHEN t.side = 1 THEN -t.entry_price * t.shares
            WHEN t.side = 2 THEN t.entry_price * t.shares
            ELSE 0
          END
        ), 2) AS cashflow_usd,
        round(sum(
          -- FEES: Always negative
          COALESCE(t.fee_usd, 0) + COALESCE(t.slippage_usd, 0)
        ), 2) AS fees_usd
      FROM trades_raw t
      INNER JOIN winning_index w
        ON lower(replaceAll(t.condition_id, '0x', '')) = w.condition_id_norm
      WHERE lower(t.wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of pnl) {
      const settlement = parseFloat(row.settlement_usd || 0);
      const cashflow = parseFloat(row.cashflow_usd || 0);
      const fees = parseFloat(row.fees_usd || 0);
      const net = settlement + cashflow - fees;
      const expected = row.wallet === wallet1 ? 89975.16 : 102001.46;
      const variance = ((net - expected) / expected * 100).toFixed(2);

      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Trades in resolved markets: ${row.num_trades}`);
      console.log(`    Settlement:  $${row.settlement_usd}`);
      console.log(`    Cashflow:    $${row.cashflow_usd}`);
      console.log(`    Fees:        $${row.fees_usd}`);
      console.log(`    ---`);
      console.log(`    Realized PnL: $${net.toFixed(2)}`);
      console.log(`    Expected:     $${expected.toFixed(2)}`);
      console.log(`    Variance:     ${variance}%`);
      console.log(`    Status:       ${Math.abs(parseFloat(variance)) <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 200)}\n`);
  }

  // If no matches from winning_index, try market_resolutions_final instead
  console.log("\n🔄 FALLBACK: Try market_resolutions_final instead of winning_index\n");
  try {
    const fallback = await queryData(`
      SELECT
        lower(t.wallet_address) as wallet,
        count(DISTINCT t.trade_id) as num_trades,
        round(sum(
          CASE
            -- Try matching against winning_index field
            WHEN t.outcome_index = mr.winning_index THEN t.shares
            WHEN t.outcome_index != mr.winning_index THEN 0
            ELSE 0
          END
        ), 2) AS settlement_usd,
        round(sum(
          CASE
            WHEN t.side = 1 THEN -t.entry_price * t.shares
            WHEN t.side = 2 THEN t.entry_price * t.shares
            ELSE 0
          END
        ), 2) AS cashflow_usd,
        round(sum(
          COALESCE(t.fee_usd, 0) + COALESCE(t.slippage_usd, 0)
        ), 2) AS fees_usd
      FROM trades_raw t
      INNER JOIN market_resolutions_final mr
        ON lower(replaceAll(t.condition_id, '0x', '')) = mr.condition_id_norm
      WHERE lower(t.wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    if (fallback.length > 0) {
      for (const row of fallback) {
        const settlement = parseFloat(row.settlement_usd || 0);
        const cashflow = parseFloat(row.cashflow_usd || 0);
        const fees = parseFloat(row.fees_usd || 0);
        const net = settlement + cashflow - fees;
        const expected = row.wallet === wallet1 ? 89975.16 : 102001.46;
        const variance = ((net - expected) / expected * 100).toFixed(2);

        console.log(`  ${row.wallet.substring(0, 12)}...`);
        console.log(`    Trades in resolved markets: ${row.num_trades}`);
        console.log(`    Settlement:  $${row.settlement_usd}`);
        console.log(`    Cashflow:    $${row.cashflow_usd}`);
        console.log(`    Fees:        $${row.fees_usd}`);
        console.log(`    ---`);
        console.log(`    Realized PnL: $${net.toFixed(2)}`);
        console.log(`    Expected:     $${expected.toFixed(2)}`);
        console.log(`    Variance:     ${variance}%`);
        console.log(`    Status:       ${Math.abs(parseFloat(variance)) <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
      }
    } else {
      console.log("  ❌ NO MATCHES with market_resolutions_final either\n");
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 200)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
