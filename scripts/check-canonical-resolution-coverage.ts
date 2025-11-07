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
    console.error(`  Query error: ${e.message?.substring(0, 150)}`);
    return [];
  }
}

const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("CHECK: How many positions are ACTUALLY resolved in canonical tables?");
  console.log("════════════════════════════════════════════════════════════════\n");

  // CHECK 1: How many markets/conditions are resolved?
  console.log("1️⃣  RESOLUTION TABLE COVERAGE\n");

  try {
    const coverage = await queryData(`
      SELECT
        (SELECT count(DISTINCT condition_id) FROM winning_index) as conditions_with_winners,
        (SELECT count(DISTINCT market_id) FROM trades_raw WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')) as target_markets_traded,
        (SELECT count(DISTINCT condition_id) FROM trades_raw WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')) as target_conditions_traded
    `);

    const data = coverage[0];
    console.log(`  Conditions with winners (in winning_index): ${data.conditions_with_winners}`);
    console.log(`  Markets target wallets traded:              ${data.target_markets_traded}`);
    console.log(`  Conditions target wallets traded:           ${data.target_conditions_traded}\n`);
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // CHECK 2: Overlap between wallet trades and resolved conditions
  console.log("2️⃣  OVERLAP: Trades in RESOLVED conditions\n");

  try {
    const overlap = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        count(DISTINCT condition_id) as conditions_traded_in,
        countIf(w.condition_id IS NOT NULL) as conditions_with_resolution_data
      FROM trades_raw t
      LEFT JOIN winning_index w ON t.condition_id = w.condition_id
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of overlap) {
      const pct = (parseInt(row.conditions_with_resolution_data) / parseInt(row.conditions_traded_in) * 100).toFixed(1);
      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Conditions traded:           ${row.conditions_traded_in}`);
      console.log(`    With resolution data:        ${row.conditions_with_resolution_data} (${pct}%)\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // CHECK 3: Sample the winning_index to see structure
  console.log("3️⃣  SAMPLE: What does winning_index contain?\n");

  try {
    const sample = await queryData(`
      SELECT
        condition_id,
        win_idx,
        resolved_at
      FROM winning_index
      LIMIT 5
    `);

    console.log(JSON.stringify(sample, null, 2));
    console.log();
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // CHECK 4: Can we compute realized P&L using winning_index?
  console.log("4️⃣  REALIZED P&L WITH WINNING_INDEX\n");

  try {
    const pnl = await queryData(`
      SELECT
        lower(t.wallet_address) as wallet,
        count(DISTINCT t.trade_id) as num_trades,
        round(sum(
          CASE
            -- Check if we're on the winning side
            WHEN t.outcome_index = w.win_idx THEN
              CASE
                WHEN t.side = 1 THEN t.shares  -- Long on winner: +shares
                WHEN t.side = 2 THEN -t.shares -- Short on winner: -shares (gets payout)
                ELSE 0
              END
            -- Losing side
            WHEN t.outcome_index != w.win_idx THEN
              CASE
                WHEN t.side = 1 THEN -t.shares -- Long on loser: -shares (loses it all)
                WHEN t.side = 2 THEN t.shares  -- Short on loser: +shares (keeps payout)
                ELSE 0
              END
            ELSE 0
          END
        ), 2) AS settlement_usd
      FROM trades_raw t
      INNER JOIN winning_index w ON t.condition_id = w.condition_id
      WHERE lower(t.wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of pnl) {
      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Trades with winners:  ${row.num_trades}`);
      console.log(`    Settlement value:     $${row.settlement_usd}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // CHECK 5: Add signed cashflows
  console.log("5️⃣  FULL REALIZED P&L: Settlement + Cashflows\n");

  try {
    const fullPnl = await queryData(`
      SELECT
        lower(t.wallet_address) as wallet,
        count(DISTINCT t.trade_id) as num_trades,
        round(sum(
          CASE
            WHEN t.outcome_index = w.win_idx THEN
              CASE
                WHEN t.side = 1 THEN t.shares
                WHEN t.side = 2 THEN -t.shares
                ELSE 0
              END
            WHEN t.outcome_index != w.win_idx THEN
              CASE
                WHEN t.side = 1 THEN -t.shares
                WHEN t.side = 2 THEN t.shares
                ELSE 0
              END
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
          COALESCE(t.fee_usd, 0) +
          COALESCE(t.slippage_usd, 0)
        ), 2) AS fees_usd
      FROM trades_raw t
      INNER JOIN winning_index w ON t.condition_id = w.condition_id
      WHERE lower(t.wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of fullPnl) {
      const expected = row.wallet === wallet1 ? 89975.16 : 102001.46;
      const calculated = parseFloat(row.settlement_usd || 0) + parseFloat(row.cashflow_usd || 0) - parseFloat(row.fees_usd || 0);
      const variance = ((calculated - expected) / expected * 100).toFixed(2);

      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Trades in resolved conditions:  ${row.num_trades}`);
      console.log(`    Settlement:                     $${row.settlement_usd}`);
      console.log(`    Cashflow:                       $${row.cashflow_usd}`);
      console.log(`    Fees:                           $${row.fees_usd}`);
      console.log(`    ---`);
      console.log(`    Realized P&L Net:               $${calculated.toFixed(2)}`);
      console.log(`    Expected:                       $${expected.toFixed(2)}`);
      console.log(`    Variance:                       ${variance}%`);
      console.log(`    Status:                         ${Math.abs(parseFloat(variance)) <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
