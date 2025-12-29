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

  // STEP 3: Realized PnL with corrected settlement formula
  console.log("🎯 STEP 3: Realized P&L (Winning Longs + Losing Shorts)\n");
  try {
    const pnl = await queryData(`
      SELECT
        p.wallet,
        round(sum(
          if(p.outcome_idx = w.win_idx, greatest(p.net_shares, 0), 0) +
          if(p.outcome_idx != w.win_idx, greatest(-p.net_shares, 0), 0)
        ), 4) AS settlement_usd,
        round(sum(c.cashflow_usdc), 4) AS cashflow_total,
        round(settlement_usd + cashflow_total, 2) AS realized_pnl_usd
      FROM outcome_positions_v2 p
      ANY LEFT JOIN trade_cashflows_v3 c USING (wallet, market_id, condition_id_norm, outcome_idx)
      ANY LEFT JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      WHERE w.win_idx IS NOT NULL
        AND p.wallet IN ('${wallet1}', '${wallet2}')
      GROUP BY p.wallet
      ORDER BY p.wallet
    `);
    
    for (const row of pnl) {
      const expected = row.wallet === wallet1 ? 89975.16 : 102001.46;
      const variance = Math.abs(row.realized_pnl_usd - expected) / expected * 100;
      console.log(`  ${row.wallet.substring(0, 10)}...`);
      console.log(`    Settlement: $${row.settlement_total}`);
      console.log(`    Cashflow:   $${row.cashflow_total}`);
      console.log(`    Realized:   $${row.realized_pnl_usd}`);
      console.log(`    Expected:   $${expected}`);
      console.log(`    Variance:   ${variance.toFixed(2)}%`);
      console.log(`    Status:     ${variance <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message?.substring(0, 200)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════");
}

main().catch(console.error);
