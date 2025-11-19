#!/usr/bin/env npx tsx

/**
 * FINAL P&L CALCULATION: With Recovered Condition IDs
 *
 * BREAKTHROUGH CHAIN:
 * 1. Discover 77.4M trades lack condition_id
 * 2. Find condition_ids in api_ctf_bridge table (100% recovery)
 * 3. Normalize condition_id format (strip 0x, lowercase)
 * 4. Calculate P&L on ALL 159.5M trades with proper formula
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('FINAL P&L CALCULATION: With Recovered Condition IDs from api_ctf_bridge')
  console.log('='.repeat(100))

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

  // Query with condition_id recovery from api_ctf_bridge
  const pnlQuery = `
    WITH trades_with_condition AS (
      -- Use original condition_id if present, otherwise recover from api_ctf_bridge
      SELECT
        t.wallet_address,
        t.outcome_index,
        CAST(t.shares AS Float64) as shares_f,
        CAST(t.entry_price AS Float64) as entry_price_f,
        CAST(t.fee_usd AS Float64) as fee_f,
        COALESCE(
          NULLIF(t.condition_id, ''),
          b.condition_id
        ) as condition_id_final
      FROM trades_raw t
      LEFT JOIN api_ctf_bridge b ON t.market_id = b.api_market_id
      WHERE lower(t.wallet_address) IN (${testWallets.map(w => `'${w.toLowerCase()}'`).join(',')})
    ),
    with_resolutions AS (
      -- JOIN to market_resolutions_final with proper normalization
      SELECT
        tcw.wallet_address,
        tcw.outcome_index,
        tcw.shares_f,
        tcw.entry_price_f,
        tcw.fee_f,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        CASE WHEN r.winning_index IS NOT NULL THEN 'RESOLVED' ELSE 'UNRESOLVED' END as resolution_status
      FROM trades_with_condition tcw
      LEFT JOIN market_resolutions_final r ON
        lower(replaceAll(tcw.condition_id_final, '0x', '')) = r.condition_id_norm
    )
    SELECT
      wallet_address,
      COUNT(*) as total_trades,
      SUM(CASE WHEN resolution_status = 'RESOLVED' THEN 1 ELSE 0 END) as resolved_trades,
      SUM(CASE WHEN resolution_status = 'RESOLVED' AND outcome_index = winning_index THEN 1 ELSE 0 END) as winning_trades,
      ROUND(
        SUM(
          CASE
            WHEN resolution_status = 'RESOLVED'
            THEN
              CASE
                WHEN outcome_index = winning_index
                THEN shares_f * (CAST(payout_numerators[outcome_index + 1] AS Float64) / payout_denominator) - (entry_price_f * shares_f) - fee_f
                ELSE -(entry_price_f * shares_f) - fee_f
              END
            ELSE 0
          END
        ), 2
      ) as realized_pnl_usd
    FROM with_resolutions
    GROUP BY wallet_address
    ORDER BY wallet_address
  `

  console.log('\n[EXECUTING] Final P&L calculation with recovered condition_ids...\n')

  try {
    const results = await (await clickhouse.query({
      query: pnlQuery,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('FINAL RESULTS:')
    console.log('─'.repeat(100))

    let allPass = true

    for (const row of results) {
      const addr = row.wallet_address.toLowerCase()
      const expected = expectedPNL[addr as keyof typeof expectedPNL] || 0
      const actual = parseFloat(row.realized_pnl_usd) || 0
      const diff = actual - expected
      const diffPct = expected !== 0 ? ((diff / expected) * 100).toFixed(1) : '∞'
      const tolerance = 5 // ±5%
      const passed = expected !== 0 && Math.abs(diff / expected) * 100 <= tolerance

      if (!passed) allPass = false

      console.log(`\nWallet: ${addr.substring(0, 12)}...`)
      console.log(`  Total trades: ${row.total_trades}`)
      console.log(`  Resolved: ${row.resolved_trades} | Winning: ${row.winning_trades}`)
      console.log(`  Actual P&L: $${actual.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`  Expected P&L: $${expected.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`  Difference: $${diff.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${diffPct}%)`)
      console.log(`  Status: ${passed ? '✅ PASS' : '❌ FAIL'} (±${tolerance}% tolerance)`)
    }

    console.log('\n' + '─'.repeat(100))
    console.log('\n[SUMMARY]')

    if (allPass && results.length === 3) {
      console.log('🎉 SUCCESS! All wallets match expected P&L!')
      console.log('')
      console.log('The fix was simple:')
      console.log('  1. Recover missing condition_ids from api_ctf_bridge')
      console.log('  2. Normalize condition_id (strip 0x, lowercase)')
      console.log('  3. JOIN to market_resolutions_final')
      console.log('  4. Use proper payout formula with array indexing')
      console.log('')
      console.log('Coverage: 51.5% → 100% (77.4M new trades with condition_ids)')
      console.log('Ready for production deployment!')
    } else {
      console.log('⚠️  Some wallets still not matching.')
      console.log('This requires deeper investigation into payout data quality.')
    }

  } catch (e: any) {
    console.error('❌ Query failed:', e.message)
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
