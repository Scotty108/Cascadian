#!/usr/bin/env npx tsx

/**
 * Wallet 1 Full Analysis
 *
 * Aggregate all conditions and test settlement calculation hypotheses
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const WALLET_1 = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'

async function execute() {
  console.log('='.repeat(100))
  console.log('WALLET 1 FULL ANALYSIS')
  console.log('Testing settlement calculation with all resolved conditions')
  console.log('='.repeat(100))

  try {
    // Get all resolved conditions for Wallet 1 with their settlement values
    console.log('\n[STEP 1] Calculate settlement across ALL conditions for Wallet 1...')
    console.log('Testing different hypotheses:')
    console.log('  A) Direct match: outcome_index = winning_index')
    console.log('  B) Offset -1: outcome_index = winning_index - 1')
    console.log('  C) Offset +1: outcome_index = winning_index + 1')
    console.log('  D) All outcomes: sum all outcome_indices (sanity check)')

    const settlement = await (await clickhouse.query({
      query: `
        WITH trade_details AS (
          SELECT
            tr.wallet_address,
            lower(replaceAll(tr.condition_id, '0x', '')) as condition_id_norm,
            toInt16(tr.outcome_index) as outcome_index,
            toFloat64(tr.shares) as shares,
            toFloat64(tr.entry_price) as entry_price
          FROM trades_raw tr
          INNER JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
          WHERE lower(tr.wallet_address) = '${WALLET_1.toLowerCase()}'
            AND mrf.winning_index IS NOT NULL
        ),
        with_resolution AS (
          SELECT
            td.*,
            mrf.winning_index as win_idx,
            mrf.payout_numerators,
            mrf.payout_denominator
          FROM trade_details td
          INNER JOIN market_resolutions_final mrf ON td.condition_id_norm = mrf.condition_id_norm
        )
        SELECT
          round(sum(
            if(outcome_index = win_idx, shares, 0)
            * (arrayElement(payout_numerators, win_idx + 1) / payout_denominator)
          ), 2) as settlement_direct,

          round(sum(
            if(outcome_index = win_idx - 1, shares, 0)
            * (arrayElement(payout_numerators, win_idx + 1) / payout_denominator)
          ), 2) as settlement_offset_minus1,

          round(sum(
            if(outcome_index = win_idx + 1, shares, 0)
            * (arrayElement(payout_numerators, win_idx + 1) / payout_denominator)
          ), 2) as settlement_offset_plus1,

          round(sum(
            shares * (arrayElement(payout_numerators, win_idx + 1) / payout_denominator)
          ), 2) as settlement_all_shares,

          count() as total_trades,
          uniqExact(condition_id_norm) as total_conditions
        FROM with_resolution
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const result = settlement[0]
    console.log(`\n✅ Results:`)
    console.log(`   Direct (outcome_index = win_idx):        $${result.settlement_direct}`)
    console.log(`   Offset -1 (outcome_index = win_idx - 1): $${result.settlement_offset_minus1}`)
    console.log(`   Offset +1 (outcome_index = win_idx + 1): $${result.settlement_offset_plus1}`)
    console.log(`   All shares (no filtering):              $${result.settlement_all_shares}`)
    console.log(`   Total trades: ${result.total_trades}`)
    console.log(`   Total resolved conditions: ${result.total_conditions}`)

    console.log(`\n📊 Comparison to UI value ($137,663):`);
    console.log(`   Direct:        ${(result.settlement_direct / 137663 * 100).toFixed(1)}% of expected`)
    console.log(`   Offset -1:     ${(result.settlement_offset_minus1 / 137663 * 100).toFixed(1)}% of expected`)
    console.log(`   Offset +1:     ${(result.settlement_offset_plus1 / 137663 * 100).toFixed(1)}% of expected`)
    console.log(`   All shares:    ${(result.settlement_all_shares / 137663 * 100).toFixed(1)}% of expected`)

    // Now test cashflow + settlement combinations
    console.log('\n[STEP 2] Test P&L formula: Cashflow + Settlement - Fees...')

    const pnlTest = await (await clickhouse.query({
      query: `
        WITH trade_details AS (
          SELECT
            tr.wallet_address,
            lower(replaceAll(tr.condition_id, '0x', '')) as condition_id_norm,
            toInt16(tr.outcome_index) as outcome_index,
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
            td.*,
            mrf.winning_index as win_idx,
            mrf.payout_numerators,
            mrf.payout_denominator
          FROM trade_details td
          INNER JOIN market_resolutions_final mrf ON td.condition_id_norm = mrf.condition_id_norm
        )
        SELECT
          round(sum(if(side = 'YES', -entry_price * shares, entry_price * shares)), 2) as cashflow_var_a,
          round(sum(fee_usd), 2) as total_fees,
          round(sum(
            if(outcome_index = win_idx, shares, 0)
            * (arrayElement(payout_numerators, win_idx + 1) / payout_denominator)
          ), 2) as settlement,
          round(sum(if(side = 1, -entry_price * shares, entry_price * shares))
            + sum(if(outcome_index = win_idx, shares, 0)
              * (arrayElement(payout_numerators, win_idx + 1) / payout_denominator))
            - sum(fee_usd), 2) as total_pnl
        FROM with_resolution
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const pnl = pnlTest[0]
    console.log(`\n✅ P&L Components:`)
    console.log(`   Cashflow:      $${pnl.cashflow_var_a}`)
    console.log(`   Settlement:    $${pnl.settlement}`)
    console.log(`   Fees:          $${pnl.total_fees}`)
    console.log(`   Total P&L:     $${pnl.total_pnl}`)

    console.log(`\n📊 Comparison to UI P&L ($137,663):`);
    console.log(`   Variance: ${((pnl.total_pnl - 137663) / 137663 * 100).toFixed(2)}%`)
    console.log(`   Difference: $${(pnl.total_pnl - 137663).toFixed(2)}`)

    if (Math.abs(pnl.total_pnl - 137663) < 5000) {
      console.log(`   ✅ MATCH FOUND!`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
