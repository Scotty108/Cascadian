#!/usr/bin/env npx tsx

/**
 * Comprehensive P&L Validation with All Three Fixes
 *
 * Tests ALL THREE bug fixes on baseline wallet 0xcce2b7c71f:
 * 1. ÷1e6 scaling for micro-units
 * 2. Decode outcome_idx from asset_id (include both YES and NO positions)
 * 3. Correct loser formula (no sign inversion)
 *
 * Expected result: <2% variance from Dome baseline ($87,030.51)
 *
 * Usage: npx tsx scripts/validate-corrected-pnl-comprehensive.ts [wallet_address]
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const BASELINE_WALLET = process.argv[2] || '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const EXPECTED_PNL = 87030.51; // From Dome API

async function main() {
  console.log('═'.repeat(80));
  console.log('COMPREHENSIVE P&L VALIDATION - ALL THREE FIXES');
  console.log('═'.repeat(80));
  console.log(`Wallet: ${BASELINE_WALLET}`);
  console.log(`Expected P&L (Dome): $${EXPECTED_PNL.toLocaleString()}`);
  console.log();
  console.log('Fixes applied:');
  console.log('  ✓ Bug #1: ÷1,000,000 for micro-unit conversion');
  console.log('  ✓ Bug #2: Decode outcome_idx from asset_id');
  console.log('  ✓ Bug #3: Correct loser formula (no sign inversion)');
  console.log();

  // CORRECTED P&L CALCULATION WITH ALL THREE FIXES
  // Using ctf_token_map to decode outcome indices
  const result = await clickhouse.query({
    query: `
      WITH positions_with_outcome AS (
        -- FIX #2: Decode outcome index via JOIN with ctf_token_map
        SELECT
          lower(cf.proxy_wallet) AS wallet,
          lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
          ctm.outcome_index AS outcome_idx,
          sum(if(cf.side = 'BUY', 1., -1.) * cf.size) AS net_shares
        FROM clob_fills AS cf
        INNER JOIN ctf_token_map AS ctm
          ON cf.asset_id = ctm.token_id
        WHERE cf.condition_id IS NOT NULL
          AND cf.condition_id != ''
          AND lower(cf.proxy_wallet) = lower('${BASELINE_WALLET}')
        GROUP BY wallet, condition_id_norm, outcome_idx
        HAVING abs(net_shares) > 0.0001
      ),

      cashflows_with_outcome AS (
        -- FIX #2: Also decode outcome index for cashflows
        SELECT
          lower(cf.proxy_wallet) AS wallet,
          lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
          ctm.outcome_index AS outcome_idx,
          SUM(round((cf.price * cf.size) * if(cf.side = 'BUY', -1, 1), 8)) AS total_cashflow_usd
        FROM clob_fills AS cf
        INNER JOIN ctf_token_map AS ctm
          ON cf.asset_id = ctm.token_id
        WHERE cf.condition_id IS NOT NULL
          AND cf.condition_id != ''
          AND lower(cf.proxy_wallet) = lower('${BASELINE_WALLET}')
        GROUP BY wallet, condition_id_norm, outcome_idx
      )

      SELECT
        op.wallet,
        op.condition_id_norm,
        op.outcome_idx,
        op.net_shares,
        gr.winning_outcome,
        COALESCE(cf_agg.total_cashflow_usd, 0.0) as cost_basis_micro,

        -- Determine if this position won or lost
        CASE
          WHEN (op.outcome_idx = 1 AND lower(gr.winning_outcome) = 'yes') OR
               (op.outcome_idx = 0 AND lower(gr.winning_outcome) = 'no') THEN
            'WIN'
          ELSE
            'LOSS'
        END AS result,

        -- FIX #1 + #3: Apply ÷1e6 conversion AND correct loser formula
        CASE
          WHEN gr.cid IS NOT NULL THEN
            CASE
              WHEN (op.outcome_idx = 1 AND lower(gr.winning_outcome) = 'yes') OR
                   (op.outcome_idx = 0 AND lower(gr.winning_outcome) = 'no') THEN
                -- Won: payout ($1/share) minus cost
                -- FIX #1: Divide by 1e6
                (op.net_shares + COALESCE(cf_agg.total_cashflow_usd, 0.0)) / 1000000.0
              ELSE
                -- Lost: just the cost (already negative for net buyers)
                -- FIX #1: Divide by 1e6
                -- FIX #3: NO -1 * multiplier
                COALESCE(cf_agg.total_cashflow_usd, 0.0) / 1000000.0
            END
          ELSE
            0.0  -- Unresolved markets
        END AS realized_pnl_usd

      FROM positions_with_outcome AS op

      LEFT JOIN gamma_resolved AS gr
        ON op.condition_id_norm = gr.cid

      LEFT JOIN cashflows_with_outcome AS cf_agg
        ON op.wallet = cf_agg.wallet
        AND op.condition_id_norm = cf_agg.condition_id_norm
        AND op.outcome_idx = cf_agg.outcome_idx

      WHERE gr.cid IS NOT NULL  -- Only resolved markets
      ORDER BY abs(realized_pnl_usd) DESC
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json();

  // INTERMEDIATE NUMBERS BREAKDOWN
  console.log('[1] Intermediate Numbers (Top 5 Winners + Top 5 Losers)');
  console.log('─'.repeat(80));
  console.log();

  const wins = data.filter((r: any) => r.result === 'WIN').slice(0, 5);
  const losses = data.filter((r: any) => r.result === 'LOSS').slice(0, 5);

  console.log('TOP WINNERS:');
  wins.forEach((row: any, idx: number) => {
    const shares = parseFloat(row.net_shares);
    const costBasis = parseFloat(row.cost_basis_micro);
    const pnl = parseFloat(row.realized_pnl_usd);

    console.log(`${(idx + 1).toString().padStart(2)}. ${row.condition_id_norm.substring(0, 16)}... (outcome ${row.outcome_idx}, winner: ${row.winning_outcome})`);
    console.log(`    Net shares (micro):     ${shares.toLocaleString()}`);
    console.log(`    Cost basis (micro):     ${costBasis.toLocaleString()}`);
    console.log(`    Payout (shares/$1):     $${(shares / 1e6).toFixed(2)}`);
    console.log(`    Cost (absolute):        $${Math.abs(costBasis / 1e6).toFixed(2)}`);
    console.log(`    → Realized P&L:         $${pnl.toFixed(2)}`);
    console.log();
  });

  console.log('TOP LOSERS:');
  losses.forEach((row: any, idx: number) => {
    const shares = parseFloat(row.net_shares);
    const costBasis = parseFloat(row.cost_basis_micro);
    const pnl = parseFloat(row.realized_pnl_usd);

    console.log(`${(idx + 1).toString().padStart(2)}. ${row.condition_id_norm.substring(0, 16)}... (outcome ${row.outcome_idx}, winner: ${row.winning_outcome})`);
    console.log(`    Net shares (micro):     ${shares.toLocaleString()}`);
    console.log(`    Cost basis (micro):     ${costBasis.toLocaleString()}`);
    console.log(`    Payout (shares/$0):     $0.00`);
    console.log(`    Cost (lost):            $${Math.abs(costBasis / 1e6).toFixed(2)}`);
    console.log(`    → Realized P&L:         $${pnl.toFixed(2)}`);
    console.log();
  });

  // TOTAL P&L CALCULATION
  console.log('═'.repeat(80));
  console.log('[2] Total P&L Summary');
  console.log('═'.repeat(80));
  console.log();

  const totalPnL = data.reduce((sum: number, row: any) => {
    return sum + parseFloat(row.realized_pnl_usd);
  }, 0);

  const winCount = data.filter((r: any) => r.result === 'WIN').length;
  const lossCount = data.filter((r: any) => r.result === 'LOSS').length;

  const winPnL = data
    .filter((r: any) => r.result === 'WIN')
    .reduce((sum: number, r: any) => sum + parseFloat(r.realized_pnl_usd), 0);

  const lossPnL = data
    .filter((r: any) => r.result === 'LOSS')
    .reduce((sum: number, r: any) => sum + parseFloat(r.realized_pnl_usd), 0);

  console.log(`Total resolved positions: ${data.length}`);
  console.log(`  Wins:   ${winCount.toString().padStart(3)} positions → P&L: $${winPnL.toLocaleString()}`);
  console.log(`  Losses: ${lossCount.toString().padStart(3)} positions → P&L: $${lossPnL.toLocaleString()}`);
  console.log();
  console.log(`Total realized P&L: $${totalPnL.toLocaleString()}`);
  console.log(`Expected (Dome):    $${EXPECTED_PNL.toLocaleString()}`);
  console.log();

  // VARIANCE CALCULATION
  const variance = ((totalPnL / EXPECTED_PNL - 1) * 100);
  const delta = totalPnL - EXPECTED_PNL;
  const status = Math.abs(variance) < 2.0 ? '✅ PASS' : '❌ FAIL';

  console.log(`Delta:    $${delta.toLocaleString()} (${delta > 0 ? '+' : ''}${delta.toFixed(2)})`);
  console.log(`Variance: ${variance.toFixed(2)}%`);
  console.log(`Status:   ${status} (<2% threshold)`);
  console.log();

  // OUTCOME INDEX VERIFICATION
  console.log('═'.repeat(80));
  console.log('[3] Outcome Index Distribution (Bug #2 verification)');
  console.log('═'.repeat(80));
  console.log();

  const outcome0Count = data.filter((r: any) => r.outcome_idx === 0).length;
  const outcome1Count = data.filter((r: any) => r.outcome_idx === 1).length;
  const otherCount = data.filter((r: any) => r.outcome_idx > 1).length;

  console.log(`Outcome 0 (NO): ${outcome0Count} positions`);
  console.log(`Outcome 1 (YES):  ${outcome1Count} positions`);
  console.log(`Outcome 2+:      ${otherCount} positions`);
  console.log();

  if (outcome1Count === 0) {
    console.log('⚠️  WARNING: No outcome 1 (YES) positions found!');
    console.log('    Bug #2 fix may not be working correctly.');
  } else {
    console.log(`✅ Both YES and NO positions detected (${outcome0Count + outcome1Count} total)`)
  }
  console.log();

  // FINAL VERDICT
  console.log('═'.repeat(80));

  if (Math.abs(variance) < 2.0) {
    console.log('🎉 VALIDATION PASSED!');
    console.log();
    console.log('All three bug fixes verified:');
    console.log('  ✅ Micro-unit conversion (÷1e6) working correctly');
    console.log('  ✅ Outcome index decoding capturing YES + NO positions');
    console.log('  ✅ Loser formula sign correct (no inversion)');
    console.log();
    console.log('Variance within ±2% threshold. Ready to apply fixes to production.');
    console.log();
    console.log('NEXT STEPS:');
    console.log('1. Update view definitions (outcome_positions_v2, trade_cashflows_v3)');
    console.log('2. Update rebuild script (rebuild-realized-pnl-from-positions.ts)');
    console.log('3. Rebuild all P&L tables');
    console.log('4. Re-validate all 11 Dome baseline wallets');
  } else {
    console.log('⚠️  VALIDATION FAILED');
    console.log();
    console.log(`Variance: ${variance.toFixed(2)}% (threshold: <2%)`);
    console.log();

    if (Math.abs(variance) > 10) {
      console.log('Variance still very high. Possible causes:');
      console.log('  - Asset ID decoding formula incorrect');
      console.log('  - Missing fee adjustments');
      console.log('  - Incorrect market resolution matching');
    } else {
      console.log('Variance acceptable but above threshold. Possible causes:');
      console.log('  - Minor fee handling differences');
      console.log('  - Rounding precision issues');
      console.log('  - Different treatment of partial fills');
    }
    console.log();
    console.log('Further investigation needed before production deployment.');
  }

  console.log('═'.repeat(80));
}

main().catch(console.error);
