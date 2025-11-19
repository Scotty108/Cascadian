#!/usr/bin/env npx tsx

/**
 * SHADOW_V1 WALLET VALIDATION
 * Direct comparison of shadow formula against Polymarket UI values
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
  console.log('SHADOW_V1 WALLET VALIDATION - Direct Query Test')
  console.log('='.repeat(100))

  try {
    const walletList = TEST_WALLETS.map(w => `'${w.address.toLowerCase()}'`).join(',')

    console.log(`\nRunning validation query for 4 test wallets...`)

    const result = await (await clickhouse.query({
      query: `
        SELECT
          f.wallet,
          round(sum(f.cash_usd) + sumIf(p.net_shares, p.outcome_idx = w.win_idx + co.offset) * 1.00, 2) as realized_pnl_usd,
          count(distinct f.condition_id_norm) as condition_count
        FROM shadow_v1.flows_by_condition f
        INNER JOIN shadow_v1.winners w ON f.condition_id_norm = w.condition_id_norm
        LEFT JOIN shadow_v1.pos_by_condition p ON f.wallet = p.wallet AND f.condition_id_norm = p.condition_id_norm
        LEFT JOIN shadow_v1.condition_offset co ON f.condition_id_norm = co.condition_id_norm
        WHERE f.wallet IN (${walletList})
        GROUP BY f.wallet
        ORDER BY f.wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n' + '='.repeat(100))
    console.log('VALIDATION RESULTS - Shadow Formula vs Polymarket UI')
    console.log('='.repeat(100))

    let allPass = true
    const results = []

    for (const wallet of TEST_WALLETS) {
      const shadow = result.find(w => w.wallet === wallet.address.toLowerCase())
      const shadowPnl = shadow ? parseFloat(shadow.realized_pnl_usd) : 0
      const variance = ((shadowPnl - wallet.ui_pnl) / wallet.ui_pnl) * 100
      const withinThreshold = Math.abs(variance) <= 2

      console.log(`\n${wallet.address}`)
      console.log(`  Polymarket UI:     $${wallet.ui_pnl.toLocaleString()}`)
      console.log(`  Shadow Schema:     $${shadowPnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
      console.log(`  Variance:          ${variance > 0 ? '+' : ''}${variance.toFixed(2)}%`)
      console.log(`  Status:            ${withinThreshold ? '✅ PASS' : '❌ FAIL'} (threshold: ±2%)`)
      console.log(`  Conditions:        ${shadow?.condition_count || 0}`)

      results.push({
        wallet: wallet.address,
        ui_pnl: wallet.ui_pnl,
        shadow_pnl: shadowPnl,
        variance_pct: variance,
        pass: withinThreshold,
      })

      if (!withinThreshold) {
        allPass = false
      }
    }

    console.log('\n' + '='.repeat(100))
    console.log('SUMMARY')
    console.log('='.repeat(100))

    const passCount = results.filter(r => r.pass).length
    console.log(`\nWallet Validation: ${passCount}/4 PASS`)

    if (allPass) {
      console.log('\n✅ ALL WALLETS PASS - Shadow formula is correct within ±2%')
      console.log('\nNext steps:')
      console.log('  1. Run guardrail checks (G1, G2, G3)')
      console.log('  2. If guardrails pass, proceed with 87→18 consolidation')
    } else {
      console.log('\n❌ VALIDATION FAILED - Formula needs adjustment')
      results.filter(r => !r.pass).forEach(r => {
        console.log(`  • ${r.wallet}: ${Math.abs(r.variance_pct).toFixed(2)}% variance`)
      })
    }

    console.log('\n' + '='.repeat(100))

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
