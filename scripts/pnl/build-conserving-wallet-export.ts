/**
 * Build PnL Export for Inventory-Conserving Wallets
 *
 * These are wallets where CLOB-only data is complete (no negative positions).
 * The V11_POLY/V20 formula works correctly for these wallets.
 *
 * Stats from analysis:
 * - Total wallets in V9 CLOB: 1,631,502
 * - Inventory-conserving: 1,376,686 (84.4%)
 * - Violating: 254,816 (15.6%)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

// Threshold: max negative token position allowed (-1000 tokens is ~$500 at 50c)
const MAX_NEGATIVE_THRESHOLD = -1000;

// Minimum activity requirements for leaderboard
const MIN_TRADES = 50;
const MIN_VOLUME = 1000; // $1000 USDC

async function main() {
  console.log('\n=== Build Inventory-Conserving Wallet Export ===\n');

  // Step 1: Create a CTE-based query that filters to conserving wallets and computes PnL
  console.log('Building export query for conserving wallets with V20-style PnL...\n');

  // Step 1: Get list of conserving wallets
  console.log('Step 1: Finding conserving wallets...');

  const conservingQuery = `
    SELECT wallet_address
    FROM (
      SELECT
        wallet_address,
        min(sum_tokens) as worst_position
      FROM (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(token_delta) as sum_tokens
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY wallet_address, condition_id, outcome_index
      )
      GROUP BY wallet_address
      HAVING worst_position >= ${MAX_NEGATIVE_THRESHOLD}
    )
  `;

  // Step 2: Compute PnL for these wallets using V20 formula
  const exportQuery = `
    SELECT
      wallet_address,
      round(sum(position_pnl), 2) as realized_pnl,
      round(sum(abs_cash_flow), 2) as volume,
      countDistinct(condition_id) as markets_traded,
      round(sum(unresolved_exposure), 2) as unresolved_tokens
    FROM (
      SELECT
        l.wallet_address,
        l.condition_id,
        l.outcome_index,
        sum(l.usdc_delta) as cash_flow,
        sum(abs(l.usdc_delta)) as abs_cash_flow,
        sum(l.token_delta) as final_tokens,
        r.resolved_price,
        -- V20 formula: realized = cash_flow + final_tokens * resolution_price
        if(r.resolved_price IS NOT NULL,
           sum(l.usdc_delta) + sum(l.token_delta) * r.resolved_price,
           0) as position_pnl,
        -- Unresolved tokens (for info)
        if(r.resolved_price IS NULL, abs(sum(l.token_delta)), 0) as unresolved_exposure
      FROM pm_unified_ledger_v9_clob_tbl l
      LEFT JOIN vw_pm_resolution_prices r
        ON l.condition_id = r.condition_id AND l.outcome_index = r.outcome_index
      WHERE l.source_type = 'CLOB'
        AND l.condition_id IS NOT NULL
        AND l.wallet_address IN (${conservingQuery})
      GROUP BY l.wallet_address, l.condition_id, l.outcome_index, r.resolved_price
    )
    GROUP BY wallet_address
    HAVING volume >= ${MIN_VOLUME} AND markets_traded >= 5
    ORDER BY realized_pnl DESC
    LIMIT 100
  `;

  console.log('Executing export query (top 100 by realized PnL)...\n');

  try {
    const result = await clickhouse.query({
      query: exportQuery,
      format: 'JSONEachRow',
      // Long timeout for this heavy query
      clickhouse_settings: {
        max_execution_time: 600,
      }
    });
    const rows = await result.json() as any[];

    console.log(`Found ${rows.length} qualifying wallets\n`);
    console.log('wallet | realized_pnl | volume | markets | unresolved');
    console.log('-'.repeat(90));

    for (const r of rows.slice(0, 30)) {
      const pnlStr = r.realized_pnl >= 0
        ? `+$${Number(r.realized_pnl).toLocaleString()}`
        : `-$${Math.abs(Number(r.realized_pnl)).toLocaleString()}`;
      console.log(
        `${r.wallet_address.slice(0, 10)}... | ${pnlStr.padStart(15)} | $${Number(r.volume).toLocaleString().padStart(12)} | ${r.markets_traded.toString().padStart(4)} | ${Number(r.unresolved_tokens).toLocaleString()}`
      );
    }

    // Summary stats
    console.log('\n=== Summary ===');
    const totalPnl = rows.reduce((acc, r) => acc + Number(r.realized_pnl), 0);
    const winners = rows.filter(r => Number(r.realized_pnl) > 0).length;
    const losers = rows.filter(r => Number(r.realized_pnl) < 0).length;
    console.log(`Total wallets: ${rows.length}`);
    console.log(`Winners: ${winners} (${(winners/rows.length*100).toFixed(1)}%)`);
    console.log(`Losers: ${losers} (${(losers/rows.length*100).toFixed(1)}%)`);
    console.log(`Aggregate PnL: $${totalPnl.toLocaleString()}`);

  } catch (e: any) {
    console.log(`ERROR: ${e.message?.slice(0, 500)}`);
    console.log('\nNote: This query may timeout. Consider breaking into steps.');
  }

  console.log('\n');
}

main().catch(console.error);
