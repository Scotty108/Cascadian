#!/usr/bin/env npx tsx

/**
 * Formula Hypothesis Test
 *
 * Testing if P&L should be calculated as:
 * Per condition:
 *   - Realized P&L = (winning_shares * payout) - cost_basis_of_winning_position
 *
 * Where cost_basis = sum(entry_price * shares) for the winning outcome_index
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const WALLET_1 = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'

async function execute() {
  console.log('='.repeat(100))
  console.log('FORMULA HYPOTHESIS TEST')
  console.log('Testing: P&L = (winning_settlement) - (cost_basis_of_winning_outcome)')
  console.log('='.repeat(100))

  try {
    const result = await (await clickhouse.query({
      query: `
        WITH trade_details AS (
          SELECT
            lower(replaceAll(tr.condition_id, '0x', '')) as condition_id,
            toInt16(tr.outcome_index) as outcome_idx,
            toFloat64(tr.shares) as shares,
            toFloat64(tr.entry_price) as entry_price,
            tr.side,
            coalesce(toFloat64(tr.fee_usd), 0) as fee_usd
          FROM trades_raw tr
          INNER JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
          WHERE lower(tr.wallet_address) = '${WALLET_1.toLowerCase()}'
            AND mrf.winning_index IS NOT NULL
        ),
        with_resolution AS (
          SELECT
            td.condition_id,
            td.outcome_idx,
            td.shares,
            td.entry_price,
            td.side,
            td.fee_usd,
            mrf.winning_index as win_idx,
            mrf.payout_numerators,
            mrf.payout_denominator
          FROM trade_details td
          INNER JOIN market_resolutions_final mrf ON td.condition_id = mrf.condition_id_norm
        ),
        per_condition AS (
          SELECT
            condition_id,
            win_idx,
            payout_numerators,
            payout_denominator,
            -- Settlement: winning shares * payout
            sum(if(outcome_idx = win_idx, shares, 0)) as winning_shares,
            arrayElement(payout_numerators, win_idx + 1) as payout_num,
            -- Cost basis: sum of entry_price * shares for winning outcome
            sum(if(outcome_idx = win_idx, entry_price * shares, 0)) as winning_cost_basis,
            -- Fees on winning position
            sum(if(outcome_idx = win_idx, fee_usd, 0)) as winning_fees,
            -- Total shares across all outcomes (for sanity check)
            sum(shares) as total_shares_all_outcomes
          FROM with_resolution
          GROUP BY condition_id, win_idx, payout_numerators, payout_denominator
        )
        SELECT
          round(sum(winning_shares * payout_num / payout_denominator), 2) as total_settlement,
          round(sum(winning_cost_basis), 2) as total_cost_basis,
          round(sum(winning_fees), 2) as total_winning_fees,
          round(sum(winning_shares * payout_num / payout_denominator) - sum(winning_cost_basis) - sum(winning_fees), 2) as net_pnl_per_outcome,
          round(sum(winning_shares * payout_num / payout_denominator) - sum(winning_cost_basis), 2) as net_pnl_no_fees,
          count() as num_conditions,
          round(avg(winning_shares), 2) as avg_winning_shares,
          round(max(winning_shares), 2) as max_winning_shares
        FROM per_condition
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const data = result[0]

    console.log('\n✅ P&L Calculation (Hypothesis: Settlement - Cost Basis per Outcome):')
    console.log(`   Total settlement:     $${data.total_settlement}`)
    console.log(`   Total cost basis:     $${data.total_cost_basis}`)
    console.log(`   Total winning fees:   $${data.total_winning_fees}`)
    console.log(`   \n   P&L (with fees):      $${data.net_pnl_per_outcome}`)
    console.log(`   P&L (no fees):        $${data.net_pnl_no_fees}`)
    console.log(`   \n   Conditions:           ${data.num_conditions}`)
    console.log(`   Avg winning shares:   ${data.avg_winning_shares}`)
    console.log(`   Max winning shares:   ${data.max_winning_shares}`)

    console.log(`\n📊 Comparison to UI P&L ($137,663):`);
    console.log(`   With fees: ${((data.net_pnl_per_outcome - 137663) / 137663 * 100).toFixed(2)}% variance`);
    console.log(`   No fees:   ${((data.net_pnl_no_fees - 137663) / 137663 * 100).toFixed(2)}% variance`);

    // Now test alternative: maybe we need to include cashflows on LOSING positions too?
    console.log('\n\n[ALTERNATIVE] Testing: Include cashflows on all positions...')

    const altResult = await (await clickhouse.query({
      query: `
        WITH trade_details AS (
          SELECT
            lower(replaceAll(tr.condition_id, '0x', '')) as condition_id,
            toInt16(tr.outcome_index) as outcome_idx,
            toFloat64(tr.shares) as shares,
            toFloat64(tr.entry_price) as entry_price,
            tr.side,
            coalesce(toFloat64(tr.fee_usd), 0) as fee_usd
          FROM trades_raw tr
          INNER JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
          WHERE lower(tr.wallet_address) = '${WALLET_1.toLowerCase()}'
            AND mrf.winning_index IS NOT NULL
        ),
        with_resolution AS (
          SELECT
            td.condition_id,
            td.outcome_idx,
            td.shares,
            td.entry_price,
            td.side,
            td.fee_usd,
            mrf.winning_index as win_idx,
            mrf.payout_numerators,
            mrf.payout_denominator
          FROM trade_details td
          INNER JOIN market_resolutions_final mrf ON td.condition_id = mrf.condition_id_norm
        ),
        per_condition AS (
          SELECT
            condition_id,
            win_idx,
            payout_numerators,
            payout_denominator,
            -- ALL cashflows (buy = negative, sell = positive)
            sum(if(side = 'YES', -entry_price * shares, entry_price * shares)) as net_cashflow,
            -- Settlement: winning shares * payout
            sum(if(outcome_idx = win_idx, shares, 0) * (arrayElement(payout_numerators, win_idx + 1) / payout_denominator)) as settlement,
            -- All fees
            sum(fee_usd) as total_fees
          FROM with_resolution
          GROUP BY condition_id, win_idx, payout_numerators, payout_denominator
        )
        SELECT
          round(sum(net_cashflow), 2) as total_cashflow,
          round(sum(settlement), 2) as total_settlement,
          round(sum(total_fees), 2) as total_fees,
          round(sum(net_cashflow) + sum(settlement) - sum(total_fees), 2) as total_pnl
        FROM per_condition
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const alt = altResult[0]
    console.log(`\n✅ P&L Calculation (All positions + settlement - fees):`)
    console.log(`   Total cashflow:      $${alt.total_cashflow}`)
    console.log(`   Total settlement:    $${alt.total_settlement}`)
    console.log(`   Total fees:          $${alt.total_fees}`)
    console.log(`   Total P&L:           $${alt.total_pnl}`)

    console.log(`\n📊 Comparison to UI P&L ($137,663):`);
    console.log(`   Variance: ${((alt.total_pnl - 137663) / 137663 * 100).toFixed(2)}%`);

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
