#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 600000,
});

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("DIAGNOSTIC PROTOCOL - STEP 6 (A, B, C)");
  console.log("================================================================════\n");

  const wallet_holy = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet_niggemon = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  // STEP 6A: Sample one market for HolyMoses7 to see the settlement
  try {
    console.log("📋 STEP 6A: Sample Market Settlement for HolyMoses7\n");
    console.log("Querying first market for detailed settlement breakdown...\n");

    const sampleMarket = await queryData(`
      SELECT
        wallet,
        market_id,
        condition_id_norm,
        resolved_at,
        sum(total_cashflow) as total_cashflow,
        sum(winning_shares) as total_winning_shares,
        round(total_cashflow + total_winning_shares, 8) as realized_pnl
      FROM (
        SELECT
          tf.wallet,
          tf.market_id,
          cc.condition_id_norm,
          wi.resolved_at,
          tf.cashflow_usdc AS total_cashflow,
          if(coalesce(tf.trade_idx, multiIf(upperUTF8(tf.outcome_raw)='YES', 1, upperUTF8(tf.outcome_raw)='NO', 0, NULL)) = wi.win_idx,
             tf.delta_shares,
             0) AS winning_shares,
          wi.win_idx
        FROM trade_flows_v2 tf
        JOIN canonical_condition cc ON cc.market_id = tf.market_id
        LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
        WHERE tf.wallet = '${wallet_holy}'
          AND wi.win_idx IS NOT NULL
      )
      GROUP BY wallet, market_id, condition_id_norm, resolved_at
      LIMIT 5
    `);

    if (sampleMarket.length > 0) {
      console.log("Sample Markets:");
      sampleMarket.forEach((row: any, idx: number) => {
        console.log(`\n  Market ${idx + 1}:`);
        console.log(`    Market ID:       ${row.market_id.substring(0, 16)}...`);
        console.log(`    Condition ID:    ${row.condition_id_norm.substring(0, 16)}...`);
        console.log(`    Resolved At:     ${row.resolved_at}`);
        console.log(`    Cashflows:       $${row.total_cashflow}`);
        console.log(`    Winning Shares:  $${row.total_winning_shares}`);
        console.log(`    Settlement:      $${row.realized_pnl}`);
      });
      console.log("\n");
    } else {
      console.log("  No markets found for HolyMoses7\n");
    }
  } catch (e: any) {
    console.error(`  ❌ Step 6A failed: ${e.message?.substring(0, 200)}\n`);
  }

  // STEP 6B: Check if unrealized_pnl calculation is corrupting the total
  try {
    console.log("🔍 STEP 6B: Analyze Unrealized P&L Contribution\n");

    const unrealizedBreakdown = await queryData(`
      SELECT
        wallet,
        round(sum(unrealized_pnl_usd), 2) AS total_unrealized,
        count() AS open_positions
      FROM portfolio_mtm_detailed
      WHERE wallet IN ('${wallet_holy}', '${wallet_niggemon}')
      GROUP BY wallet
    `);

    if (unrealizedBreakdown.length > 0) {
      unrealizedBreakdown.forEach((row: any) => {
        const walletName = row.wallet.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
        console.log(`  ${walletName}:`);
        console.log(`    Total Unrealized P&L: $${row.total_unrealized}`);
        console.log(`    Open Positions:       ${row.open_positions}`);
        console.log();
      });
    }

    // Also check realized P&L from the new view
    console.log("  Realized P&L Breakdown:");
    const realizedBreakdown = await queryData(`
      SELECT
        wallet,
        round(sum(realized_pnl_usd), 2) AS total_realized
      FROM realized_pnl_by_market_final
      WHERE wallet IN ('${wallet_holy}', '${wallet_niggemon}')
      GROUP BY wallet
    `);

    if (realizedBreakdown.length > 0) {
      realizedBreakdown.forEach((row: any) => {
        const walletName = row.wallet.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
        console.log(`    ${walletName}: $${row.total_realized}`);
      });
    }
    console.log("\n");
  } catch (e: any) {
    console.error(`  ❌ Step 6B failed: ${e.message?.substring(0, 200)}\n`);
  }

  // STEP 6C: Manual market audit - verify settlement logic
  try {
    console.log("🔎 STEP 6C: Manual Market Audit - Verify Settlement Logic\n");

    // Get one resolved market with explicit breakdown
    const auditQuery = await queryData(`
      SELECT
        wallet,
        market_id,
        condition_id_norm,
        resolved_at,
        win_idx,
        countDistinct(trade_idx) as num_unique_outcomes_traded,
        sum(total_cashflow) as total_cost_basis,
        sum(winning_shares) as payout_on_winning,
        round(sum(total_cashflow) + sum(winning_shares), 8) as manual_settlement
      FROM (
        SELECT
          tf.wallet,
          tf.market_id,
          cc.condition_id_norm,
          wi.resolved_at,
          wi.win_idx,
          coalesce(tf.trade_idx, multiIf(upperUTF8(tf.outcome_raw)='YES', 1, upperUTF8(tf.outcome_raw)='NO', 0, NULL)) as trade_idx,
          tf.cashflow_usdc AS total_cashflow,
          if(coalesce(tf.trade_idx, multiIf(upperUTF8(tf.outcome_raw)='YES', 1, upperUTF8(tf.outcome_raw)='NO', 0, NULL)) = wi.win_idx,
             tf.delta_shares,
             0) AS winning_shares
        FROM trade_flows_v2 tf
        JOIN canonical_condition cc ON cc.market_id = tf.market_id
        LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
        WHERE tf.wallet = '${wallet_holy}'
          AND wi.win_idx IS NOT NULL
      )
      GROUP BY wallet, market_id, condition_id_norm, resolved_at, win_idx
      ORDER BY resolved_at DESC
      LIMIT 3
    `);

    if (auditQuery.length > 0) {
      console.log("Market Audit Sample (HolyMoses7):\n");
      auditQuery.forEach((row: any, idx: number) => {
        console.log(`  Market ${idx + 1}:`);
        console.log(`    ID:                  ${row.market_id.substring(0, 20)}...`);
        console.log(`    Winning Index:       ${row.win_idx}`);
        console.log(`    Outcomes Traded:     ${row.num_unique_outcomes_traded}`);
        console.log(`    Cost Basis (CF):     $${row.total_cost_basis}`);
        console.log(`    Payout (Winning):    $${row.payout_on_winning}`);
        console.log(`    Manual Settlement:   $${row.manual_settlement}`);
        console.log();
      });
    }
    console.log("\n");
  } catch (e: any) {
    console.error(`  ❌ Step 6C failed: ${e.message?.substring(0, 200)}\n`);
  }

  // SUMMARY
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("\n📊 DIAGNOSTIC SUMMARY\n");
  console.log("Expected vs Actual P&L:");
  console.log("  HolyMoses7:  Expected $90,804 → Actual $62,318 (Variance: -31%)");
  console.log("  niggemon:    Expected $102,001 → Actual $55,471 (Variance: -45%)");
  console.log("\n⚠️  BOTH WALLETS SHOW NEGATIVE VARIANCE (ACTUAL < EXPECTED)");
  console.log("    This suggests either:");
  console.log("    1. Missing trades in the data");
  console.log("    2. Incorrect settlement calculation");
  console.log("    3. Unrealized P&L calculation pulling down totals");
  console.log("    4. Data in trades_raw is incomplete or wrong\n");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
