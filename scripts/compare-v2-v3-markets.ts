/**
 * Compare V2 vs V3 for Same Markets
 *
 * V2 total: $107,085
 * V3 total: -$70,548
 * Difference: $177,633 (WAY more than $1,263 loser-share leak!)
 *
 * Compare market-by-market to find where they differ.
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const TEST_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function compareV2V3Markets() {
  console.log('🔍 Compare V2 vs V3 Markets\n')
  console.log('='.repeat(80))

  try {
    // Get totals first
    const v2TotalResult = await clickhouse.query({
      query: `
        SELECT sum(realized_pnl) AS total
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const v2Total = await v2TotalResult.json() as Array<{ total: number | null }>

    const v3TotalResult = await clickhouse.query({
      query: `
        SELECT sum(realized_pnl) AS total
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const v3Total = await v3TotalResult.json() as Array<{ total: number | null }>

    const v2TotalPnL = v2Total[0].total || 0
    const v3TotalPnL = v3Total[0].total || 0

    console.log('Totals:')
    console.log(`  V2: $${v2TotalPnL.toFixed(2)}`)
    console.log(`  V3: $${v3TotalPnL.toFixed(2)}`)
    console.log(`  Diff: $${(v2TotalPnL - v3TotalPnL).toFixed(2)}`)

    // Get per-market comparison
    console.log('\n' + '='.repeat(80))
    console.log('\n1. Per-Market Comparison (biggest differences)...\n')

    const comparisonResult = await clickhouse.query({
      query: `
        SELECT
          COALESCE(v2.condition_id, v3.condition_id) AS condition_id,
          COALESCE(v2.realized_pnl, 0) AS v2_pnl,
          COALESCE(v3.realized_pnl, 0) AS v3_pnl,
          COALESCE(v2.realized_pnl, 0) - COALESCE(v3.realized_pnl, 0) AS diff
        FROM (
          SELECT condition_id, realized_pnl
          FROM vw_pm_realized_pnl_v2
          WHERE wallet_address = '${TEST_WALLET}'
            AND is_resolved = 1
        ) v2
        FULL OUTER JOIN (
          SELECT condition_id, realized_pnl
          FROM vw_pm_realized_pnl_v3
          WHERE wallet_address = '${TEST_WALLET}'
            AND is_resolved = 1
        ) v3 ON v2.condition_id = v3.condition_id
        ORDER BY abs(diff) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })
    const comparison = await comparisonResult.json() as Array<{
      condition_id: string
      v2_pnl: number
      v3_pnl: number
      diff: number
    }>

    console.log('Condition (16)    | V2 PnL      | V3 PnL      | Difference')
    console.log('-'.repeat(75))

    let totalDiff = 0
    comparison.forEach(c => {
      const cond = c.condition_id.slice(0, 16)
      const v2 = `$${c.v2_pnl.toFixed(2)}`.padStart(11)
      const v3 = `$${c.v3_pnl.toFixed(2)}`.padStart(11)
      const diff = `$${c.diff.toFixed(2)}`.padStart(11)
      console.log(`${cond} | ${v2} | ${v3} | ${diff}`)
      totalDiff += c.diff
    })

    console.log('-'.repeat(75))
    console.log(`Top 20 diff sum: $${totalDiff.toFixed(2)}`)

    // Check for markets only in V2 or only in V3
    console.log('\n' + '='.repeat(80))
    console.log('\n2. Markets only in V2 or only in V3...\n')

    const v2OnlyResult = await clickhouse.query({
      query: `
        SELECT condition_id, realized_pnl
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
          AND condition_id NOT IN (
            SELECT condition_id
            FROM vw_pm_realized_pnl_v3
            WHERE wallet_address = '${TEST_WALLET}'
              AND is_resolved = 1
          )
      `,
      format: 'JSONEachRow'
    })
    const v2Only = await v2OnlyResult.json() as Array<{
      condition_id: string
      realized_pnl: number
    }>

    const v3OnlyResult = await clickhouse.query({
      query: `
        SELECT condition_id, realized_pnl
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
          AND condition_id NOT IN (
            SELECT condition_id
            FROM vw_pm_realized_pnl_v2
            WHERE wallet_address = '${TEST_WALLET}'
              AND is_resolved = 1
          )
      `,
      format: 'JSONEachRow'
    })
    const v3Only = await v3OnlyResult.json() as Array<{
      condition_id: string
      realized_pnl: number
    }>

    if (v2Only.length > 0) {
      console.log(`🚨 ${v2Only.length} markets ONLY in V2:\n`)
      console.log('Condition (16)    | PnL')
      console.log('-'.repeat(35))
      let v2OnlySum = 0
      v2Only.slice(0, 10).forEach(m => {
        const cond = m.condition_id.slice(0, 16)
        const pnl = `$${m.realized_pnl.toFixed(2)}`.padStart(12)
        console.log(`${cond} | ${pnl}`)
        v2OnlySum += m.realized_pnl
      })
      const totalV2Only = v2Only.reduce((sum, m) => sum + m.realized_pnl, 0)
      console.log('-'.repeat(35))
      console.log(`V2-only total: $${totalV2Only.toFixed(2)}`)
    } else {
      console.log('✅ No markets only in V2')
    }

    console.log()

    if (v3Only.length > 0) {
      console.log(`🚨 ${v3Only.length} markets ONLY in V3:\n`)
      console.log('Condition (16)    | PnL')
      console.log('-'.repeat(35))
      let v3OnlySum = 0
      v3Only.slice(0, 10).forEach(m => {
        const cond = m.condition_id.slice(0, 16)
        const pnl = `$${m.realized_pnl.toFixed(2)}`.padStart(12)
        console.log(`${cond} | ${pnl}`)
        v3OnlySum += m.realized_pnl
      })
      const totalV3Only = v3Only.reduce((sum, m) => sum + m.realized_pnl, 0)
      console.log('-'.repeat(35))
      console.log(`V3-only total: $${totalV3Only.toFixed(2)}`)
    } else {
      console.log('✅ No markets only in V3')
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 SUMMARY\n')

    console.log(`Markets in V2: ${comparison.length + v2Only.length}`)
    console.log(`Markets in V3: ${comparison.length + v3Only.length}`)
    console.log(`Markets in both: ${comparison.length}`)
    console.log(`Only in V2: ${v2Only.length}`)
    console.log(`Only in V3: ${v3Only.length}`)

    console.log()
    console.log('Total PnL:')
    console.log(`  V2: $${v2TotalPnL.toFixed(2)}`)
    console.log(`  V3: $${v3TotalPnL.toFixed(2)}`)
    console.log(`  Difference: $${(v2TotalPnL - v3TotalPnL).toFixed(2)}`)

    console.log('\n' + '='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

compareV2V3Markets()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
