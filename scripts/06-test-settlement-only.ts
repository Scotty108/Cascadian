#!/usr/bin/env npx tsx

/**
 * TEST: Is P&L = Settlement ONLY (no cashflows)?
 *
 * Hypothesis: P&L = winning_shares × (payout_num / payout_denom)
 * Not: cashflow + settlement
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
  console.log('FORMULA TEST: P&L = Settlement Only (no cashflows)')
  console.log('='.repeat(100))

  try {
    // Create test views in shadow
    console.log('\n[Setup] Creating settlement-only test schema...')
    await clickhouse.command({ query: `DROP DATABASE IF EXISTS test_settlement` })
    await clickhouse.command({ query: `CREATE DATABASE IF NOT EXISTS test_settlement` })

    // Build position + settlement aggregation (simplified)
    console.log('[1] Building settlement aggregation...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW test_settlement.pnl_settlement_only AS
      SELECT
        wallet,
        round(sum(settlement_value), 2) as pnl_settlement_only
      FROM (
        SELECT
          lower(p.wallet_address) as wallet,
          p.condition_id,
          sum(if(p.outcome_index = w.win_idx, toFloat64(p.shares), 0)) * (w.payout_num / w.payout_denom) as settlement_value
        FROM (
          SELECT lower(wallet_address) as wallet_address, condition_id, outcome_index, shares
          FROM trades_raw
        ) p
        INNER JOIN (
          SELECT condition_id_norm, toInt16(winning_index) as win_idx,
                 arrayElement(payout_numerators, toInt16(winning_index) + 1) as payout_num,
                 toFloat64(payout_denominator) as payout_denom
          FROM market_resolutions_final
        ) w ON lower(replaceAll(p.condition_id, '0x', '')) = w.condition_id_norm
        GROUP BY p.wallet_address, p.condition_id, w.payout_num, w.payout_denom, w.win_idx
      )
      GROUP BY wallet
    ` })
    console.log('✅ View created')

    // Validate against 4 test wallets
    console.log('\n[2] Validating settlement-only formula...')
    const results = await (await clickhouse.query({
      query: `
        SELECT wallet, pnl_settlement_only
        FROM test_settlement.pnl_settlement_only
        WHERE wallet IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        ORDER BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n' + '='.repeat(100))
    console.log('RESULTS')
    console.log('='.repeat(100))

    let passCount = 0
    for (const wallet of TEST_WALLETS) {
      const dbRow = results.find(r => r.wallet === wallet.address.toLowerCase())
      const calculated = dbRow ? parseFloat(dbRow.pnl_settlement_only) : 0
      const variance = wallet.ui_pnl !== 0 ? ((calculated - wallet.ui_pnl) / wallet.ui_pnl) * 100 : 0
      const pass = Math.abs(variance) <= 2

      console.log(`\n${wallet.address}`)
      console.log(`  UI Value:       $${wallet.ui_pnl.toLocaleString('en-US')}`)
      console.log(`  Settlement-Only: $${calculated.toLocaleString('en-US', {maximumFractionDigits: 2})}`)
      console.log(`  Variance:       ${variance > 0 ? '+' : ''}${variance.toFixed(2)}%`)
      console.log(`  Status:         ${pass ? '✅ PASS' : '❌ FAIL'}`)

      if (pass) passCount++
    }

    console.log('\n' + '='.repeat(100))
    if (passCount === 4) {
      console.log('✅ SUCCESS: P&L = Settlement Only formula works!')
      console.log('Formula: pnl_usd = sum(winning_shares × payout_value)')
      console.log('NO cashflow component needed.')
    } else if (passCount > 0) {
      console.log(`⚠️ Partial match: ${passCount}/4 wallets passed`)
      console.log('Settlement-only formula is close but not exact.')
      console.log('Might need offset adjustment for some conditions.')
    } else {
      console.log('❌ Settlement-only formula does NOT match.')
      console.log('P&L calculation requires more complex formula.')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
