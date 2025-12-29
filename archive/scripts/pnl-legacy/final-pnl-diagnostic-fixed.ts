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
  console.log("FINAL P&L DIAGNOSTIC - CORRECTED DEDUP + SETTLEMENT");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  // STEP 1: Dedup verification
  console.log("📊 STEP 1: Dedup Verification\n");
  try {
    const dedup = await queryData(`
      SELECT
        count() as total_rows,
        count(DISTINCT (transaction_hash, lower(wallet_address))) as uniq_fills
      FROM trades_dedup_mat
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
    `);
    const data = dedup[0];
    console.log(`  For two wallets:`);
    console.log(`    Total rows: ${data.total_rows}`);
    console.log(`    Unique fills: ${data.uniq_fills}`);
    console.log(`    Status: ${data.total_rows === data.uniq_fills ? '✅ PASS (no dupes)' : '⚠️  Duplicates exist'}\n`);
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 100)}\n`);
  }

  // STEP 2: Positions
  console.log("📈 STEP 2: Position Summary\n");
  try {
    const positions = await queryData(`
      SELECT
        wallet,
        count() as position_count,
        sum(abs(net_shares)) as total_shares
      FROM outcome_positions_v2
      WHERE wallet IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);
    for (const row of positions) {
      console.log(`  ${row.wallet.substring(0, 10)}...`);
      console.log(`    Positions: ${row.position_count}`);
      console.log(`    Total shares: ${row.total_shares}\n`);
    }
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 100)}\n`);
  }

  // STEP 3: Check condition resolution coverage
  console.log("🎯 STEP 3: Condition Resolution Coverage\n");
  try {
    const coverage = await queryData(`
      SELECT
        p.wallet,
        count(DISTINCT p.condition_id_norm) as traded_conditions,
        count(DISTINCT w.condition_id_norm) as resolved_conditions
      FROM outcome_positions_v2 p
      LEFT JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      WHERE p.wallet IN ('${wallet1}', '${wallet2}')
      GROUP BY p.wallet
      ORDER BY p.wallet
    `);
    for (const row of coverage) {
      const pct = (parseInt(row.resolved_conditions) / parseInt(row.traded_conditions) * 100).toFixed(1);
      console.log(`  ${row.wallet.substring(0, 10)}...`);
      console.log(`    Traded conditions: ${row.traded_conditions}`);
      console.log(`    Resolved conditions: ${row.resolved_conditions} (${pct}%)\n`);
    }
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 100)}\n`);
  }

  // STEP 4: Realized PnL (only for RESOLVED conditions)
  console.log("💰 STEP 4: Realized P&L (RESOLVED positions only)\n");
  try {
    const pnl = await queryData(`
      SELECT
        p.wallet,
        round(sum(
          if(p.outcome_idx = w.win_idx, greatest(p.net_shares, 0), 0) +
          if(p.outcome_idx != w.win_idx, greatest(-p.net_shares, 0), 0)
        ), 4) AS settlement_usd,
        round(sum(c.cashflow_usdc), 4) AS cashflow_total
      FROM outcome_positions_v2 p
      INNER JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      LEFT JOIN trade_cashflows_v3 c
        ON p.wallet = c.wallet
        AND p.market_id = c.market_id
        AND p.condition_id_norm = c.condition_id_norm
        AND p.outcome_idx = c.outcome_idx
      WHERE p.wallet IN ('${wallet1}', '${wallet2}')
      GROUP BY p.wallet
      ORDER BY p.wallet
    `);

    for (const row of pnl) {
      const realized_pnl = (parseFloat(row.settlement_usd) + parseFloat(row.cashflow_total)).toFixed(2);
      console.log(`  ${row.wallet.substring(0, 10)}...`);
      console.log(`    Settlement:   $${row.settlement_usd}`);
      console.log(`    Cashflow:     $${row.cashflow_total}`);
      console.log(`    Realized PnL: $${realized_pnl}\n`);
    }
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 200)}\n`);
  }

  // STEP 5: Unrealized PnL (for UNRESOLVED positions)
  console.log("📊 STEP 5: Unrealized P&L (UNRESOLVED positions)\n");
  try {
    const unrealized = await queryData(`
      SELECT
        p.wallet,
        round(sum(p.net_shares), 4) AS open_shares,
        round(sum(c.cashflow_usdc), 4) AS trading_costs
      FROM outcome_positions_v2 p
      LEFT JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      LEFT JOIN trade_cashflows_v3 c
        ON p.wallet = c.wallet
        AND p.market_id = c.market_id
        AND p.condition_id_norm = c.condition_id_norm
        AND p.outcome_idx = c.outcome_idx
      WHERE p.wallet IN ('${wallet1}', '${wallet2}')
        AND w.condition_id_norm IS NULL
      GROUP BY p.wallet
      ORDER BY p.wallet
    `);

    for (const row of unrealized) {
      console.log(`  ${row.wallet.substring(0, 10)}...`);
      console.log(`    Open shares:  ${row.open_shares}`);
      console.log(`    Trading costs: $${row.trading_costs}\n`);
    }
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 200)}\n`);
  }

  // STEP 6: Total P&L (REALIZED + UNREALIZED)
  console.log("🎯 STEP 6: TOTAL P&L (Realized + Unrealized)\n");
  try {
    const total = await queryData(`
      SELECT
        p.wallet AS wallet,
        round(sum(
          if(w.condition_id_norm IS NOT NULL,
            if(p.outcome_idx = w.win_idx, greatest(p.net_shares, 0), 0) +
            if(p.outcome_idx != w.win_idx, greatest(-p.net_shares, 0), 0),
            0
          )
        ), 4) AS realized_settlement,
        round(sum(c.cashflow_usdc), 4) AS total_cashflow
      FROM outcome_positions_v2 p
      LEFT JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      LEFT JOIN trade_cashflows_v3 c
        ON p.wallet = c.wallet
        AND p.market_id = c.market_id
        AND p.condition_id_norm = c.condition_id_norm
        AND p.outcome_idx = c.outcome_idx
      WHERE p.wallet IN ('${wallet1}', '${wallet2}')
      GROUP BY p.wallet
      ORDER BY p.wallet
    `);

    for (const row of total) {
      const wallet = row.wallet || row['p.wallet'];
      const settlement = parseFloat(row.realized_settlement || 0);
      const cashflow = parseFloat(row.total_cashflow || 0);
      const total_pnl = (settlement + cashflow).toFixed(2);
      const expected = wallet === wallet1 ? 89975.16 : 102001.46;
      const calculated = parseFloat(total_pnl);
      const variance = Math.abs(calculated - expected) / expected * 100;
      console.log(`  ${wallet.substring(0, 10)}...`);
      console.log(`    Realized settlement: $${settlement.toFixed(4)}`);
      console.log(`    Total cashflow:      $${cashflow.toFixed(4)}`);
      console.log(`    TOTAL P&L:           $${total_pnl}`);
      console.log(`    Expected:            $${expected}`);
      console.log(`    Variance:            ${variance.toFixed(2)}%`);
      console.log(`    Status:              ${variance <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 200)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════");
}

main().catch(console.error);
