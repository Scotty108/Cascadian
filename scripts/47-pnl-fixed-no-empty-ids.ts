#!/usr/bin/env npx tsx

/**
 * P&L CALCULATION - FIXED
 *
 * KEY FIX: EXCLUDE trades with empty condition_id
 * These 77.4M trades cannot be calculated (no blockchain data to recover from)
 * Only calculate for the 82.1M trades that have condition_ids
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('P&L CALCULATION - FIXED (EXCLUDING EMPTY CONDITION_IDS)')
  console.log('='.repeat(100))

  // Test wallets
  const testWallets = [
    '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',  // wallet1
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',  // wallet3
    '0x6770bf688b8121331b1c5cfd7723ebd4152545fb',  // wallet4
  ]

  const expectedPNL = {
    '0x1489046ca0f9980fc2d9a950d103d3bec02c1307': 137663,
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b': 94730,
    '0x6770bf688b8121331b1c5cfd7723ebd4152545fb': 12171,
  }

  const pnlQuery = `
    SELECT
      wallet_address,
      COUNT(*) as trades_with_condition_id,
      SUM(CASE WHEN r.winning_index IS NOT NULL THEN 1 ELSE 0 END) as resolved_trades,
      SUM(CASE WHEN r.winning_index IS NOT NULL AND outcome_index = r.winning_index THEN 1 ELSE 0 END) as winning_trades,
      SUM(CASE WHEN r.winning_index IS NOT NULL AND outcome_index != r.winning_index THEN 1 ELSE 0 END) as losing_trades,
      ROUND(
        SUM(
          CASE
            WHEN outcome_index = r.winning_index
            THEN CAST(shares AS Float64) *
                 (CAST(payout_numerators[outcome_index + 1] AS Float64) / CAST(payout_denominator AS Float64)) -
                 (CAST(entry_price AS Float64) * CAST(shares AS Float64)) -
                 CAST(fee_usd AS Float64)
            ELSE -(CAST(entry_price AS Float64) * CAST(shares AS Float64)) - CAST(fee_usd AS Float64)
          END
        ), 2
      ) as realized_pnl_usd
    FROM trades_raw t
    LEFT JOIN market_resolutions_final r ON
      lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
    WHERE lower(t.wallet_address) IN (${testWallets.map(w => `'${w.toLowerCase()}'`).join(',')})
      AND t.condition_id != ''  -- KEY FIX: ONLY use trades with condition_id
    GROUP BY wallet_address
    ORDER BY wallet_address
  `

  console.log('\n[TEST] Calculating P&L (FIXED - excluding empty condition_ids)...\n')

  try {
    const results = await (await clickhouse.query({
      query: pnlQuery,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('Results:')
    console.log('─'.repeat(100))

    for (const row of results) {
      const addr = row.wallet_address.toLowerCase()
      const expected = expectedPNL[addr as keyof typeof expectedPNL] || 0
      const actual = parseFloat(row.realized_pnl_usd) || 0
      const diff = actual - expected
      const diffPct = expected !== 0 ? ((diff / expected) * 100).toFixed(1) : '∞'
      const tolerance = 5 // ±5%
      const passed = expected !== 0 && Math.abs(diff / expected) * 100 <= tolerance

      console.log(`\nWallet: ${addr.substring(0, 12)}...`)
      console.log(`  Trades with condition_id: ${row.trades_with_condition_id}`)
      console.log(`  Resolved trades: ${row.resolved_trades}`)
      console.log(`  Winning trades: ${row.winning_trades} | Losing trades: ${row.losing_trades}`)
      console.log(`  Actual P&L: $${actual.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`  Expected P&L: $${expected.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`  Difference: $${diff.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${diffPct}%)`)
      console.log(`  Status: ${passed ? '✅ PASS' : '❌ FAIL'} (tolerance: ±${tolerance}%)`)
    }

    console.log('\n' + '─'.repeat(100))
    console.log('\n[SUMMARY]')

    const allPass = results.length > 0 && results.every(row => {
      const addr = row.wallet_address.toLowerCase()
      const expected = expectedPNL[addr as keyof typeof expectedPNL] || 0
      const actual = parseFloat(row.realized_pnl_usd) || 0
      return expected !== 0 && Math.abs((actual - expected) / expected) * 100 <= 5
    })

    if (allPass && results.length === 3) {
      console.log('✅✅✅ ALL WALLETS PASS!')
      console.log('   The fix is simple:')
      console.log('   1. Normalize condition_id: strip 0x, lowercase')
      console.log('   2. EXCLUDE trades with empty condition_id (77.4M trades)')
      console.log('   3. Calculate P&L on 82.1M trades with valid condition_ids')
      console.log('')
      console.log('   READY FOR DEPLOYMENT')
    } else {
      console.log('❌ Some wallets still failing.')
    }

  } catch (e: any) {
    console.error('  ❌ Query failed:', e.message)
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
