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
  console.log("ROOT CAUSE ANALYSIS: Why is P&L 46-71% too low?");
  console.log("════════════════════════════════════════════════════════════════\n");

  // CHECK 1: What data do we actually have?
  console.log("1️⃣  DATA INVENTORY\n");

  try {
    const counts = await queryData(`
      SELECT
        (SELECT count() FROM trades_raw) as raw_total,
        (SELECT count() FROM trades_raw WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')) as raw_for_target_wallets,
        (SELECT count(DISTINCT trade_id) FROM trades_raw) as raw_unique_trades,
        (SELECT count(DISTINCT trade_id) FROM trades_raw WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')) as raw_unique_for_target
    `);
    const data = counts[0];
    console.log(`  trades_raw total rows:           ${data.raw_total}`);
    console.log(`  trades_raw for target wallets:   ${data.raw_for_target_wallets}`);
    console.log(`  trades_raw unique trade_ids:     ${data.raw_unique_trades}`);
    console.log(`  trades_raw unique for target:    ${data.raw_unique_for_target}\n`);
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // CHECK 2: Settlement amount without any fee deduction
  console.log("2️⃣  SETTLEMENT VERIFICATION (before fees)\n");

  try {
    const settlement = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        count(DISTINCT trade_id) as num_trades,
        round(sum(
          CASE
            -- Winning longs: get $1 per share
            WHEN outcome_index = 1 AND resolved_outcome = 'YES' THEN shares
            -- Winning shorts: get $1 per share
            WHEN outcome_index = 2 AND resolved_outcome = 'NO' THEN shares
            -- Losing position: get $0
            ELSE 0
          END
        ), 2) AS settlement_usd
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
        AND is_resolved = 1
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of settlement) {
      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Trades in resolved markets: ${row.num_trades}`);
      console.log(`    Settlement value:          $${row.settlement_usd}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // CHECK 3: Signed cashflows
  console.log("3️⃣  SIGNED CASHFLOWS VERIFICATION\n");

  try {
    const cashflows = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        round(sum(
          CASE
            WHEN side = 1 THEN -entry_price * shares  -- BUY: negative (spent money)
            WHEN side = 2 THEN entry_price * shares   -- SELL: positive (received money)
            ELSE 0
          END
        ), 2) AS signed_cashflow_usd
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of cashflows) {
      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Signed cashflows:          $${row.signed_cashflow_usd}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // CHECK 4: Fee deduction
  console.log("4️⃣  FEE AND SLIPPAGE DEDUCTION\n");

  try {
    const fees = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        round(sum(
          COALESCE(toFloat64(fee_usd), 0) +
          COALESCE(toFloat64(slippage_usd), 0)
        ), 2) AS total_fees
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of fees) {
      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Total fees + slippage:      $${row.total_fees}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // CHECK 5: Resolved status breakdown
  console.log("5️⃣  RESOLVED STATUS BREAKDOWN\n");

  try {
    const breakdown = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        countIf(is_resolved = 1) as resolved_count,
        countIf(is_resolved = 0) as unresolved_count,
        countIf(is_resolved IS NULL) as null_count,
        count() as total_count
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of breakdown) {
      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Resolved:        ${row.resolved_count}`);
      console.log(`    Unresolved:      ${row.unresolved_count}`);
      console.log(`    Null status:     ${row.null_count}`);
      console.log(`    Total:           ${row.total_count}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // CHECK 6: Manual calculation using basic components
  console.log("6️⃣  MANUAL REALIZED P&L CALCULATION (resolved only, all fees)\n");

  try {
    const manual = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        round(sum(
          CASE
            WHEN outcome_index = 1 AND resolved_outcome = 'YES' THEN shares
            WHEN outcome_index = 2 AND resolved_outcome = 'NO' THEN shares
            ELSE 0
          END
        ), 2) AS settlement,
        round(sum(
          CASE
            WHEN side = 1 THEN -entry_price * shares
            WHEN side = 2 THEN entry_price * shares
            ELSE 0
          END
        ), 2) AS cashflow,
        round(sum(
          COALESCE(toFloat64(fee_usd), 0) +
          COALESCE(toFloat64(slippage_usd), 0)
        ), 2) AS fees,
        round(
          sum(
            CASE
              WHEN outcome_index = 1 AND resolved_outcome = 'YES' THEN shares
              WHEN outcome_index = 2 AND resolved_outcome = 'NO' THEN shares
              ELSE 0
            END
          ) +
          sum(
            CASE
              WHEN side = 1 THEN -entry_price * shares
              WHEN side = 2 THEN entry_price * shares
              ELSE 0
            END
          ) -
          sum(
            COALESCE(toFloat64(fee_usd), 0) +
            COALESCE(toFloat64(slippage_usd), 0)
          ),
          2
        ) AS realized_pnl_net
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
        AND is_resolved = 1
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of manual) {
      const expected = row.wallet === wallet1 ? 89975.16 : 102001.46;
      const calculated = parseFloat(row.realized_pnl_net || 0);
      const variance = ((calculated - expected) / expected * 100).toFixed(2);

      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Settlement:     $${row.settlement}`);
      console.log(`    Cashflow:       $${row.cashflow}`);
      console.log(`    Fees:           $${row.fees}`);
      console.log(`    ---`);
      console.log(`    Calculated PnL: $${row.realized_pnl_net}`);
      console.log(`    Expected:       $${expected.toFixed(2)}`);
      console.log(`    Variance:       ${variance}%`);
      console.log(`    Status:         ${Math.abs(parseFloat(variance)) <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // CHECK 7: What if expected values are pre-fee?
  console.log("7️⃣  HYPOTHESIS: Expected values are PRE-FEE P&L?\n");

  try {
    const preFee = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        round(sum(
          CASE
            WHEN outcome_index = 1 AND resolved_outcome = 'YES' THEN shares
            WHEN outcome_index = 2 AND resolved_outcome = 'NO' THEN shares
            ELSE 0
          END
        ), 2) AS settlement,
        round(sum(
          CASE
            WHEN side = 1 THEN -entry_price * shares
            WHEN side = 2 THEN entry_price * shares
            ELSE 0
          END
        ), 2) AS cashflow,
        round(
          sum(
            CASE
              WHEN outcome_index = 1 AND resolved_outcome = 'YES' THEN shares
              WHEN outcome_index = 2 AND resolved_outcome = 'NO' THEN shares
              ELSE 0
            END
          ) +
          sum(
            CASE
              WHEN side = 1 THEN -entry_price * shares
              WHEN side = 2 THEN entry_price * shares
              ELSE 0
            END
          ),
          2
        ) AS pnl_pre_fee
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
        AND is_resolved = 1
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of preFee) {
      const expected = row.wallet === wallet1 ? 89975.16 : 102001.46;
      const calculated = parseFloat(row.pnl_pre_fee || 0);
      const variance = ((calculated - expected) / expected * 100).toFixed(2);

      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    PnL (before fees): $${row.pnl_pre_fee}`);
      console.log(`    Expected:          $${expected.toFixed(2)}`);
      console.log(`    Variance:          ${variance}%`);
      console.log(`    Status:            ${Math.abs(parseFloat(variance)) <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
