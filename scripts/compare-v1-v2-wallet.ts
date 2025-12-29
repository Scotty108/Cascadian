/**
 * Compare V1 vs V2 PnL for specific wallet
 * Quantifies the impact of CTF events
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function compareV1V2() {
  console.log('🔍 Comparing V1 vs V2 PnL\n')
  console.log('='.repeat(80))
  console.log(`\nWallet: ${WALLET}\n`)
  console.log('='.repeat(80))

  try {
    // Overall V1 vs V2 comparison
    console.log('\n📊 Overall PnL Comparison\n')

    const overallResult = await clickhouse.query({
      query: `
        SELECT 'V1' AS version, sum(realized_pnl) AS total_pnl, count(DISTINCT condition_id) AS markets
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
        UNION ALL
        SELECT 'V2' AS version, sum(realized_pnl) AS total_pnl, count(DISTINCT condition_id) AS markets
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const overall = await overallResult.json() as Array<{
      version: string
      total_pnl: number
      markets: string
    }>

    console.log('Version | Markets | Total PnL')
    console.log('-'.repeat(45))
    overall.forEach(row => {
      const version = row.version.padEnd(7)
      const markets = parseInt(row.markets).toString().padStart(7)
      const pnl = row.total_pnl !== null ? `$${row.total_pnl.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
      console.log(`${version} | ${markets} | ${pnl}`)
    })

    const v1 = overall.find(r => r.version === 'V1')
    const v2 = overall.find(r => r.version === 'V2')

    if (v1 && v2) {
      const delta = v2.total_pnl - v1.total_pnl
      console.log(`\nDifference (V2 - V1): $${delta.toFixed(2)}`)

      if (Math.abs(delta) < 0.01) {
        console.log('✅ NO DIFFERENCE - CTF events have no impact on this wallet')
        console.log('   (Wallet has no CTF events as confirmed earlier)')
      } else {
        console.log(`⚠️  DIFFERENCE FOUND: $${Math.abs(delta).toFixed(2)}`)
        console.log('   CTF events are affecting PnL calculation')
      }
    }

    // Market-by-market delta
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Market-by-Market Delta Analysis (Top 20)\n')

    const marketDeltaResult = await clickhouse.query({
      query: `
        WITH combined AS (
          SELECT 'V1' AS version, condition_id, realized_pnl
          FROM vw_pm_realized_pnl_v1
          WHERE wallet_address = '${WALLET}'
            AND is_resolved = 1

          UNION ALL

          SELECT 'V2' AS version, condition_id, realized_pnl
          FROM vw_pm_realized_pnl_v2
          WHERE wallet_address = '${WALLET}'
            AND is_resolved = 1
        )
        SELECT
          condition_id,
          sumIf(realized_pnl, version='V1') AS pnl_v1,
          sumIf(realized_pnl, version='V2') AS pnl_v2,
          pnl_v2 - pnl_v1 AS delta
        FROM combined
        GROUP BY condition_id
        HAVING abs(delta) > 0.01
        ORDER BY abs(delta) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })
    const marketDelta = await marketDeltaResult.json() as Array<{
      condition_id: string
      pnl_v1: number
      pnl_v2: number
      delta: number
    }>

    if (marketDelta.length > 0) {
      console.log('Market (first 24)       | PnL V1      | PnL V2      | Delta')
      console.log('-'.repeat(75))
      marketDelta.forEach(row => {
        const market = row.condition_id.slice(0, 23).padEnd(23)
        const v1 = `$${row.pnl_v1.toFixed(2)}`.padStart(11)
        const v2 = `$${row.pnl_v2.toFixed(2)}`.padStart(11)
        const delta = `$${row.delta.toFixed(2)}`.padStart(7)
        console.log(`${market} | ${v1} | ${v2} | ${delta}`)
      })

      console.log(`\n⚠️  Found ${marketDelta.length} markets with PnL differences`)
      console.log('   Investigating CTF impact on these markets...')
    } else {
      console.log('✅ NO market-level differences found')
      console.log('   V1 and V2 calculations are identical for this wallet')
    }

    // Check if wallet has any CTF events (should be 0)
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 CTF Event Summary for Wallet\n')

    const ctfSummaryResult = await clickhouse.query({
      query: `
        SELECT
          event_type,
          count() as events,
          sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_units
        FROM pm_ctf_events
        WHERE lower(user_address) = '${WALLET}'
          AND is_deleted = 0
        GROUP BY event_type
      `,
      format: 'JSONEachRow'
    })
    const ctfSummary = await ctfSummaryResult.json() as Array<{
      event_type: string
      events: string
      total_units: number
    }>

    if (ctfSummary.length > 0) {
      console.log('Event Type       | Count | Total Units')
      console.log('-'.repeat(50))
      ctfSummary.forEach(row => {
        const type = row.event_type.padEnd(16)
        const count = parseInt(row.events).toString().padStart(5)
        const units = row.total_units.toFixed(2).padStart(11)
        console.log(`${type} | ${count} | ${units}`)
      })
    } else {
      console.log('✅ Confirmed: Wallet has NO CTF events')
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 SUMMARY\n')
    console.log('V1 vs V2 Comparison Results:')
    if (v1 && v2) {
      console.log(`  V1 PnL: $${v1.total_pnl.toFixed(2)} (${parseInt(v1.markets)} markets)`)
      console.log(`  V2 PnL: $${v2.total_pnl.toFixed(2)} (${parseInt(v2.markets)} markets)`)
      console.log(`  Delta:  $${(v2.total_pnl - v1.total_pnl).toFixed(2)}`)
    }
    console.log()
    console.log('Remaining gap to Polymarket UI (~$96,000):')
    if (v2) {
      console.log(`  $${(96000 - v2.total_pnl).toFixed(2)} unexplained`)
      console.log()
      console.log('Possible causes:')
      console.log('  1. Market count difference (UI: 92, V2: ' + parseInt(v2.markets) + ')')
      console.log('  2. Different data sources')
      console.log('  3. Different market filtering logic')
      console.log('  4. Unrealized PnL included in UI')
    }
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

compareV1V2()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
