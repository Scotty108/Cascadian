/**
 * Check condition_id format issues
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const MARKET = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function checkFormats() {
  console.log('🔍 Checking Condition ID Format Issues\n')
  console.log('='.repeat(80))

  try {
    // Check if market exists in pm_condition_resolutions with different formats
    console.log('\n📊 Searching for Market in pm_condition_resolutions\n')
    console.log(`Target: ${MARKET}\n`)

    const searchResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          lower(condition_id) as lowered,
          payout_numerators,
          is_deleted
        FROM pm_condition_resolutions
        WHERE lower(condition_id) LIKE '%${MARKET.slice(0, 20)}%'
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const results = await searchResult.json() as Array<{
      condition_id: string
      lowered: string
      payout_numerators: string
      is_deleted: number
    }>

    if (results.length > 0) {
      console.log('Found matches:')
      console.log('Condition ID (raw)                                                       | Lowered | Payouts     | Deleted')
      console.log('-'.repeat(120))
      results.forEach(row => {
        const condId = row.condition_id.padEnd(72)
        const lowered = row.lowered === MARKET ? '✅ MATCH' : 'diff'
        const payouts = row.payout_numerators.padEnd(11)
        const deleted = row.is_deleted === 1 ? 'YES' : 'NO'
        console.log(`${condId} | ${lowered.padEnd(7)} | ${payouts} | ${deleted}`)
      })
    } else {
      console.log('❌ NO matches found for this market')
      console.log('   Market does not exist in pm_condition_resolutions')
    }

    // Check if market exists in vw_pm_ledger (trades)
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Check if Wallet Traded This Market\n')

    const tradesResult = await clickhouse.query({
      query: `
        SELECT
          count() as trade_count,
          sum(cash_delta_usdc) as total_cash,
          sum(shares_delta) as total_shares,
          any(condition_id) as condition_id_sample
        FROM vw_pm_ledger
        WHERE wallet_address = '${WALLET}'
          AND lower(condition_id) = '${MARKET}'
      `,
      format: 'JSONEachRow',
    })
    const trades = await tradesResult.json() as Array<{
      trade_count: string
      total_cash: number
      total_shares: number
      condition_id_sample: string
    }>

    if (trades.length > 0 && parseInt(trades[0].trade_count) > 0) {
      const t = trades[0]
      console.log(`✅ Wallet HAS trades for this market`)
      console.log(`   Trade Count:    ${parseInt(t.trade_count).toLocaleString()}`)
      console.log(`   Total Cash:     $${t.total_cash.toFixed(2)}`)
      console.log(`   Total Shares:   ${t.total_shares.toFixed(2)}`)
      console.log(`   Condition ID:   ${t.condition_id_sample}`)
    } else {
      console.log('❌ Wallet has NO trades for this market')
    }

    // Check all markets for this wallet that have NO resolution
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 All Markets for Wallet with NO Resolution Data\n')

    const noResolutionResult = await clickhouse.query({
      query: `
        WITH wallet_markets AS (
          SELECT DISTINCT condition_id
          FROM vw_pm_ledger
          WHERE wallet_address = '${WALLET}'
        ),
        has_resolution AS (
          SELECT DISTINCT condition_id
          FROM vw_pm_resolution_prices
        )
        SELECT
          w.condition_id,
          sum(l.cash_delta_usdc) as trade_cash,
          sum(l.shares_delta) as final_shares,
          count() as trade_count
        FROM wallet_markets w
        LEFT JOIN has_resolution r ON w.condition_id = r.condition_id
        INNER JOIN vw_pm_ledger l ON w.condition_id = l.condition_id AND l.wallet_address = '${WALLET}'
        WHERE r.condition_id IS NULL
        GROUP BY w.condition_id
        ORDER BY abs(trade_cash) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    })
    const noResolution = await noResolutionResult.json() as Array<{
      condition_id: string
      trade_cash: number
      final_shares: number
      trade_count: string
    }>

    console.log(`Found ${noResolution.length} markets with trades but NO resolution\n`)
    console.log('Market (first 24)       | Trade Cash  | Final Shares | Trades')
    console.log('-'.repeat(75))
    let totalImpact = 0
    noResolution.forEach(row => {
      const market = row.condition_id.slice(0, 23).padEnd(23)
      const cash = `$${row.trade_cash.toFixed(2)}`.padStart(11)
      const shares = row.final_shares.toFixed(2).padStart(12)
      const trades = parseInt(row.trade_count).toLocaleString().padStart(6)
      console.log(`${market} | ${cash} | ${shares} | ${trades}`)
      totalImpact += row.trade_cash
    })

    console.log(`\nTotal Trade Cash (unresolved): $${totalImpact.toFixed(2)}`)
    console.log('\n⚠️  These markets have trades but NO resolution data')
    console.log('   They should NOT be included in "resolved" PnL calculations')

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 FINDINGS\n')
    console.log('If market has NO resolution data:')
    console.log('  - It should NOT appear in vw_pm_resolution_prices')
    console.log('  - It should have is_resolved = 0 in vw_pm_realized_pnl_v1')
    console.log('  - It should be EXCLUDED from "resolved PnL" calculations')
    console.log()
    console.log('If we are including unresolved markets in PnL:')
    console.log('  - This explains the discrepancy vs Polymarket UI')
    console.log('  - UI only shows PnL for truly resolved markets')
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

checkFormats()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
