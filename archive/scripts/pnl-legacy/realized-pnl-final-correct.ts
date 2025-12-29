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
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("REALIZED P&L: DEDUPED + RESOLVED + FEES");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  // STEP 1: Verify dedup correctness
  console.log("📊 STEP 1: Dedup Verification\n");
  try {
    const dedup = await queryData(`
      SELECT
        count() as total_rows,
        count(DISTINCT trade_id) as uniq_trades,
        count(DISTINCT (transaction_hash, lower(wallet_address))) as uniq_tx_wallet
      FROM trades_dedup_mat
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
    `);
    const data = dedup[0];
    console.log(`  For two wallets:`);
    console.log(`    Total rows: ${data.total_rows}`);
    console.log(`    Unique trades: ${data.uniq_trades}`);
    console.log(`    Unique (tx, wallet): ${data.uniq_tx_wallet}`);
    console.log(`    Status: ${data.total_rows === data.uniq_trades ? '✅ PASS' : '⚠️  Has dupes'}\n`);
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 100)}\n`);
  }

  // STEP 2: Resolved markets only
  console.log("🎯 STEP 2: Resolved Markets Count\n");
  try {
    const resolved = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        count(DISTINCT condition_id) as resolved_conditions,
        count(DISTINCT market_id) as resolved_markets
      FROM trades_dedup_mat
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
        AND is_resolved = 1
      GROUP BY wallet
    `);
    for (const row of resolved) {
      console.log(`  ${row.wallet.substring(0, 10)}...`);
      console.log(`    Resolved markets: ${row.resolved_markets}`);
      console.log(`    Resolved conditions: ${row.resolved_conditions}\n`);
    }
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 100)}\n`);
  }

  // STEP 3: Realized P&L (resolved only, with fees)
  console.log("💰 STEP 3: REALIZED P&L (Resolved + Fees Deducted)\n");
  try {
    const pnl = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        round(sum(
          -- Settlement: $1 per winning long + $1 per losing short
          if(is_resolved = 1 AND outcome_index IS NOT NULL,
            if(resolved_outcome = 'YES' AND side = 1, shares, 0) +
            if(resolved_outcome = 'NO' AND side = 2, shares, 0),
            0
          )
        ), 2) AS settlement_usd,
        round(sum(
          -- Signed cashflows: BUY=negative (cost), SELL=positive (proceeds)
          if(side = 1, -entry_price * shares, entry_price * shares)
        ), 2) AS cashflow_usd,
        round(sum(fee_usd + slippage_usd), 2) AS fees_and_slippage,
        round(settlement_usd + cashflow_usd - fees_and_slippage, 2) AS realized_pnl_net
      FROM trades_dedup_mat
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
        AND is_resolved = 1
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of pnl) {
      const expected = row.wallet === wallet1 ? 89975.16 : 102001.46;
      const calculated = parseFloat(row.realized_pnl_net);
      const variance = Math.abs(calculated - expected) / expected * 100;
      console.log(`  ${row.wallet.substring(0, 10)}...`);
      console.log(`    Settlement:        $${row.settlement_usd}`);
      console.log(`    Cashflows:         $${row.cashflow_usd}`);
      console.log(`    Fees + Slippage:   $${row.fees_and_slippage}`);
      console.log(`    Realized P&L Net:  $${row.realized_pnl_net}`);
      console.log(`    Expected:          $${expected}`);
      console.log(`    Variance:          ${variance.toFixed(2)}%`);
      console.log(`    Status:            ${variance <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 200)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════");
}

main().catch(console.error);
