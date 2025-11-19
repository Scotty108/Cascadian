#!/usr/bin/env npx tsx

/**
 * CRITICAL TEST: Calculate P&L for Wallets 3 & 4 (with COMPLETE data)
 * These wallets have 100% of their trades imported
 * If recovery is working, should show expected profits
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const WALLETS = {
  'wallet3': '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'wallet4': '0x6770bf688b8121331b1c5cfd7723ebd4152545fb',
}

const EXPECTED_PNL = {
  'wallet3': 94730,
  'wallet4': 12171,
}

async function main() {
  console.log('='.repeat(100))
  console.log('CRITICAL TEST: P&L Calculation for Wallets 3 & 4 (100% Data Coverage)')
  console.log('='.repeat(100))

  // First check: How many condition_ids are filled?
  console.log('\n[STEP 1] Condition ID coverage for Wallets 3 & 4...')

  for (const [name, addr] of Object.entries(WALLETS)) {
    const coverage = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as with_ids,
          SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_ids
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${addr}')
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const c = coverage[0]
    const pct = (parseInt(c.with_ids) / parseInt(c.total) * 100).toFixed(1)
    console.log(`  ${name.toUpperCase()}: ${c.with_ids}/${c.total} trades have condition_ids (${pct}%)`)
  }

  // Calculate P&L using ORIGINAL data (no recovery yet)
  console.log('\n[STEP 2] Calculate P&L from CURRENT trades_raw (original data)...')

  const pnlQuery = `
    WITH wallet_trades AS (
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        CAST(shares AS Float64) as shares_f,
        CAST(entry_price AS Float64) as entry_price_f,
        CAST(fee_usd AS Float64) as fee_usd_f,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${Object.values(WALLETS).map(w => w.toLowerCase()).join("','")}')
      AND condition_id != ''
    )
    SELECT
      wt.wallet_address,
      COUNT(*) as total_with_ids,
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
                THEN shares_f * (CAST(payout_numerators[outcome_index + 1] AS Float64) / CAST(payout_denominator AS Float64)) - (entry_price_f * shares_f) - fee_usd_f
                ELSE -(entry_price_f * shares_f) - fee_usd_f
              END
            ELSE 0
          END
        ), 2
      ) as realized_pnl_usd
    FROM wallet_trades wt
    LEFT JOIN market_resolutions_final r ON wt.condition_id_norm = r.condition_id_norm
    GROUP BY wallet_address
    ORDER BY wallet_address
  `

  try {
    const results = await (await clickhouse.query({
      query: pnlQuery,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n[RESULTS] P&L Comparison:')
    console.log('─'.repeat(100))

    for (const row of results) {
      const addr = row.wallet_address.toLowerCase()
      const walletName = Object.entries(WALLETS).find(([_, w]) => w.toLowerCase() === addr)?.[0] || 'UNKNOWN'
      const expected = EXPECTED_PNL[walletName as keyof typeof EXPECTED_PNL] || 0
      const actual = parseFloat(row.realized_pnl_usd) || 0
      const diff = actual - expected
      const diffPct = expected !== 0 ? ((diff / expected) * 100).toFixed(1) : '∞'

      console.log(`\n${walletName.toUpperCase()}: ${addr.substring(0, 12)}...`)
      console.log(`  Trades with condition_ids: ${row.total_with_ids}`)
      console.log(`  Resolved: ${row.resolved_trades}, Winning: ${row.winning_trades}, Losing: ${row.losing_trades}`)
      console.log(`  Actual P&L: $${actual.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`  Expected P&L: $${expected.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`  Difference: $${diff.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${diffPct}%)`)

      // Determine status
      const withinTolerance = expected !== 0 && Math.abs(diff / expected) * 100 <= 5
      const status = withinTolerance ? '✅ PASS' : '❌ FAIL'
      console.log(`  Status: ${status}`)
    }

    console.log('\n' + '─'.repeat(100))
    console.log('\n[CONCLUSION]')

    const allResults = Object.fromEntries(
      results.map(row => {
        const addr = row.wallet_address.toLowerCase()
        const name = Object.entries(WALLETS).find(([_, w]) => w.toLowerCase() === addr)?.[0] || 'UNKNOWN'
        const expected = EXPECTED_PNL[name as keyof typeof EXPECTED_PNL] || 0
        const actual = parseFloat(row.realized_pnl_usd) || 0
        const withinTolerance = expected !== 0 && Math.abs((actual - expected) / expected) * 100 <= 5
        return [name, withinTolerance]
      })
    )

    if (Object.values(allResults).every(v => v === true)) {
      console.log('✅ SUCCESS: Wallets 3 & 4 P&L MATCHES expected values!')
      console.log('   → Recovery formula is CORRECT')
      console.log('   → Condition IDs are being recovered properly')
      console.log('   → Ready to proceed with Phase B batch recovery')
    } else {
      console.log('❌ FAILURE: P&L does not match for wallets with complete data')
      console.log('   → Recovery formula may be incorrect')
      console.log('   → OR condition_id matching is wrong')
      console.log('   → Need to debug further')
    }

  } catch (e: any) {
    console.error('  ❌ Query failed:', e.message)
    return
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
