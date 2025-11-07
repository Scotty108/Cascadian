#!/usr/bin/env npx tsx

/**
 * Formula with Fees
 *
 * Testing: P&L = sum(settlement - cost_basis - fees) for winning outcomes only
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const WALLET_1 = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'

async function execute() {
  console.log('='.repeat(100))
  console.log('FORMULA WITH FEES TEST')
  console.log('Testing if including fees improves accuracy')
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
            sum(if(outcome_idx = win_idx, shares, 0)) as winning_shares,
            arrayElement(payout_numerators, win_idx + 1) as payout_num,
            sum(if(outcome_idx = win_idx, entry_price * shares, 0)) as winning_cost_basis,
            sum(if(outcome_idx = win_idx, fee_usd, 0)) as winning_fees,
            sum(fee_usd) as all_fees
          FROM with_resolution
          GROUP BY condition_id, win_idx, payout_numerators, payout_denominator
        )
        SELECT
          round(sum(winning_shares * payout_num / payout_denominator), 2) as total_settlement,
          round(sum(winning_cost_basis), 2) as total_winning_cost_basis,
          round(sum(winning_fees), 2) as total_winning_fees,
          round(sum(all_fees), 2) as total_all_fees,
          round(sum(winning_shares * payout_num / payout_denominator) - sum(winning_cost_basis) - sum(winning_fees), 2) as pnl_with_winning_fees,
          round(sum(winning_shares * payout_num / payout_denominator) - sum(winning_cost_basis) - sum(all_fees), 2) as pnl_with_all_fees,
          round(sum(winning_shares * payout_num / payout_denominator) - sum(winning_cost_basis), 2) as pnl_no_fees
        FROM per_condition
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const data = result[0]
    const expectedUI = 137663

    console.log('\n✅ P&L Calculation Options:')
    console.log(`\n  Settlement:              $${data.total_settlement}`)
    console.log(`  Winning cost basis:      $${data.total_winning_cost_basis}`)
    console.log(`  Winning fees:            $${data.total_winning_fees}`)
    console.log(`  All fees:                $${data.total_all_fees}`)

    console.log(`\n  Option 1 - No fees:`)
    console.log(`    P&L = $${data.pnl_no_fees}`)
    console.log(`    Variance: ${(((data.pnl_no_fees - expectedUI) / expectedUI) * 100).toFixed(2)}%`)

    console.log(`\n  Option 2 - With winning fees only:`)
    console.log(`    P&L = $${data.pnl_with_winning_fees}`)
    console.log(`    Variance: ${(((data.pnl_with_winning_fees - expectedUI) / expectedUI) * 100).toFixed(2)}%`)

    console.log(`\n  Option 3 - With all fees:`)
    console.log(`    P&L = $${data.pnl_with_all_fees}`)
    console.log(`    Variance: ${(((data.pnl_with_all_fees - expectedUI) / expectedUI) * 100).toFixed(2)}%`)

    console.log(`\n📊 Expected UI P&L: $${expectedUI}`)

    // Determine which is closest
    const diffs = [
      { option: 'No fees', value: data.pnl_no_fees, diff: Math.abs(data.pnl_no_fees - expectedUI) },
      { option: 'Winning fees', value: data.pnl_with_winning_fees, diff: Math.abs(data.pnl_with_winning_fees - expectedUI) },
      { option: 'All fees', value: data.pnl_with_all_fees, diff: Math.abs(data.pnl_with_all_fees - expectedUI) },
    ]

    diffs.sort((a, b) => a.diff - b.diff)
    console.log(`\n✅ CLOSEST MATCH: ${diffs[0].option} (diff: $${diffs[0].diff.toFixed(2)})`)

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
