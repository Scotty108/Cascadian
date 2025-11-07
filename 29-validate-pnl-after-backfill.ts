#!/usr/bin/env npx tsx

/**
 * VALIDATE P&L AFTER BACKFILL
 *
 * Now that we've backfilled the missing resolutions, re-run P&L calculation
 * for all 4 test wallets and see if wallets 2-4 now match their expected values.
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

async function main() {
  console.log('='.repeat(100))
  console.log('VALIDATE P&L AFTER BACKFILL - All 4 Test Wallets')
  console.log('='.repeat(100))

  const walletList = TEST_WALLETS.map(w => `'${w.addr.toLowerCase()}'`).join(',')

  // Calculate P&L with corrected formula (settlement - cost_basis - fees)
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
          AND tr.condition_id != ''
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
        INNER JOIN market_resolutions_final mrf ON
          toString(lower(td.condition_id)) = toString(mrf.condition_id_norm)
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
        round(sum(fees), 2) as fees_total,
        round(sum(winning_shares * payout_num / payout_denominator) - sum(winning_cost_basis) - sum(fees), 2) as pnl_usd,
        count() as conditions,
        round(sum(winning_shares), 2) as winning_shares_total
      FROM per_condition
      GROUP BY wallet
      ORDER BY wallet
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  console.log('\n┌──────────────────────────────────────────────────────────────────────────┐')
  console.log('│ FINAL VALIDATION - All 4 Test Wallets (AFTER BACKFILL)                   │')
  console.log('├──────────────────┬──────────────┬──────────────┬──────────────┬─────────┤')
  console.log('│ Wallet           │ Calculated   │ Expected     │ Variance %   │ Status  │')
  console.log('├──────────────────┼──────────────┼──────────────┼──────────────┼─────────┤')

  let passCount = 0
  for (const wallet of TEST_WALLETS) {
    const data = pnl.find(r => r.wallet === wallet.addr.toLowerCase())
    const calcPnl = data ? parseFloat(data.pnl_usd) : 0
    const variance = wallet.expected !== 0 ? ((calcPnl - wallet.expected) / wallet.expected) * 100 : 0
    const pass = Math.abs(variance) <= 5 && calcPnl !== 0

    if (pass) passCount++

    const status = calcPnl === 0 ? '⚠️  $0' : Math.abs(variance) <= 5 ? '✅' : '❌'
    const calcStr = calcPnl.toString().padStart(12)
    const expStr = wallet.expected.toString().padStart(12)
    const varStr = variance.toFixed(2).padStart(12)

    console.log(`│ ${wallet.name.padEnd(16)} │ $${calcStr} │ $${expStr} │ ${varStr}  │ ${status}     │`)
  }

  console.log('├──────────────────┼──────────────┼──────────────┼──────────────┼─────────┤')
  console.log(`│ SUMMARY: ${passCount}/4 wallets matched`)
  console.log('└──────────────────┴──────────────┴──────────────┴──────────────┴─────────┘')

  // Detailed breakdown
  if (passCount > 0) {
    console.log('\n📊 DETAILED BREAKDOWN\n')
    for (const wallet of TEST_WALLETS) {
      const data = pnl.find(r => r.wallet === wallet.addr.toLowerCase())
      if (!data || parseFloat(data.pnl_usd) === 0) {
        console.log(`${wallet.name}: NO RESOLVED DATA\n`)
        continue
      }

      const pnlValue = parseFloat(data.pnl_usd)
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
    console.log('   The issue was simply missing resolution data in market_resolutions_final')
    console.log('\n   Ready to deploy to production and backfill all 900K wallets!')
  } else if (passCount >= 3) {
    console.log(`\n✅ MOSTLY SUCCESS: ${passCount}/4 wallets pass!`)
    console.log('   Formula works correctly. Some wallets may have data quality issues.')
  } else if (passCount === 1) {
    console.log('\n⚠️  PARTIAL SUCCESS: Only Wallet 1 passes')
    console.log('   Wallets 2-4 still show issues after backfill.')
    console.log('   Possible cause: Standard binary payout assumption [1,0]/1 is wrong')
    console.log('   These markets may have 3+ outcomes or custom payout structures.')
  } else {
    console.log('\n❌ NO IMPROVEMENT AFTER BACKFILL')
    console.log('   Wallets 2-4 still show $0 or incorrect values')
    console.log('   The payout structure assumption may be incorrect.')
  }
}

main().catch(e => console.error('Error:', e))
