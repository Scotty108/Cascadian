#!/usr/bin/env npx tsx

/**
 * FINAL CORRECTED P&L: Handling Data Issues
 *
 * Issues discovered:
 * 1. Wallet 2 has 1 trade with empty condition_id (need to filter these out)
 * 2. market_resolutions_final has duplicate condition_ids (need DISTINCT)
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
  console.log('FINAL CORRECTED P&L: Handling Fanout & Empty Condition IDs')
  console.log('='.repeat(100))

  try {
    const walletList = TEST_WALLETS.map(w => `'${w.addr.toLowerCase()}'`).join(',')

    // Calculate P&L with corrections:
    // 1. Filter WHERE condition_id != '' (skip empty condition_ids)
    // 2. Use DISTINCT when joining to market_resolutions_final (avoid fanout)

    const pnl = await (await clickhouse.query({
      query: `
        WITH valid_trades AS (
          SELECT
            lower(tr.wallet_address) as wallet,
            lower(replaceAll(tr.condition_id, '0x', '')) as condition_id,
            toInt16(tr.outcome_index) as outcome_idx,
            toFloat64(tr.shares) as shares,
            toFloat64(tr.entry_price) as entry_price,
            coalesce(toFloat64(tr.fee_usd), 0) as fee_usd
          FROM trades_raw tr
          WHERE lower(tr.wallet_address) IN (${walletList})
            AND tr.condition_id != ''  -- FILTER OUT EMPTY CONDITION IDs
        ),
        with_resolution AS (
          SELECT
            vt.wallet,
            vt.condition_id,
            vt.outcome_idx,
            vt.shares,
            vt.entry_price,
            vt.fee_usd,
            mrf.winning_index as win_idx,
            mrf.payout_numerators,
            mrf.payout_denominator
          FROM valid_trades vt
          -- Use DISTINCT to handle fanout in market_resolutions_final
          INNER JOIN (
            SELECT DISTINCT
              condition_id_norm,
              winning_index,
              payout_numerators,
              payout_denominator
            FROM market_resolutions_final
            WHERE winning_index IS NOT NULL
          ) mrf ON vt.condition_id = mrf.condition_id_norm
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
          round(sum(fees), 2) as fees_total,
          count() as conditions,
          round(sum(winning_shares), 2) as winning_shares_total
        FROM per_condition
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n┌──────────────────────────────────────────────────────────────────────────┐')
    console.log('│ FINAL VALIDATION - All 4 Test Wallets (CORRECTED)                       │')
    console.log('├──────────────────┬──────────────┬──────────────┬──────────────┬─────────┤')
    console.log('│ Wallet           │ Calculated   │ Expected     │ Variance     │ Status  │')
    console.log('├──────────────────┼──────────────┼──────────────┼──────────────┼─────────┤')

    let passCount = 0
    for (const wallet of TEST_WALLETS) {
      const data = pnl.find(r => r.wallet === wallet.addr.toLowerCase())
      const calcPnl = data ? (parseFloat(data.settlement) - parseFloat(data.cost_basis) - parseFloat(data.fees_total)) : 0
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
    console.log(`│ SUMMARY: ${passCount}/4 wallets matched!`)
    console.log('└──────────────────┴──────────────┴──────────────┴──────────────┴─────────┘')

    // Details
    if (passCount > 0) {
      console.log('\n📊 DETAILED BREAKDOWN\n')
      for (const wallet of TEST_WALLETS) {
        const data = pnl.find(r => r.wallet === wallet.addr.toLowerCase())
        if (!data) {
          console.log(`${wallet.name}: NO RESOLVED DATA\n`)
          continue
        }

        const pnlValue = parseFloat(data.settlement) - parseFloat(data.cost_basis) - parseFloat(data.fees_total)
        if (pnlValue === 0) {
          console.log(`${wallet.name}: NO RESOLVED DATA\n`)
          continue
        }

        const variance = ((pnlValue - wallet.expected) / wallet.expected) * 100
        console.log(`${wallet.name} (Expected: $${wallet.expected})`)
        console.log(`  Settlement:       $${data.settlement}`)
        console.log(`  Cost Basis:       $${data.cost_basis}`)
        console.log(`  Fees:             $${data.fees_total}`)
        console.log(`  P&L:              $${pnlValue.toFixed(2)}`)
        console.log(`  Variance:         ${variance.toFixed(2)}%`)
        console.log(`  Conditions:       ${data.conditions}`)
        console.log(`  Winning Shares:   ${data.winning_shares_total}`)
        console.log()
      }
    }

    console.log('='.repeat(100))
    console.log('RESULT')
    console.log('='.repeat(100))

    if (passCount === 4) {
      console.log('\n✅ SUCCESS! All 4 wallets now show correct P&L!')
      console.log('   The issue was:')
      console.log('   1. Wallet 2 had 1 trade with empty condition_id (filtered out)')
      console.log('   2. market_resolutions_final has duplicate rows (handled with DISTINCT)')
      console.log('\n   Ready to deploy to production and backfill all 900K wallets!')
    } else if (passCount >= 3) {
      console.log(`\n✅ MOSTLY SUCCESS: ${passCount}/4 wallets pass!`)
      console.log('   Formula works! Remaining wallets may have legitimate data gaps.')
    } else if (passCount === 1) {
      console.log('\n⚠️  PARTIAL SUCCESS: Only Wallet 1 passes')
      console.log('   Wallets 2-4 still have issues. Check data quality.')
    } else {
      console.log('\n❌ NO WALLETS PASSING')
      console.log('   Unexpected result. Further investigation needed.')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
