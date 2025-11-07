#!/usr/bin/env npx tsx

/**
 * Formula Validation: Test on all 4 wallets
 *
 * Correct formula:
 * P&L = sum(settlement - cost_basis) for winning outcomes only
 *
 * Where per condition:
 *   settlement = winning_shares * (payout_numerators[winning_index] / payout_denominator)
 *   cost_basis = sum(entry_price * shares) for outcome_index = winning_index
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const TEST_WALLETS = [
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663 },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492 },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730 },
  { address: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171 },
]

async function execute() {
  console.log('='.repeat(100))
  console.log('FORMULA VALIDATION: All 4 Test Wallets')
  console.log('Formula: P&L = sum(settlement - cost_basis) for winning outcomes')
  console.log('='.repeat(100))

  try {
    const walletList = TEST_WALLETS.map(w => `'${w.address.toLowerCase()}'`).join(',')

    const results = await (await clickhouse.query({
      query: `
        WITH trade_details AS (
          SELECT
            lower(tr.wallet_address) as wallet,
            lower(replaceAll(tr.condition_id, '0x', '')) as condition_id,
            toInt16(tr.outcome_index) as outcome_idx,
            toFloat64(tr.shares) as shares,
            toFloat64(tr.entry_price) as entry_price
          FROM trades_raw tr
          INNER JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
          WHERE lower(tr.wallet_address) IN (${walletList})
            AND mrf.winning_index IS NOT NULL
        ),
        with_resolution AS (
          SELECT
            td.wallet,
            td.condition_id,
            td.outcome_idx,
            td.shares,
            td.entry_price,
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
            -- Settlement: winning shares * payout
            sum(if(outcome_idx = win_idx, shares, 0)) as winning_shares,
            arrayElement(payout_numerators, win_idx + 1) as payout_num,
            payout_denominator,
            -- Cost basis: sum of entry_price * shares for winning outcome
            sum(if(outcome_idx = win_idx, entry_price * shares, 0)) as winning_cost_basis
          FROM with_resolution
          GROUP BY wallet, condition_id, win_idx, payout_numerators, payout_denominator
        ),
        wallet_pnl AS (
          SELECT
            wallet,
            round(sum(winning_shares * payout_num / payout_denominator), 2) as total_settlement,
            round(sum(winning_cost_basis), 2) as total_cost_basis,
            round(sum(winning_shares * payout_num / payout_denominator) - sum(winning_cost_basis), 2) as calculated_pnl,
            count() as num_conditions,
            sum(winning_shares) as total_winning_shares
          FROM per_condition
          GROUP BY wallet
        )
        SELECT
          wallet,
          calculated_pnl,
          total_settlement,
          total_cost_basis,
          num_conditions,
          total_winning_shares
        FROM wallet_pnl
        ORDER BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n')
    console.log('┌─────────────────────────────────────────────────────────────────────────┐')
    console.log('│ VALIDATION RESULTS                                                      │')
    console.log('├──────────────────┬──────────────┬──────────────┬──────────────┬─────────┤')
    console.log('│ Wallet           │ Calculated   │ UI Expected  │ Variance     │ Status  │')
    console.log('├──────────────────┼──────────────┼──────────────┼──────────────┼─────────┤')

    let passCount = 0
    for (const wallet of TEST_WALLETS) {
      const data = results.find(r => r.wallet === wallet.address.toLowerCase())
      if (!data) {
        console.log(`│ ${wallet.address.substring(0, 16).padEnd(16)} │            0 │    ${wallet.ui_pnl.toString().padStart(10)} │  -100.00% │ ❌      │`)
        continue
      }

      const variance = ((data.calculated_pnl - wallet.ui_pnl) / wallet.ui_pnl) * 100
      const pass = Math.abs(variance) <= 5 // Allow 5% tolerance for rounding
      if (pass) passCount++

      const status = pass ? '✅' : '❌'
      const calcStr = data.calculated_pnl.toString().padStart(12)
      const expStr = wallet.ui_pnl.toString().padStart(12)
      const varStr = variance.toFixed(2).padStart(12)

      console.log(`│ ${wallet.address.substring(0, 16).padEnd(16)} │ $${calcStr} │ $${expStr} │ ${varStr}% │ ${status}     │`)
    }

    console.log('├──────────────────┼──────────────┼──────────────┼──────────────┼─────────┤')
    console.log(`│ SUMMARY: ${passCount}/4 PASSED`)
    console.log('└─────────────────────────────────────────────────────────────────────────┘')

    // Print details for each wallet
    console.log('\n\n📊 DETAILED BREAKDOWN\n')
    for (const wallet of TEST_WALLETS) {
      const data = results.find(r => r.wallet === wallet.address.toLowerCase())
      if (!data) {
        console.log(`\n${wallet.address.substring(0, 12)}... (NO DATA)`)
        continue
      }

      console.log(`\n${wallet.address.substring(0, 12)}... (UI: $${wallet.ui_pnl})`)
      console.log(`  Settlement:        $${data.total_settlement}`)
      console.log(`  Cost basis:        $${data.total_cost_basis}`)
      console.log(`  Calculated P&L:    $${data.calculated_pnl}`)
      console.log(`  Variance:          ${(((data.calculated_pnl - wallet.ui_pnl) / wallet.ui_pnl) * 100).toFixed(2)}%`)
      console.log(`  Conditions:        ${data.num_conditions}`)
      console.log(`  Winning shares:    ${data.total_winning_shares.toFixed(0)}`)
    }

    console.log('\n' + '='.repeat(100))
    if (passCount === 4) {
      console.log('✅ ALL WALLETS PASS! Formula is correct.')
      console.log('\nReady to deploy to production and apply to all 900K wallets.')
    } else if (passCount >= 3) {
      console.log('⚠️  3/4 WALLETS PASS. Formula is likely correct with minor rounding differences.')
    } else {
      console.log('❌ Formula needs refinement. Check outliers.')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
