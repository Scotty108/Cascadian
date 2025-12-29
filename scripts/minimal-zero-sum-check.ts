/**
 * Minimal Zero-Sum Check
 * Groups by condition_id first to avoid outcome double-counting
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function minimalZeroSumCheck() {
  console.log('🔍 Minimal Zero-Sum Check\n')
  console.log('='.repeat(80))

  try {
    // Global zero-sum (grouped by condition first)
    console.log('\n1. Global Zero-Sum (condition-level aggregation)...\n')

    const globalResult = await clickhouse.query({
      query: `
        WITH market_pnl AS (
          SELECT
            condition_id,
            SUM(realized_pnl) AS pnl
          FROM vw_pm_realized_pnl_v4
          WHERE is_resolved = 1
          GROUP BY condition_id
        )
        SELECT SUM(pnl) AS total_realized_pnl
        FROM market_pnl
      `,
      format: 'JSONEachRow'
    })
    const global = await globalResult.json() as Array<{ total_realized_pnl: number }>

    const totalPnL = global[0].total_realized_pnl
    console.log(`Total Realized PnL: $${totalPnL.toLocaleString(undefined, {maximumFractionDigits: 2})}`)

    const isNearZero = Math.abs(totalPnL) < 1000
    if (isNearZero) {
      console.log('✅ Zero-sum PASSED (within $1K tolerance)')
    } else {
      console.log(`⚠️  Zero-sum deviation: $${Math.abs(totalPnL).toLocaleString()}`)

      // Inspect top markets by absolute PnL
      console.log('\n2. Top 20 Markets by Absolute PnL...\n')

      const topMarketsResult = await clickhouse.query({
        query: `
          WITH market_pnl AS (
            SELECT
              condition_id,
              SUM(realized_pnl) AS pnl
            FROM vw_pm_realized_pnl_v4
            WHERE is_resolved = 1
            GROUP BY condition_id
          )
          SELECT condition_id, pnl
          FROM market_pnl
          ORDER BY ABS(pnl) DESC
          LIMIT 20
        `,
        format: 'JSONEachRow'
      })
      const topMarkets = await topMarketsResult.json() as Array<{
        condition_id: string
        pnl: number
      }>

      console.log('Condition (40)                             | PnL')
      console.log('-'.repeat(70))
      topMarkets.forEach(m => {
        const cond = m.condition_id.slice(0, 40).padEnd(40)
        const pnl = `$${m.pnl.toLocaleString(undefined, {maximumFractionDigits: 2})}`.padStart(20)
        console.log(`${cond} | ${pnl}`)
      })

      const top20Sum = topMarkets.reduce((sum, m) => sum + m.pnl, 0)
      console.log('-'.repeat(70))
      console.log(`Top 20 sum: $${top20Sum.toLocaleString(undefined, {maximumFractionDigits: 2})}`)
    }

    console.log('\n' + '='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

minimalZeroSumCheck()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
