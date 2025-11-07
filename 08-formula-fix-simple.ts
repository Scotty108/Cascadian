#!/usr/bin/env npx tsx

/**
 * FORMULA FIX: Direct comparison of Variant A vs B
 * Simplifiedapproach - no intermediate views
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const TEST_WALLETS = [
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663, ui_gains: 145976, ui_losses: 8313 },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492, ui_gains: 366546, ui_losses: 6054 },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, ui_gains: 205410, ui_losses: 110680 },
  { address: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171, ui_gains: 16715, ui_losses: 4544 },
]

async function execute() {
  console.log('='.repeat(100))
  console.log('FORMULA FIX: Direct Variant A vs B Testing')
  console.log('='.repeat(100))

  try {
    // Test both variants with simpler logic
    console.log('\n[VARIANT A TEST]')
    const variantA = await (await clickhouse.query({
      query: `
        SELECT
          'A' as variant,
          lower(wallet_address) as wallet,
          round(sum(
            (- toFloat64(entry_price) * toFloat64(shares) - coalesce(toFloat64(fee_usd), 0))
          ), 2) as cash_and_fees,
          count() as trade_count
        FROM trades_raw
        WHERE lower(wallet_address) IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        AND lower(replaceAll(condition_id, '0x', '')) IN (
          SELECT condition_id_norm FROM market_resolutions_final WHERE winning_index IS NOT NULL
        )
        GROUP BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('[VARIANT B TEST]')
    const variantB = await (await clickhouse.query({
      query: `
        SELECT
          'B' as variant,
          lower(wallet_address) as wallet,
          round(sum(
            (toFloat64(entry_price) * toFloat64(shares) - coalesce(toFloat64(fee_usd), 0))
          ), 2) as cash_and_fees,
          count() as trade_count
        FROM trades_raw
        WHERE lower(wallet_address) IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        AND lower(replaceAll(condition_id, '0x', '')) IN (
          SELECT condition_id_norm FROM market_resolutions_final WHERE winning_index IS NOT NULL
        )
        GROUP BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n' + '='.repeat(100))
    console.log('CASH FLOWS ONLY (without settlement)')
    console.log('='.repeat(100))

    console.log('\nVariant A (cash = -price × shares):')
    for (const row of variantA) {
      console.log(`  ${row.wallet.substring(0, 12)}... : $${row.cash_and_fees}`)
    }

    console.log('\nVariant B (cash = price × shares):')
    for (const row of variantB) {
      console.log(`  ${row.wallet.substring(0, 12)}... : $${row.cash_and_fees}`)
    }

    // Settlement only
    console.log('\n' + '='.repeat(100))
    console.log('SETTLEMENT VALUE ONLY')
    console.log('='.repeat(100))

    const settlement = await (await clickhouse.query({
      query: `
        SELECT
          lower(tr.wallet_address) as wallet,
          round(sum(
            if(toInt16(tr.outcome_index) = w.win_idx, toFloat64(tr.shares), 0)
            * (w.payout_num / w.payout_denom)
          ), 2) as settlement_value
        FROM trades_raw tr
        JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
        JOIN (
          SELECT condition_id_norm, toInt16(winning_index) as win_idx,
                 arrayElement(payout_numerators, toInt16(winning_index) + 1) as payout_num,
                 toFloat64(payout_denominator) as payout_denom
          FROM market_resolutions_final WHERE winning_index IS NOT NULL
        ) w ON mrf.condition_id_norm = w.condition_id_norm
        WHERE lower(tr.wallet_address) IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\nSettlement (winning shares × payout):')
    for (const row of settlement) {
      console.log(`  ${row.wallet.substring(0, 12)}... : $${row.settlement_value}`)
    }

    // Now test combinations
    console.log('\n' + '='.repeat(100))
    console.log('COMBINATION TESTS')
    console.log('='.repeat(100))

    // A + Settlement
    console.log('\n[Test 1] Variant A cash + Settlement')
    for (const w of TEST_WALLETS) {
      const a = variantA.find(r => r.wallet === w.address.toLowerCase())
      const s = settlement.find(r => r.wallet === w.address.toLowerCase())
      const total = (parseFloat(a?.cash_and_fees || 0) + parseFloat(s?.settlement_value || 0))
      const variance = ((total - w.ui_pnl) / w.ui_pnl) * 100
      const pass = Math.abs(variance) <= 2
      console.log(`  ${w.address.substring(0, 12)}... | UI: $${w.ui_pnl} | Calc: $${total.toFixed(2)} | Var: ${variance.toFixed(2)}% | ${pass ? '✅' : '❌'}`)
    }

    // B + Settlement
    console.log('\n[Test 2] Variant B cash + Settlement')
    for (const w of TEST_WALLETS) {
      const b = variantB.find(r => r.wallet === w.address.toLowerCase())
      const s = settlement.find(r => r.wallet === w.address.toLowerCase())
      const total = (parseFloat(b?.cash_and_fees || 0) + parseFloat(s?.settlement_value || 0))
      const variance = ((total - w.ui_pnl) / w.ui_pnl) * 100
      const pass = Math.abs(variance) <= 2
      console.log(`  ${w.address.substring(0, 12)}... | UI: $${w.ui_pnl} | Calc: $${total.toFixed(2)} | Var: ${variance.toFixed(2)}% | ${pass ? '✅' : '❌'}`)
    }

    console.log('\n' + '='.repeat(100))

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
