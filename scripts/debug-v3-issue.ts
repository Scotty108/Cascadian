/**
 * Debug V3 Issue
 *
 * System-wide PnL is -$2.8B (should be ~$0)
 * Need to investigate what's wrong with V3 view
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const TEST_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function debugV3Issue() {
  console.log('🔍 Debug V3 Issue\n')
  console.log('='.repeat(80))

  try {
    // Check 1: Resolved vs Unresolved counts
    console.log('\n1. Checking resolved vs unresolved markets...\n')

    const resolvedCountResult = await clickhouse.query({
      query: `
        SELECT
          is_resolved,
          count(DISTINCT condition_id) AS market_count,
          count(*) AS position_count,
          sum(realized_pnl) AS total_pnl
        FROM vw_pm_realized_pnl_v3
        GROUP BY is_resolved
      `,
      format: 'JSONEachRow'
    })
    const resolvedCounts = await resolvedCountResult.json() as Array<{
      is_resolved: number
      market_count: string
      position_count: string
      total_pnl: number
    }>

    console.log('Status       | Markets     | Positions   | Total PnL')
    console.log('-'.repeat(70))
    resolvedCounts.forEach(r => {
      const status = r.is_resolved === 1 ? 'Resolved  ' : 'Unresolved'
      const markets = parseInt(r.market_count).toLocaleString().padStart(11)
      const positions = parseInt(r.position_count).toLocaleString().padStart(11)
      const pnl = `$${r.total_pnl.toLocaleString(undefined, {maximumFractionDigits: 2})}`.padStart(20)
      console.log(`${status} | ${markets} | ${positions} | ${pnl}`)
    })

    // Check 2: Sample unresolved markets for test wallet
    console.log('\n' + '='.repeat(80))
    console.log('\n2. Sample unresolved markets (test wallet)...\n')

    const unresolvedSampleResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          trade_cash,
          resolution_cash,
          realized_pnl,
          is_resolved
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 0
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const unresolvedSamples = await unresolvedSampleResult.json() as Array<{
      condition_id: string
      trade_cash: number
      resolution_cash: number
      realized_pnl: number
      is_resolved: number
    }>

    if (unresolvedSamples.length > 0) {
      console.log('Condition (16)    | Trade Cash  | Res Cash    | PnL         | Resolved?')
      console.log('-'.repeat(80))
      unresolvedSamples.forEach(u => {
        const cond = u.condition_id.slice(0, 16)
        const trade = `$${u.trade_cash.toFixed(2)}`.padStart(11)
        const res = `$${u.resolution_cash.toFixed(2)}`.padStart(11)
        const pnl = `$${u.realized_pnl.toFixed(2)}`.padStart(11)
        const resolved = u.is_resolved === 1 ? 'Yes' : 'No '
        console.log(`${cond} | ${trade} | ${res} | ${pnl} | ${resolved}`)
      })
    } else {
      console.log('✅ No unresolved markets for test wallet')
    }

    // Check 3: Compare totals (resolved only)
    console.log('\n' + '='.repeat(80))
    console.log('\n3. Total PnL comparison (RESOLVED ONLY)...\n')

    const v3ResolvedResult = await clickhouse.query({
      query: `
        SELECT
          count(DISTINCT condition_id) AS markets,
          sum(realized_pnl) AS total_pnl
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const v3Resolved = await v3ResolvedResult.json() as Array<{
      markets: string
      total_pnl: number
    }>

    console.log(`V3 (resolved): ${v3Resolved[0].markets} markets, $${v3Resolved[0].total_pnl.toFixed(2)}`)

    // Check 4: Sample a known-good market to verify calculation
    console.log('\n' + '='.repeat(80))
    console.log('\n4. Verify known-good market (ee3a38...)...\n')

    const knownGoodResult = await clickhouse.query({
      query: `
        SELECT *
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND condition_id = 'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2'
      `,
      format: 'JSONEachRow'
    })
    const knownGood = await knownGoodResult.json()

    console.log('Known-good market (should be $24,924.15):')
    console.log(JSON.stringify(knownGood[0], null, 2))

    // Check 5: Check if resolution_time is being set correctly
    console.log('\n' + '='.repeat(80))
    console.log('\n5. Check resolution_time field...\n')

    const resTimeCheckResult = await clickhouse.query({
      query: `
        SELECT
          resolution_time IS NOT NULL AS has_res_time,
          is_resolved,
          count(*) AS count
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
        GROUP BY has_res_time, is_resolved
      `,
      format: 'JSONEachRow'
    })
    const resTimeCheck = await resTimeCheckResult.json() as Array<{
      has_res_time: number
      is_resolved: number
      count: string
    }>

    console.log('Has Res Time | Is Resolved | Count')
    console.log('-'.repeat(40))
    resTimeCheck.forEach(r => {
      const hasTime = r.has_res_time === 1 ? 'Yes' : 'No '
      const resolved = r.is_resolved === 1 ? 'Yes' : 'No '
      const count = parseInt(r.count).toString().padStart(5)
      console.log(`${hasTime}          | ${resolved}         | ${count}`)
    })

    console.log('\n' + '='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

debugV3Issue()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
