#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function executeQuery(name: string, query: string) {
  try {
    console.log(`🔄 ${name}...`);
    await clickhouse.command({ query });
    console.log(`✅ ${name}`);
    return true;
  } catch (e: any) {
    console.error(`❌ ${name}: ${e.message?.substring(0, 200)}`);
    return false;
  }
}

async function queryData(query: string) {
  const result = await clickhouse.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("P&L BUG #4 - COMPLETE SCALING FIX");
  console.log("Fix: Add ÷1e6 conversions to all views");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // STEP 0: Ensure trades_dedup exists (prerequisite)
  const createTradesDedup = `CREATE OR REPLACE VIEW trades_dedup AS
SELECT *
FROM (
  SELECT
    *,
    row_number() OVER (PARTITION BY trade_id ORDER BY created_at DESC, tx_timestamp DESC) AS rn
  FROM trades_raw
  WHERE market_id NOT IN ('12')
)
WHERE rn = 1`;

  // FIX #1: trade_cashflows_v3 - Add ÷1e6 to shares
  const createCashflowsV3 = `CREATE OR REPLACE VIEW trade_cashflows_v3 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
  outcome_index AS outcome_idx,
  toFloat64(entry_price) AS px,
  toFloat64(shares) / 1000000.0 AS sh,
  round(
    toFloat64(entry_price) * (toFloat64(shares) / 1000000.0) *
    if(side = 'YES' OR side = 1, -1, 1),
    8
  ) AS cashflow_usdc
FROM trades_dedup
WHERE condition_id IS NOT NULL`;

  // FIX #2: outcome_positions_v2 - Add ÷1e6 to shares
  const createOutcomePositionsV2 = `CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  wallet,
  market_id,
  condition_id_norm,
  outcome_idx,
  sum(if(side = 'YES' OR side = 1, 1.0, -1.0) * sh) AS net_shares
FROM (
  SELECT
    lower(wallet_address) AS wallet,
    lower(market_id) AS market_id,
    lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
    outcome_index AS outcome_idx,
    side,
    toFloat64(shares) / 1000000.0 AS sh
  FROM trades_dedup
  WHERE condition_id IS NOT NULL
)
GROUP BY wallet, market_id, condition_id_norm, outcome_idx`;

  // FIX #3: realized_pnl_by_market_final - No changes needed (inherits correct units)
  const createRealizedPnLV3 = `CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
WITH pos_cf AS (
  SELECT
    p.wallet,
    p.market_id,
    p.condition_id_norm,
    p.outcome_idx,
    p.net_shares,
    sum(c.cashflow_usdc) AS total_cashflow
  FROM outcome_positions_v2 p
  ANY LEFT JOIN trade_cashflows_v3 c
    ON c.wallet = p.wallet
    AND c.market_id = p.market_id
    AND c.condition_id_norm = p.condition_id_norm
    AND c.outcome_idx = p.outcome_idx
  GROUP BY p.wallet, p.market_id, p.condition_id_norm, p.outcome_idx, p.net_shares
),
with_win AS (
  SELECT
    pos_cf.wallet,
    pos_cf.market_id,
    pos_cf.condition_id_norm,
    wi.resolved_at,
    wi.win_idx,
    pos_cf.outcome_idx,
    pos_cf.net_shares,
    pos_cf.total_cashflow
  FROM pos_cf
  ANY LEFT JOIN winning_index wi USING (condition_id_norm)
  WHERE wi.win_idx IS NOT NULL
)
SELECT
  wallet,
  market_id,
  condition_id_norm,
  resolved_at,
  round(
    sum(total_cashflow) + sumIf(net_shares, outcome_idx = win_idx),
    4
  ) AS realized_pnl_usd
FROM with_win
GROUP BY wallet, market_id, condition_id_norm, resolved_at`;

  // Summary views (unchanged)
  const createWalletRealizedV2 = `CREATE OR REPLACE VIEW wallet_realized_pnl_final AS
SELECT wallet, round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
FROM realized_pnl_by_market_final
GROUP BY wallet`;

  const createTotalSummaryFinal = `CREATE OR REPLACE VIEW wallet_pnl_summary_final AS
SELECT
  coalesce(r.wallet, u.wallet) AS wallet,
  coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
  coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
  round(coalesce(r.realized_pnl_usd, 0) + coalesce(u.unrealized_pnl_usd, 0), 2) AS total_pnl_usd
FROM wallet_realized_pnl_final r
FULL JOIN wallet_unrealized_pnl_v2 u USING (wallet)`;

  const views = [
    ["Deduplicate Trades", createTradesDedup],
    ["FIX #1: Trade Cashflows v3 (÷1e6)", createCashflowsV3],
    ["FIX #2: Outcome Positions v2 (÷1e6)", createOutcomePositionsV2],
    ["FIX #3: Realized PnL Final (corrected units)", createRealizedPnLV3],
    ["Wallet Realized PnL Final", createWalletRealizedV2],
    ["Wallet PnL Summary Final", createTotalSummaryFinal]
  ];

  let successCount = 0;
  for (const [name, query] of views) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`View Creation: ${successCount}/${views.length} successful\n`);

  // Validation: Test wallet
  try {
    console.log("✅ VALIDATION: Testing wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b\n");

    const testWallet = await queryData(`
      SELECT
        wallet,
        realized_pnl_usd,
        unrealized_pnl_usd,
        total_pnl_usd
      FROM wallet_pnl_summary_final
      WHERE lower(wallet) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
    `);

    if (testWallet.length > 0) {
      const w = testWallet[0];
      console.log(`┌────────────────────────────────────────────────────────────┐`);
      console.log(`│ Test Wallet: 0xcce2...d58b                                  │`);
      console.log(`└────────────────────────────────────────────────────────────┘`);
      console.log(`  Realized P&L:        $${w.realized_pnl_usd}`);
      console.log(`  Unrealized P&L:      $${w.unrealized_pnl_usd}`);
      console.log(`  ────────────────────────────────────────`);
      console.log(`  TOTAL P&L:           $${w.total_pnl_usd}`);
      console.log(`  Expected (Dome):     $87,030.51`);
      const variance = Math.abs(w.realized_pnl_usd - 87030.51) / 87030.51 * 100;
      console.log(`  Variance:            ${variance.toFixed(2)}%`);
      if (variance < 2) {
        console.log(`  ✅ <2% VARIANCE - SUCCESS!\n`);
      } else if (variance < 10) {
        console.log(`  ⚠️  Variance <10% - Close but needs refinement\n`);
      } else {
        console.log(`  ❌ Variance >10% - Further debugging needed\n`);
      }
    } else {
      console.log("⚠️ Wallet not found\n");
    }

    // Show sample cashflows to verify scaling
    console.log("📊 Sample Cashflows (should be in single-digit USD):\n");
    const sampleCF = await queryData(`
      SELECT px, sh, cashflow_usdc
      FROM trade_cashflows_v3
      WHERE wallet = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
      LIMIT 5
    `);
    console.table(sampleCF);

    // Show sample positions to verify net_shares
    console.log("\n📊 Sample Positions (net_shares should be in thousands):\n");
    const samplePos = await queryData(`
      SELECT outcome_idx, net_shares
      FROM outcome_positions_v2
      WHERE wallet = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
      LIMIT 5
    `);
    console.table(samplePos);

  } catch (e: any) {
    console.error(`Validation failed: ${e.message?.substring(0, 150)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("\n✅ P&L Scaling Fix Complete!\n");
  console.log("Changes Applied:");
  console.log("  • trade_cashflows_v3: Added ÷1e6 to shares in cashflow calculation");
  console.log("  • outcome_positions_v2: Added ÷1e6 to shares in net_shares calculation");
  console.log("  • realized_pnl_by_market_final: Inherits correct units from upstream views");
  console.log("\nNext: Run scripts/validate-corrected-pnl-comprehensive-fixed.ts on all Dome wallets");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
