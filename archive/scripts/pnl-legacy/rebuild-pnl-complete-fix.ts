#!/usr/bin/env npx tsx

/**
 * COMPLETE P&L FIX - Bug #4 Resolution
 *
 * Fixes TWO critical bugs in P&L views:
 * 1. Missing ÷1e6 conversion (clob_fills uses micro-shares)
 * 2. Hardcoded outcome_idx = 0 (should use ctf_token_map)
 *
 * Rebuilds entire P&L pipeline from scratch with correct formulas.
 */

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
    console.error(`❌ ${name}: ${e.message?.substring(0, 250)}`);
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
  console.log("P&L BUG #4 - COMPLETE FIX");
  console.log("Rebuilding all P&L views and tables with correct scaling + outcome_idx");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // STEP 1: Drop existing materialized tables
  console.log("Step 1: Dropping existing P&L tables...\n");

  const tablesToDrop = [
    'wallet_pnl_summary_final',
    'wallet_realized_pnl_final',
    'realized_pnl_by_market_final'
  ];

  for (const table of tablesToDrop) {
    await executeQuery(`Drop ${table}`, `DROP TABLE IF EXISTS ${table}`);
  }

  // STEP 2: Recreate views with fixes
  console.log("\nStep 2: Creating fixed views...\n");

  // FIX #1: trade_cashflows_v3 with ÷1e6 and correct outcome_idx
  const createCashflowsV3 = `CREATE OR REPLACE VIEW trade_cashflows_v3 AS
SELECT
  lower(cf.proxy_wallet) AS wallet,
  lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
  ctm.outcome_index AS outcome_idx,
  cf.price AS px,
  cf.size / 1000000.0 AS sh,
  round(
    (cf.price * (cf.size / 1000000.0)) * if(cf.side = 'BUY', -1, 1),
    8
  ) AS cashflow_usdc
FROM clob_fills AS cf
INNER JOIN ctf_token_map AS ctm
  ON cf.asset_id = ctm.token_id
WHERE cf.condition_id IS NOT NULL
  AND cf.condition_id != ''
  AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'`;

  // FIX #2: outcome_positions_v2 with ÷1e6 and correct outcome_idx
  const createOutcomePositionsV2 = `CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  wallet,
  condition_id_norm,
  outcome_idx,
  sum(net_shares) AS net_shares
FROM (
  SELECT
    lower(cf.proxy_wallet) AS wallet,
    lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
    ctm.outcome_index AS outcome_idx,
    if(cf.side = 'BUY', 1., -1.) * (cf.size / 1000000.0) AS net_shares
  FROM clob_fills AS cf
  INNER JOIN ctf_token_map AS ctm
    ON cf.asset_id = ctm.token_id
  WHERE cf.condition_id IS NOT NULL
    AND cf.condition_id != ''
    AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
)
GROUP BY wallet, condition_id_norm, outcome_idx
HAVING abs(net_shares) > 0.0001`;

  if (!await executeQuery("FIX #1: trade_cashflows_v3", createCashflowsV3)) {
    process.exit(1);
  }

  if (!await executeQuery("FIX #2: outcome_positions_v2", createOutcomePositionsV2)) {
    process.exit(1);
  }

  // STEP 3: Create realized_pnl_by_market_final as VIEW first
  console.log("\nStep 3: Creating realized_pnl_by_market_final view...\n");

  const createView = `CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
WITH cashflows_agg AS (
  SELECT
    wallet,
    condition_id_norm,
    outcome_idx,
    sum(cashflow_usdc) AS total_cashflow
  FROM trade_cashflows_v3
  GROUP BY wallet, condition_id_norm, outcome_idx
)
SELECT
  p.wallet AS wallet,
  p.condition_id_norm AS condition_id_norm,
  wi.resolved_at AS resolved_at,
  round(
    COALESCE(cf.total_cashflow, 0.0) + sumIf(p.net_shares, p.outcome_idx = wi.win_idx),
    4
  ) AS realized_pnl_usd
FROM outcome_positions_v2 AS p
LEFT JOIN winning_index AS wi
  ON wi.condition_id_norm = p.condition_id_norm
LEFT JOIN cashflows_agg AS cf
  ON cf.wallet = p.wallet
  AND cf.condition_id_norm = p.condition_id_norm
  AND cf.outcome_idx = p.outcome_idx
WHERE wi.win_idx IS NOT NULL
GROUP BY wallet, condition_id_norm, resolved_at, cf.total_cashflow`;

  if (!await executeQuery("Create realized_pnl_by_market_final view", createView)) {
    process.exit(1);
  }

  // STEP 4: Create wallet_realized_pnl_final view
  console.log("\nStep 4: Creating wallet_realized_pnl_final view...\n");

  const createWalletRealized = `CREATE OR REPLACE VIEW wallet_realized_pnl_final AS
SELECT
  wallet,
  round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
FROM realized_pnl_by_market_final
GROUP BY wallet`;

  if (!await executeQuery("Create wallet_realized_pnl_final", createWalletRealized)) {
    process.exit(1);
  }

  // STEP 5: Create wallet_pnl_summary_final view
  console.log("\nStep 5: Creating wallet_pnl_summary_final view...\n");

  const createWalletSummary = `CREATE OR REPLACE VIEW wallet_pnl_summary_final AS
SELECT
  coalesce(r.wallet, u.wallet) AS wallet,
  coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
  coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
  round(coalesce(r.realized_pnl_usd, 0) + coalesce(u.unrealized_pnl_usd, 0), 2) AS total_pnl_usd
FROM wallet_realized_pnl_final AS r
FULL OUTER JOIN wallet_unrealized_pnl_v2 AS u USING (wallet)`;

  if (!await executeQuery("Create wallet_pnl_summary_final", createWalletSummary)) {
    process.exit(1);
  }

  // STEP 6: Validation
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("VALIDATION");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  try {
    // Check sample cashflows (should be in single-digit USD)
    console.log("✅ Sample Cashflows (should be ~$14-105 USD):\n");
    const sampleCF = await queryData(`
      SELECT px, sh, cashflow_usdc
      FROM trade_cashflows_v3
      WHERE wallet = lower('${testWallet}')
      LIMIT 5
    `);
    console.table(sampleCF);

    // Check sample positions (should be in thousands of shares)
    console.log("\n✅ Sample Positions (should be ~1,500-2,500 shares):\n");
    const samplePos = await queryData(`
      SELECT outcome_idx, net_shares
      FROM outcome_positions_v2
      WHERE wallet = lower('${testWallet}')
      LIMIT 5
    `);
    console.table(samplePos);

    // Check wallet summary
    console.log("\n✅ Wallet Summary:\n");
    const summary = await queryData(`
      SELECT *
      FROM wallet_pnl_summary_final
      WHERE lower(wallet) = lower('${testWallet}')
    `);

    if (summary.length > 0) {
      const w = summary[0];
      console.log(`┌────────────────────────────────────────────────────────────┐`);
      console.log(`│ Test Wallet: 0xcce2...d58b                                  │`);
      console.log(`└────────────────────────────────────────────────────────────┘`);
      console.log(`  Realized P&L:        $${w.realized_pnl_usd.toLocaleString()}`);
      console.log(`  Unrealized P&L:      $${w.unrealized_pnl_usd.toLocaleString()}`);
      console.log(`  ────────────────────────────────────────`);
      console.log(`  TOTAL P&L:           $${w.total_pnl_usd.toLocaleString()}`);
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

  } catch (e: any) {
    console.error(`Validation failed: ${e.message?.substring(0, 150)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("\n✅ P&L Pipeline Rebuild Complete!\n");
  console.log("Changes Applied:");
  console.log("  • trade_cashflows_v3: Added ÷1e6 + ctf_token_map for outcome_idx");
  console.log("  • outcome_positions_v2: Added ÷1e6 + ctf_token_map for outcome_idx");
  console.log("  • realized_pnl_by_market_final: Rebuilt with corrected upstream data");
  console.log("  • wallet_realized_pnl_final: Rebuilt");
  console.log("  • wallet_pnl_summary_final: Rebuilt");
  console.log("\nNext Steps:");
  console.log("  1. Run validation on all Dome baseline wallets");
  console.log("  2. Update reconciliation report");
  console.log("  3. Deploy to production");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
