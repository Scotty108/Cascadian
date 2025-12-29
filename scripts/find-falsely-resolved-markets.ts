/**
 * Find markets marked as "resolved" in vw_pm_realized_pnl_v1
 * but have NO resolution data in vw_pm_resolution_prices
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function findFalselyResolved() {
  console.log('🔍 Finding Falsely "Resolved" Markets\n')
  console.log('='.repeat(80))

  try {
    // Find markets in vw_pm_realized_pnl_v1 marked as resolved
    // but with NO corresponding resolution data
    console.log('\n📊 Markets Marked as Resolved but Missing Resolution Data\n')

    const falselyResolvedResult = await clickhouse.query({
      query: `
        SELECT
          p.condition_id,
          sum(p.realized_pnl) as market_pnl,
          sum(p.trade_cash) as trade_cash,
          sum(p.resolution_cash) as resolution_cash,
          any(p.resolved_price) as resolved_price,
          any(p.is_resolved) as is_resolved,
          count() as position_count
        FROM vw_pm_realized_pnl_v1 p
        WHERE p.is_resolved = 1
          AND p.resolved_price IS NULL
        GROUP BY p.condition_id
        ORDER BY abs(market_pnl) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    })
    const falselyResolved = await falselyResolvedResult.json() as Array<{
      condition_id: string
      market_pnl: number
      trade_cash: number
      resolution_cash: number
      resolved_price: number | null
      is_resolved: number
      position_count: string
    }>

    if (falselyResolved.length > 0) {
      console.log(`Found ${falselyResolved.length} markets marked as resolved but with NULL resolved_price!\n`)
      console.log('Market (first 24)       | PnL         | Trade Cash  | Res Cash    | Res Price | Positions')
      console.log('-'.repeat(105))
      falselyResolved.forEach(row => {
        const market = row.condition_id.slice(0, 23).padEnd(23)
        const pnl = `$${row.market_pnl.toFixed(2)}`.padStart(11)
        const tradeCash = `$${row.trade_cash.toFixed(2)}`.padStart(11)
        const resCash = `$${row.resolution_cash.toFixed(2)}`.padStart(11)
        const resPrice = row.resolved_price === null ? 'NULL' : row.resolved_price.toFixed(4)
        const positions = parseInt(row.position_count).toLocaleString().padStart(9)
        console.log(`${market} | ${pnl} | ${tradeCash} | ${resCash} | ${resPrice.padStart(9)} | ${positions}`)
      })

      console.log('\n⚠️  CRITICAL BUG: is_resolved = 1 but resolved_price IS NULL')
      console.log('   This should be IMPOSSIBLE based on view definition:')
      console.log('     is_resolved = (resolved_price IS NOT NULL)')
      console.log()
      console.log('   Possible causes:')
      console.log('     1. View definition has a bug')
      console.log('     2. Data inconsistency in underlying tables')
      console.log('     3. NULL handling issue in ClickHouse')
    } else {
      console.log('✅ No markets found with is_resolved=1 and NULL resolved_price')
      console.log('   View logic is consistent')
    }

    // Check total impact on wallet
    console.log('\n' + '='.repeat(80))
    console.log(`\n📊 Impact on Wallet ${WALLET}\n`)

    const walletImpactResult = await clickhouse.query({
      query: `
        SELECT
          count(DISTINCT condition_id) as affected_markets,
          sum(realized_pnl) as total_impact,
          sum(trade_cash) as total_trade_cash,
          sum(resolution_cash) as total_resolution_cash
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
          AND resolved_price IS NULL
      `,
      format: 'JSONEachRow',
    })
    const walletImpact = await walletImpactResult.json() as Array<{
      affected_markets: string
      total_impact: number
      total_trade_cash: number
      total_resolution_cash: number
    }>

    if (walletImpact.length > 0 && walletImpact[0].affected_markets !== '0') {
      const impact = walletImpact[0]
      console.log(`Affected Markets:      ${parseInt(impact.affected_markets).toLocaleString()}`)
      console.log(`Total Impact PnL:      $${impact.total_impact.toFixed(2)}`)
      console.log(`Total Trade Cash:      $${impact.total_trade_cash.toFixed(2)}`)
      console.log(`Total Resolution Cash: $${impact.total_resolution_cash.toFixed(2)}`)

      console.log('\n⚠️  These markets should NOT be counted as "resolved"!')
    } else {
      console.log('✅ No impact on this wallet')
    }

    // Check how this affects PnL calculation
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 PnL Calculation: Current vs Corrected\n')

    const currentPnLResult = await clickhouse.query({
      query: `
        SELECT
          'Current (including NULL resolved_price)' as method,
          count(DISTINCT condition_id) as markets,
          sum(realized_pnl) as total_pnl
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
        UNION ALL
        SELECT
          'Corrected (excluding NULL resolved_price)' as method,
          count(DISTINCT condition_id) as markets,
          sum(realized_pnl) as total_pnl
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
          AND resolved_price IS NOT NULL
      `,
      format: 'JSONEachRow',
    })
    const comparison = await currentPnLResult.json() as Array<{
      method: string
      markets: string
      total_pnl: number
    }>

    console.log('Method                                     | Markets | Total PnL')
    console.log('-'.repeat(75))
    comparison.forEach(row => {
      const method = row.method.padEnd(42)
      const markets = parseInt(row.markets).toLocaleString().padStart(7)
      const pnl = `$${row.total_pnl.toFixed(2)}`.padStart(9)
      console.log(`${method} | ${markets} | ${pnl}`)
    })

    const current = comparison[0]
    const corrected = comparison[1]
    const diff = current.total_pnl - corrected.total_pnl

    console.log(`\nDifference: $${diff.toFixed(2)}`)

    console.log('\n📌 Polymarket UI: ~$96,000 profit')
    console.log(`📌 Our "corrected": $${corrected.total_pnl.toFixed(2)}`)
    console.log(`📌 Remaining gap: $${(96000 - corrected.total_pnl).toFixed(2)}`)

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 ROOT CAUSE IDENTIFIED\n')
    console.log('Issue: Markets with NULL resolved_price are marked as is_resolved = 1')
    console.log()
    console.log('This happens because:')
    console.log('  1. LEFT JOIN between trade_aggregates and vw_pm_resolution_prices')
    console.log('  2. When no resolution exists, resolved_price = NULL')
    console.log('  3. View definition: is_resolved = (resolved_price IS NOT NULL)')
    console.log('  4. But somehow these are showing is_resolved = 1')
    console.log()
    console.log('FIX REQUIRED:')
    console.log('  - Verify view definition for is_resolved calculation')
    console.log('  - Filter out markets with resolved_price IS NULL from "resolved" PnL')
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

findFalselyResolved()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
