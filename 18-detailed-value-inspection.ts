#!/usr/bin/env npx tsx

/**
 * DETAILED VALUE INSPECTION
 *
 * The diagnostic shows JOINs are working, but we're getting $0 P&L.
 * This suggests the values being returned are wrong, not the JOIN itself.
 *
 * Check:
 * 1. What payout values are being returned for each wallet?
 * 2. Are payout_numerators arrays populated?
 * 3. Are they 1-indexed correctly?
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('='.repeat(100))
  console.log('DETAILED VALUE INSPECTION')
  console.log('Why are Wallets 2-4 showing $0 despite having matched conditions?')
  console.log('='.repeat(100))

  try {
    // Get one sample condition from each wallet
    console.log('\n[STEP 1] Sample condition from each wallet')

    const samples = await (await clickhouse.query({
      query: `
        SELECT
          t.wallet_address,
          t.condition_id,
          lower(replaceAll(t.condition_id, '0x', '')) as norm_id,
          r.condition_id_norm,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          r.winning_outcome,
          IF(
            lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm,
            'EXACT_MATCH',
            'MISMATCH'
          ) as match_type
        FROM trades_raw t
        LEFT JOIN market_resolutions_final r ON
          lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
        WHERE t.wallet_address IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        GROUP BY t.wallet_address, t.condition_id, r.condition_id_norm, r.winning_index, r.payout_numerators, r.payout_denominator, r.winning_outcome
        LIMIT 4
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    for (const s of samples) {
      console.log(`\n  Wallet: ${s.wallet_address.substring(0, 12)}...`)
      console.log(`    Condition ID: ${s.condition_id.substring(0, 20)}...`)
      console.log(`    Normalized: ${s.norm_id.substring(0, 20)}...`)
      console.log(`    In resolutions table: ${s.condition_id_norm ? 'YES' : 'NO'}`)
      console.log(`    Winning Index: ${s.winning_index}`)
      console.log(`    Payout Numerators: ${s.payout_numerators}`)
      console.log(`    Payout Denominator: ${s.payout_denominator}`)
      console.log(`    Winning Outcome: ${s.winning_outcome}`)
      console.log(`    Match Type: ${s.match_type}`)
    }

    // Now calculate P&L for each wallet the EXACT same way as production
    console.log('\n\n[STEP 2] Calculate P&L exactly as production (per wallet)')

    const pnlCalc = await (await clickhouse.query({
      query: `
        WITH trade_details AS (
          SELECT
            lower(tr.wallet_address) as wallet,
            lower(replaceAll(tr.condition_id, '0x', '')) as condition_id,
            toInt16(tr.outcome_index) as outcome_idx,
            toFloat64(tr.shares) as shares,
            toFloat64(tr.entry_price) as entry_price,
            coalesce(toFloat64(tr.fee_usd), 0) as fee_usd
          FROM trades_raw tr
          INNER JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
          WHERE lower(tr.wallet_address) IN (
            '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
            '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
            '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
            '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
          )
            AND mrf.winning_index IS NOT NULL
        ),
        with_resolution AS (
          SELECT
            td.wallet,
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
            wallet,
            condition_id,
            win_idx,
            payout_numerators,
            payout_denominator,
            round(sum(if(outcome_idx = win_idx, shares, 0)), 2) as winning_shares,
            arrayElement(payout_numerators, win_idx + 1) as payout_num,
            round(sum(if(outcome_idx = win_idx, entry_price * shares, 0)), 2) as winning_cost_basis,
            round(sum(fee_usd), 2) as fees
          FROM with_resolution
          GROUP BY wallet, condition_id, win_idx, payout_numerators, payout_denominator
        )
        SELECT
          wallet,
          round(sum(winning_shares * payout_num / payout_denominator), 2) as settlement,
          round(sum(winning_cost_basis), 2) as cost_basis,
          round(sum(fees), 2) as fees,
          round(sum(winning_shares * payout_num / payout_denominator) - sum(winning_cost_basis) - sum(fees), 2) as pnl,
          count() as num_conditions,
          sum(winning_shares) as total_winning_shares
        FROM per_condition
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n  P&L Results:')
    for (const row of pnlCalc) {
      const shortAddr = row.wallet.substring(0, 12)
      console.log(`\n    Wallet ${shortAddr}...`)
      console.log(`      Settlement:       $${row.settlement}`)
      console.log(`      Cost Basis:       $${row.cost_basis}`)
      console.log(`      Fees:             $${row.fees}`)
      console.log(`      P&L:              $${row.pnl}`)
      console.log(`      Conditions:       ${row.num_conditions}`)
      console.log(`      Winning Shares:   ${row.total_winning_shares}`)
    }

    // Now check if the problem is payout_numerators being all zeros
    console.log('\n\n[STEP 3] Check payout_numerators values')

    const payoutCheck = await (await clickhouse.query({
      query: `
        SELECT
          t.wallet_address,
          count() as trade_count,
          countIf(r.payout_numerators = arrayConstruct(toUInt8(0))) as all_zeros,
          countIf(r.payout_numerators = arrayConstruct(toUInt8(1))) as all_ones,
          countIf(arraySum(r.payout_numerators) = 0) as sum_is_zero,
          countIf(arraySum(r.payout_numerators) > 0) as sum_is_positive
        FROM trades_raw t
        INNER JOIN market_resolutions_final r ON
          lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
        WHERE t.wallet_address IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        GROUP BY t.wallet_address
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n  Payout array analysis:')
    for (const row of payoutCheck) {
      const shortAddr = row.wallet_address.substring(0, 12)
      console.log(`    Wallet ${shortAddr}...`)
      console.log(`      All zeros payout: ${row.all_zeros}`)
      console.log(`      All ones payout:  ${row.all_ones}`)
      console.log(`      Sum = 0:          ${row.sum_is_zero}`)
      console.log(`      Sum > 0:          ${row.sum_is_positive}`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
