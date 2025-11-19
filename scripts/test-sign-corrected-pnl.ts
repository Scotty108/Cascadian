#!/usr/bin/env npx tsx

/**
 * Test Sign-Corrected P&L Formula
 *
 * Tests the hypothesis that removing the `-1 *` multiplier from the loser
 * formula will close the 18% variance gap.
 *
 * CORRECTED FORMULAS:
 * - Winners: (net_shares + cashflow_usdc) / 1e6
 * - Losers: cashflow_usdc / 1e6  (NOT -1 * cashflow_usdc / 1e6)
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const EXPECTED_PNL = 87030.51;

async function main() {
  console.log('═'.repeat(80));
  console.log('SIGN-CORRECTED P&L FORMULA TEST');
  console.log('═'.repeat(80));
  console.log(`Wallet: ${BASELINE_WALLET}`);
  console.log(`Expected P&L (Dome): $${EXPECTED_PNL.toLocaleString()}`);
  console.log();

  const result = await clickhouse.query({
    query: `
      SELECT
        op.wallet,
        op.condition_id_norm,
        op.outcome_idx,
        op.net_shares,
        gr.winning_outcome,
        COALESCE(cf_agg.total_cashflow_usd, 0.0) as cost_basis_micro,

        -- SIGN-CORRECTED FORMULA
        CASE
          WHEN gr.cid IS NOT NULL THEN
            CASE
              WHEN (op.outcome_idx = 0 AND lower(gr.winning_outcome) = 'yes') OR
                   (op.outcome_idx = 1 AND lower(gr.winning_outcome) = 'no') THEN
                -- Won: payout ($1/share) minus cost
                (op.net_shares + COALESCE(cf_agg.total_cashflow_usd, 0.0)) / 1000000.0
              ELSE
                -- Lost: just the cashflow (already negative for buyers)
                COALESCE(cf_agg.total_cashflow_usd, 0.0) / 1000000.0
            END
          ELSE
            0.0
        END AS realized_pnl_usd_corrected,

        -- Mark as winner or loser for analysis
        CASE
          WHEN (op.outcome_idx = 0 AND lower(gr.winning_outcome) = 'yes') OR
               (op.outcome_idx = 1 AND lower(gr.winning_outcome) = 'no') THEN
            'WIN'
          ELSE
            'LOSS'
        END AS result

      FROM outcome_positions_v2 AS op

      LEFT JOIN gamma_resolved AS gr
        ON op.condition_id_norm = gr.cid

      LEFT JOIN (
        SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          SUM(cashflow_usdc) AS total_cashflow_usd
        FROM trade_cashflows_v3
        GROUP BY wallet, condition_id_norm, outcome_idx
      ) AS cf_agg
        ON op.wallet = cf_agg.wallet
        AND op.condition_id_norm = cf_agg.condition_id_norm
        AND op.outcome_idx = cf_agg.outcome_idx

      WHERE lower(op.wallet) = lower('${BASELINE_WALLET}')
        AND gr.cid IS NOT NULL
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json();

  console.log('[1] Sample Calculations (5 wins + 5 losses)');
  console.log('─'.repeat(80));
  console.log();

  const wins = data.filter((r: any) => r.result === 'WIN').slice(0, 5);
  const losses = data.filter((r: any) => r.result === 'LOSS').slice(0, 5);

  console.log('WINS:');
  wins.forEach((row: any, idx: number) => {
    const shares = parseFloat(row.net_shares);
    const costBasis = parseFloat(row.cost_basis_micro);
    const pnl = parseFloat(row.realized_pnl_usd_corrected);

    console.log(`${(idx + 1).toString().padStart(2)}. ${row.condition_id_norm.substring(0, 12)}...`);
    console.log(`    Shares (micro): ${shares.toLocaleString()}`);
    console.log(`    Cashflow (micro): ${costBasis.toLocaleString()}`);
    console.log(`    P&L (USD): $${pnl.toFixed(2)}`);
    console.log();
  });

  console.log('LOSSES:');
  losses.forEach((row: any, idx: number) => {
    const shares = parseFloat(row.net_shares);
    const costBasis = parseFloat(row.cost_basis_micro);
    const pnl = parseFloat(row.realized_pnl_usd_corrected);

    console.log(`${(idx + 1).toString().padStart(2)}. ${row.condition_id_norm.substring(0, 12)}...`);
    console.log(`    Shares (micro): ${shares.toLocaleString()}`);
    console.log(`    Cashflow (micro): ${costBasis.toLocaleString()}`);
    console.log(`    P&L (USD): $${pnl.toFixed(2)}`);
    console.log();
  });

  console.log('═'.repeat(80));
  console.log('[2] Total P&L Analysis');
  console.log('═'.repeat(80));
  console.log();

  const totalPnL = data.reduce((sum: number, row: any) => {
    return sum + parseFloat(row.realized_pnl_usd_corrected);
  }, 0);

  const winCount = data.filter((r: any) => r.result === 'WIN').length;
  const lossCount = data.filter((r: any) => r.result === 'LOSS').length;

  const winPnL = data
    .filter((r: any) => r.result === 'WIN')
    .reduce((sum: number, r: any) => sum + parseFloat(r.realized_pnl_usd_corrected), 0);

  const lossPnL = data
    .filter((r: any) => r.result === 'LOSS')
    .reduce((sum: number, r: any) => sum + parseFloat(r.realized_pnl_usd_corrected), 0);

  console.log(`Markets with P&L: ${data.length}`);
  console.log(`  Wins: ${winCount} (P&L: $${winPnL.toLocaleString()})`);
  console.log(`  Losses: ${lossCount} (P&L: $${lossPnL.toLocaleString()})`);
  console.log();
  console.log(`Total realized P&L: $${totalPnL.toLocaleString()}`);
  console.log(`Expected (Dome): $${EXPECTED_PNL.toLocaleString()}`);
  console.log();

  const variance = ((totalPnL / EXPECTED_PNL - 1) * 100);
  const status = Math.abs(variance) < 2.0 ? '✅ PASS' : '❌ FAIL';

  console.log(`Variance: ${variance.toFixed(2)}%`);
  console.log(`Status: ${status} (<2% threshold)`);
  console.log();

  console.log('═'.repeat(80));

  if (Math.abs(variance) < 2.0) {
    console.log('🎉 SIGN-CORRECTED FORMULA VERIFIED!');
    console.log();
    console.log('The sign fix closed the gap to <2% variance.');
    console.log('Ready to apply fix to rebuild script and run full pipeline.');
  } else {
    console.log(`⚠️  VARIANCE: ${variance.toFixed(2)}% (threshold: <2%)`);
    console.log();
    if (variance > 0) {
      console.log('P&L is HIGHER than expected. Possible causes:');
      console.log('- Counting markets Dome excludes (fees, partial fills?)');
      console.log('- Incorrect winner detection logic');
      console.log('- Missing cost adjustments');
    } else {
      console.log('P&L is LOWER than expected. Possible causes:');
      console.log('- Missing winning trades');
      console.log('- Cost basis too high (double-counting?)');
      console.log('- Incorrect sign convention still present');
    }
  }

  console.log('═'.repeat(80));
}

main().catch(console.error);
