#!/usr/bin/env npx tsx

/**
 * THE REAL FIX: Calculate P&L using ONLY trades with condition_id populated
 * No recovery. No JOIN cardinality issues. Just use the data we have.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const WALLETS = {
  'wallet1': '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
  'wallet3': '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'wallet4': '0x6770bf688b8121331b1c5cfd7723ebd4152545fb',
}

const EXPECTED_PNL = {
  'wallet1': 137663,
  'wallet3': 94730,
  'wallet4': 12171,
}

async function main() {
  console.log('='.repeat(100))
  console.log('THE REAL FIX: P&L Using ONLY Trades with Existing Condition IDs')
  console.log('='.repeat(100))

  // Simple calculation: Only use trades with condition_ids already populated
  const pnlQuery = `
    SELECT
      wallet_address,
      COUNT(*) as trades_with_ids,
      COUNT(CASE WHEN r.winning_index IS NOT NULL THEN 1 END) as resolved_trades,
      COUNT(CASE WHEN r.winning_index IS NOT NULL AND outcome_index = r.winning_index THEN 1 END) as winning_trades,
      COUNT(CASE WHEN r.winning_index IS NOT NULL AND outcome_index != r.winning_index THEN 1 END) as losing_trades,
      ROUND(
        SUM(
          CASE
            WHEN r.winning_index IS NOT NULL
            THEN
              CASE
                WHEN outcome_index = r.winning_index
                THEN CAST(shares AS Float64) *
                     (CAST(payout_numerators[outcome_index + 1] AS Float64) / CAST(payout_denominator AS Float64)) -
                     (CAST(entry_price AS Float64) * CAST(shares AS Float64)) -
                     CAST(fee_usd AS Float64)
                ELSE -(CAST(entry_price AS Float64) * CAST(shares AS Float64)) - CAST(fee_usd AS Float64)
              END
            ELSE 0
          END
        ), 2
      ) as realized_pnl_usd
    FROM trades_raw t
    LEFT JOIN market_resolutions_final r ON
      lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
    WHERE t.condition_id != ''
      AND lower(t.wallet_address) IN ('${Object.values(WALLETS).map(w => w.toLowerCase()).join("','")}')
    GROUP BY wallet_address
    ORDER BY wallet_address
  `

  try {
    const results = await (await clickhouse.query({
      query: pnlQuery,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n[RESULTS] P&L Using Existing Condition IDs:')
    console.log('─'.repeat(100))

    const results_obj: {[key: string]: any} = {}

    for (const row of results) {
      const addr = row.wallet_address.toLowerCase()
      const walletName = Object.entries(WALLETS).find(([_, w]) => w.toLowerCase() === addr)?.[0] || 'UNKNOWN'
      const expected = EXPECTED_PNL[walletName as keyof typeof EXPECTED_PNL] || 0
      const actual = parseFloat(row.realized_pnl_usd) || 0
      const diff = actual - expected
      const diffPct = expected !== 0 ? ((diff / expected) * 100).toFixed(1) : '∞'
      const withinTolerance = expected !== 0 && Math.abs(diff / expected) * 100 <= 5

      results_obj[walletName] = {
        actual,
        expected,
        withinTolerance,
        trades: row.trades_with_ids,
        resolved: row.resolved_trades,
        winning: row.winning_trades,
        losing: row.losing_trades,
      }

      const status = withinTolerance ? '✅' : '❌'

      console.log(`\n${status} ${walletName.toUpperCase()}: ${addr.substring(0, 12)}...`)
      console.log(`   Trades with condition_id: ${row.trades_with_ids}`)
      console.log(`   Resolved: ${row.resolved_trades} | Winning: ${row.winning_trades} | Losing: ${row.losing_trades}`)
      console.log(`   Actual P&L: $${actual.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`   Expected P&L: $${expected.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`   Difference: $${diff.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${diffPct}%)`)
    }

    console.log('\n' + '─'.repeat(100))
    console.log('\n[SUMMARY]')

    const allPass = Object.values(results_obj).every(r => r.withinTolerance)

    if (allPass) {
      console.log('✅ SUCCESS: All wallets match expected P&L!')
      console.log('   This proves the formula works when using only existing condition_ids')
      console.log('   No recovery needed. Deploy immediately.')
    } else {
      console.log('Status by wallet:')
      for (const [name, data] of Object.entries(results_obj)) {
        const status = data.withinTolerance ? '✅' : '❌'
        console.log(`   ${status} ${name}: $${data.actual.toLocaleString('en-US', {maximumFractionDigits: 0})} vs $${data.expected.toLocaleString('en-US', {maximumFractionDigits: 0})}`)
      }
    }

  } catch (e: any) {
    console.error('  ❌ Query failed:', e.message)
    return
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
