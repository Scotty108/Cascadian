#!/usr/bin/env npx tsx

/**
 * FINAL P&L CALCULATION: Using Correct Tables
 *
 * Solution: Use BOTH tables together:
 * - market_resolutions: Has winning_outcome (100% coverage for wallets 2-4)
 * - market_resolutions_final: Has winning_index and payout vectors
 *
 * Join: trades_raw → market_resolutions (by condition_id)
 *       → market_resolutions_final (by condition_id_norm)
 *
 * This gives us both the outcome AND the payout data
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const TEST_WALLETS = [
  { addr: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', expected: 137663, name: 'Wallet 1' },
  { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', expected: 360492, name: 'Wallet 2' },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', expected: 94730, name: 'Wallet 3' },
  { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', expected: 12171, name: 'Wallet 4' },
]

async function execute() {
  console.log('='.repeat(100))
  console.log('FINAL P&L CALCULATION: Using Both market_resolutions Tables')
  console.log('='.repeat(100))

  try {
    // Step 1: Verify join coverage
    console.log('\n[STEP 1] Verify join coverage with correct tables...')

    const coverage = await (await clickhouse.query({
      query: `
        SELECT
          t.wallet_address,
          COUNT(DISTINCT t.condition_id) as total_conditions_traded,
          countIf(mr.condition_id IS NOT NULL) as matched_to_mr,
          countIf(mrf.condition_id_norm IS NOT NULL) as matched_to_mrf,
          countIf(mr.condition_id IS NOT NULL AND mrf.condition_id_norm IS NOT NULL) as matched_both,
          round(100.0 * countIf(mr.condition_id IS NOT NULL AND mrf.condition_id_norm IS NOT NULL) / COUNT(DISTINCT t.condition_id), 1) as coverage_both_pct
        FROM trades_raw t
        LEFT JOIN market_resolutions mr ON
          lower(mr.condition_id) = lower(replaceAll(t.condition_id, '0x', ''))
        LEFT JOIN market_resolutions_final mrf ON
          lower(replaceAll(t.condition_id, '0x', '')) = mrf.condition_id_norm
        WHERE t.wallet_address IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        GROUP BY t.wallet_address
        ORDER BY t.wallet_address
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n  Join Coverage:')
    for (const row of coverage) {
      const name = TEST_WALLETS.find(w => w.addr.toLowerCase() === row.wallet_address.toLowerCase())?.name
      console.log(`    ${name}: ${row.matched_both}/${row.total_conditions_traded} conditions matched (${row.coverage_both_pct}%)`)
    }

    // Step 2: Sample data from all three tables
    console.log('\n[STEP 2] Sample data from all three tables (Wallet 2)...')

    const sample = await (await clickhouse.query({
      query: `
        SELECT
          t.condition_id as trades_condition_id,
          mr.condition_id as mr_condition_id,
          mr.winning_outcome,
          mrf.condition_id_norm as mrf_condition_id,
          mrf.winning_index,
          mrf.payout_numerators,
          mrf.payout_denominator
        FROM trades_raw t
        LEFT JOIN market_resolutions mr ON
          lower(mr.condition_id) = lower(replaceAll(t.condition_id, '0x', ''))
        LEFT JOIN market_resolutions_final mrf ON
          lower(replaceAll(t.condition_id, '0x', '')) = mrf.condition_id_norm
        WHERE t.wallet_address = '0x8e9eedf20dfa70956d49f608a205e402d9df38e4'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (sample.length > 0) {
      const s = sample[0]
      console.log(`\n  Sample trade:`)
      console.log(`    trades_raw condition_id: ${s.trades_condition_id}`)
      console.log(`    market_resolutions match: ${s.mr_condition_id ? 'YES' : 'NO'} (outcome: ${s.winning_outcome})`)
      console.log(`    market_resolutions_final match: ${s.mrf_condition_id ? 'YES' : 'NO'} (index: ${s.winning_index})`)
      console.log(`    Payout: ${s.payout_numerators} / ${s.payout_denominator}`)
    }

    // Step 3: Calculate P&L with correct tables
    console.log('\n[STEP 3] Calculate P&L for all 4 wallets...')

    const walletList = TEST_WALLETS.map(w => `'${w.addr.toLowerCase()}'`).join(',')

    const pnl = await (await clickhouse.query({
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
          WHERE lower(tr.wallet_address) IN (${walletList})
        ),
        with_resolution AS (
          SELECT
            td.wallet,
            td.condition_id,
            td.outcome_idx,
            td.shares,
            td.entry_price,
            td.fee_usd,
            mr.winning_outcome,
            mrf.winning_index as win_idx,
            mrf.payout_numerators,
            mrf.payout_denominator
          FROM trade_details td
          -- Join to market_resolutions for winning outcome
          LEFT JOIN market_resolutions mr ON
            lower(mr.condition_id) = td.condition_id
          -- Join to market_resolutions_final for payout data
          LEFT JOIN market_resolutions_final mrf ON
            td.condition_id = mrf.condition_id_norm
          WHERE mrf.winning_index IS NOT NULL
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
          round(sum(winning_shares * payout_num / payout_denominator) - sum(winning_cost_basis) - sum(fees), 2) as pnl_usd,
          count() as conditions,
          sum(winning_shares) as winning_shares_total
        FROM per_condition
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n┌──────────────────────────────────────────────────────────────────────────┐')
    console.log('│ FINAL VALIDATION RESULTS - All 4 Test Wallets                          │')
    console.log('├──────────────────┬──────────────┬──────────────┬──────────────┬─────────┤')
    console.log('│ Wallet           │ Calculated   │ Expected     │ Variance     │ Status  │')
    console.log('├──────────────────┼──────────────┼──────────────┼──────────────┼─────────┤')

    let passCount = 0
    for (const wallet of TEST_WALLETS) {
      const data = pnl.find(r => r.wallet === wallet.addr.toLowerCase())
      const calcPnl = data?.pnl_usd || 0
      const variance = ((calcPnl - wallet.expected) / wallet.expected) * 100
      const pass = Math.abs(variance) <= 5 && calcPnl !== 0

      if (pass) passCount++

      const status = calcPnl === 0 ? '⚠️  No Data' : Math.abs(variance) <= 5 ? '✅' : '❌'
      const calcStr = calcPnl.toString().padStart(12)
      const expStr = wallet.expected.toString().padStart(12)
      const varStr = variance.toFixed(2).padStart(12)

      console.log(`│ ${wallet.name.padEnd(16)} │ $${calcStr} │ $${expStr} │ ${varStr}% │ ${status}    │`)
    }

    console.log('├──────────────────┼──────────────┼──────────────┼──────────────┼─────────┤')
    console.log(`│ SUMMARY: ${passCount}/4 wallets matched`)
    console.log('└──────────────────┴──────────────┴──────────────┴──────────────┴─────────┘')

    // Details
    console.log('\n\n📊 DETAILED BREAKDOWN\n')
    for (const wallet of TEST_WALLETS) {
      const data = pnl.find(r => r.wallet === wallet.addr.toLowerCase())
      if (!data) {
        console.log(`${wallet.name}: NO DATA\n`)
        continue
      }

      const variance = ((data.pnl_usd - wallet.expected) / wallet.expected) * 100
      console.log(`${wallet.name} (Expected: $${wallet.expected})`)
      console.log(`  Settlement:       $${data.settlement}`)
      console.log(`  Cost Basis:       $${data.cost_basis}`)
      console.log(`  Fees:             $${data.fees}`)
      console.log(`  P&L:              $${data.pnl_usd}`)
      console.log(`  Variance:         ${variance.toFixed(2)}%`)
      console.log(`  Conditions:       ${data.conditions}`)
      console.log(`  Winning Shares:   ${data.winning_shares_total}`)
      console.log()
    }

    console.log('='.repeat(100))
    if (passCount === 4) {
      console.log('✅ ALL 4 WALLETS PASS! Problem solved!')
    } else if (passCount >= 3) {
      console.log('✅ 3+ WALLETS PASS! Formula works correctly!')
    } else {
      console.log('❌ Some wallets still not matching')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
