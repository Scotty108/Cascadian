#!/usr/bin/env npx tsx

/**
 * Prototype: Corrected P&L Formula with 10^6 Denomination
 *
 * Tests the fix on baseline wallet 0xcce2b7c71f
 * Expected result: $87,030.51 (from Dome API)
 *
 * Root cause: Polymarket uses 10^6 micro-units for share sizes
 * Fix: Divide both net_shares and cost_basis by 1,000,000
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const EXPECTED_PNL = 87030.51;

async function main() {
  console.log('═'.repeat(80));
  console.log('PROTOTYPE: CORRECTED P&L FORMULA');
  console.log('═'.repeat(80));
  console.log(`Wallet: ${BASELINE_WALLET}`);
  console.log(`Expected P&L (Dome): $${EXPECTED_PNL.toLocaleString()}`);
  console.log();

  // Calculate P&L with corrected formula
  const result = await clickhouse.query({
    query: `
      SELECT
        op.wallet,
        op.condition_id_norm,
        op.outcome_idx,
        op.net_shares,
        gr.winning_outcome,
        COALESCE(cf_agg.total_cashflow_usd, 0.0) as cost_basis_micro,

        -- CORRECTED FORMULA: Divide by 1e6 to convert micro-units to USD
        CASE
          WHEN gr.cid IS NOT NULL THEN
            CASE
              WHEN (op.outcome_idx = 0 AND lower(gr.winning_outcome) = 'yes') OR
                   (op.outcome_idx = 1 AND lower(gr.winning_outcome) = 'no') THEN
                -- Won: (shares - cost_basis) / 1e6
                (op.net_shares - COALESCE(cf_agg.total_cashflow_usd, 0.0)) / 1000000.0
              ELSE
                -- Lost: only lose the cost basis / 1e6
                -1.0 * COALESCE(cf_agg.total_cashflow_usd, 0.0) / 1000000.0
            END
          ELSE
            0.0
        END AS realized_pnl_usd_corrected

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

  console.log('[1] Sample P&L Calculations (first 10 markets)');
  console.log('─'.repeat(80));
  console.log();

  data.slice(0, 10).forEach((row: any, idx: number) => {
    const shares = parseFloat(row.net_shares);
    const costBasis = parseFloat(row.cost_basis_micro);
    const pnl = parseFloat(row.realized_pnl_usd_corrected);

    console.log(`${(idx + 1).toString().padStart(2)}. ${row.condition_id_norm.substring(0, 12)}... (outcome ${row.outcome_idx}, winner: ${row.winning_outcome})`);
    console.log(`    Shares (micro): ${shares.toLocaleString()}`);
    console.log(`    Cost basis (micro): ${costBasis.toLocaleString()}`);
    console.log(`    P&L (USD): $${pnl.toFixed(2)}`);
    console.log();
  });

  // Aggregate total
  console.log('═'.repeat(80));
  console.log('[2] Total P&L');
  console.log('═'.repeat(80));
  console.log();

  const totalPnL = data.reduce((sum: number, row: any) => {
    return sum + parseFloat(row.realized_pnl_usd_corrected);
  }, 0);

  console.log(`Markets with P&L: ${data.length}`);
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
    console.log('🎉 FORMULA VERIFIED!');
    console.log();
    console.log('The corrected formula matches Dome within 2% variance.');
    console.log('Ready to rebuild all P&L tables with this fix.');
  } else {
    console.log('⚠️  VARIANCE EXCEEDS THRESHOLD');
    console.log();
    console.log('Further investigation needed:');
    console.log('- Check if cost_basis sign convention is correct');
    console.log('- Verify winning_outcome matching logic');
    console.log('- Sample individual market calculations');
  }

  console.log('═'.repeat(80));
}

main().catch(console.error);
