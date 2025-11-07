#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('='.repeat(100))
  console.log('Testing trades_raw.realized_pnl_usd as source')
  console.log('='.repeat(100))

  try {
    const wallets = [
      { addr: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', expected: 137663 },
      { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', expected: 360492 },
      { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', expected: 94730 },
      { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', expected: 12171 },
    ]

    const walletList = wallets.map(w => `'${w.addr.toLowerCase()}'`).join(',')

    console.log('\nMethod: SUM(trades_raw.realized_pnl_usd) for RESOLVED trades only')

    const result = await (await clickhouse.query({
      query: `
        SELECT
          lower(wallet_address) as wallet,
          round(sum(realized_pnl_usd), 2) as realized_pnl,
          count() as trade_count,
          countIf(is_resolved = 1) as resolved_count
        FROM trades_raw
        WHERE lower(wallet_address) IN (${walletList})
          AND is_resolved = 1
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n' + '='.repeat(100))
    console.log('TRADES_RAW VALIDATION')
    console.log('='.repeat(100))

    let allPass = true
    for (const wallet of wallets) {
      const row = result.find(r => r.wallet === wallet.addr.toLowerCase())
      const pnl = row ? parseFloat(row.realized_pnl) : 0
      const variance = ((pnl - wallet.expected) / wallet.expected) * 100
      const pass = Math.abs(variance) <= 2

      console.log(`\n${wallet.addr}`)
      console.log(`  Expected: $${wallet.expected.toLocaleString()}`)
      console.log(`  trades_raw: $${pnl.toLocaleString('en-US', {maximumFractionDigits: 2})}`)
      console.log(`  Variance: ${variance > 0 ? '+' : ''}${variance.toFixed(2)}%`)
      console.log(`  Status: ${pass ? '✅ PASS' : '❌ FAIL'}`)
      if (row) {
        console.log(`  Resolved trades: ${row.resolved_count}/${row.trade_count}`)
      }

      if (!pass) allPass = false
    }

    console.log('\n' + '='.repeat(100))
    const passCount = result.filter(r => {
      const expected = wallets.find(w => w.addr.toLowerCase() === r.wallet)?.expected
      if (!expected) return false
      const variance = ((parseFloat(r.realized_pnl) - expected) / expected) * 100
      return Math.abs(variance) <= 2
    }).length

    console.log(`\nResult: ${passCount}/4 PASS`)
    if (allPass) {
      console.log('✅ trades_raw.realized_pnl_usd is the correct source!')
    } else {
      console.log('❌ Still not matching. Need to investigate further.')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
