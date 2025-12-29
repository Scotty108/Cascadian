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
  console.log("ANALYZING EXPECTED P&L COMPOSITION");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Expected values
  const expected = {
    [wallet1]: 89975.16,
    [wallet2]: 102001.46
  };

  // CHECK 1: Total gross cashflow from ALL trades
  console.log("1️⃣  GROSS CASHFLOWS (all trades, regardless of resolution status):\n");

  try {
    const cashflows = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        round(sum(
          CASE
            WHEN side = 1 THEN -entry_price * shares
            WHEN side = 2 THEN entry_price * shares
            ELSE 0
          END
        ), 2) AS gross_cashflow
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of cashflows) {
      const expected_val = expected[row.wallet];
      const ratio = Math.abs(parseFloat(row.gross_cashflow || 0)) / expected_val;
      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Gross cashflow: $${row.gross_cashflow}`);
      console.log(`    Expected:       $${expected_val.toFixed(2)}`);
      console.log(`    Ratio to expected: ${ratio.toFixed(2)}x\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  // CHECK 2: Net P&L using realized_pnl_usd column (if it's populated)
  console.log("2️⃣  CHECK: realized_pnl_usd column from trades_raw:\n");

  try {
    const realized = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        round(sum(realized_pnl_usd), 2) AS total_realized_pnl,
        countIf(realized_pnl_usd != 0) as non_zero_pnl_trades,
        count() as total_trades
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of realized) {
      const pct_with_pnl = (parseFloat(row.non_zero_pnl_trades) / parseFloat(row.total_trades) * 100).toFixed(1);
      const expected_val = expected[row.wallet];
      const variance = ((parseFloat(row.total_realized_pnl) - expected_val) / expected_val * 100).toFixed(2);

      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Sum of realized_pnl_usd:  $${row.total_realized_pnl}`);
      console.log(`    Trades with non-zero PnL: ${row.non_zero_pnl_trades} / ${row.total_trades} (${pct_with_pnl}%)`);
      console.log(`    Expected:                  $${expected_val.toFixed(2)}`);
      console.log(`    Variance:                  ${variance}%`);
      console.log(`    Status:                    ${Math.abs(parseFloat(variance)) <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  // CHECK 3: ALL trades + ALL unrealized = net cashflows
  console.log("3️⃣  HYPOTHESIS: Expected = ALL cashflows (resolved + unresolved):\n");

  try {
    const hypothesis = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        round(sum(
          CASE
            WHEN side = 1 THEN -entry_price * shares
            WHEN side = 2 THEN entry_price * shares
            ELSE 0
          END
        ), 2) AS total_cashflow,
        round(sum(COALESCE(fee_usd, 0) + COALESCE(slippage_usd, 0)), 2) AS total_fees
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of hypothesis) {
      const expected_val = expected[row.wallet];
      const calculated = parseFloat(row.total_cashflow) - parseFloat(row.total_fees);
      const variance = ((calculated - expected_val) / expected_val * 100).toFixed(2);

      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Total cashflows:    $${row.total_cashflow}`);
      console.log(`    Total fees:         $${row.total_fees}`);
      console.log(`    Net (CF - Fees):    $${calculated.toFixed(2)}`);
      console.log(`    Expected:           $${expected_val.toFixed(2)}`);
      console.log(`    Variance:           ${variance}%`);
      console.log(`    Status:             ${Math.abs(parseFloat(variance)) <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  // CHECK 4: Maybe it's just the sum of realized_pnl_usd that matches?
  console.log("4️⃣  ALTERNATIVE: Using realized_pnl_usd column directly (if already calculated):\n");

  try {
    const direct = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        round(sum(realized_pnl_usd), 2) AS realized_pnl_sum,
        min(realized_pnl_usd) as min_pnl,
        max(realized_pnl_usd) as max_pnl
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
        AND realized_pnl_usd != 0
      GROUP BY wallet
      ORDER BY wallet
    `);

    if (direct.length > 0) {
      for (const row of direct) {
        const expected_val = expected[row.wallet];
        const variance = ((parseFloat(row.realized_pnl_sum) - expected_val) / expected_val * 100).toFixed(2);

        console.log(`  ${row.wallet.substring(0, 12)}...`);
        console.log(`    Sum of realized_pnl_usd: $${row.realized_pnl_sum}`);
        console.log(`    Min PnL on trade:        $${row.min_pnl}`);
        console.log(`    Max PnL on trade:        $${row.max_pnl}`);
        console.log(`    Expected:                $${expected_val.toFixed(2)}`);
        console.log(`    Variance:                ${variance}%`);
        console.log(`    Status:                  ${Math.abs(parseFloat(variance)) <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
      }
    } else {
      console.log("  No trades with non-zero realized_pnl_usd\n");
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
