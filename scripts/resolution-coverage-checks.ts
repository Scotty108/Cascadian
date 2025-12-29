/**
 * Resolution Coverage & Sanity Checks
 *
 * Run comprehensive checks to ensure resolution data integrity:
 * A) CTF events without resolutions
 * B) Ledger marked resolved but no resolution data
 * C) Weird payout vectors (sum = 0)
 * D) Global zero-sum validation
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function resolutionCoverageChecks() {
  console.log('🔍 Resolution Coverage & Sanity Checks\n')
  console.log('='.repeat(80))

  try {
    // Check A: CTF events without resolutions
    console.log('\n📋 A) CTF Events Without Resolutions...\n')

    const ctfNoResResult = await clickhouse.query({
      query: `
        SELECT DISTINCT e.condition_id
        FROM pm_ctf_events e
        LEFT JOIN pm_condition_resolutions r ON lower(e.condition_id) = lower(r.condition_id)
        WHERE r.condition_id IS NULL
        LIMIT 100
      `,
      format: 'JSONEachRow'
    })
    const ctfNoRes = await ctfNoResResult.json() as Array<{ condition_id: string }>

    if (ctfNoRes.length > 0) {
      console.log(`🚨 Found ${ctfNoRes.length} CTF conditions WITHOUT resolutions:\n`)
      console.log('Condition ID (first 40)')
      console.log('-'.repeat(45))
      ctfNoRes.slice(0, 10).forEach(c => {
        console.log(c.condition_id.slice(0, 40))
      })
      if (ctfNoRes.length > 10) {
        console.log(`... and ${ctfNoRes.length - 10} more`)
      }
    } else {
      console.log('✅ All CTF events have corresponding resolutions')
    }

    // Check B: Ledger marked resolved without resolution data
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 B) Ledger Marked Resolved Without Resolution Data...\n')

    const ledgerNoResResult = await clickhouse.query({
      query: `
        SELECT DISTINCT p.condition_id
        FROM vw_pm_realized_pnl_v3 p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = lower(r.condition_id)
        WHERE p.is_resolved = 1
          AND r.condition_id IS NULL
        LIMIT 100
      `,
      format: 'JSONEachRow'
    })
    const ledgerNoRes = await ledgerNoResResult.json() as Array<{ condition_id: string }>

    if (ledgerNoRes.length > 0) {
      console.log(`🚨 Found ${ledgerNoRes.length} resolved positions WITHOUT resolution data:\n`)
      console.log('Condition ID (first 40)')
      console.log('-'.repeat(45))
      ledgerNoRes.slice(0, 10).forEach(c => {
        console.log(c.condition_id.slice(0, 40))
      })
      if (ledgerNoRes.length > 10) {
        console.log(`... and ${ledgerNoRes.length - 10} more`)
      }
    } else {
      console.log('✅ All resolved positions have corresponding resolution data')
    }

    // Check C: Weird payout vectors (sum = 0)
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 C) Weird Payout Vectors (sum = 0)...\n')

    const weirdPayoutsResult = await clickhouse.query({
      query: `
        WITH ctf_conditions AS (
          SELECT DISTINCT lower(condition_id) AS condition_id
          FROM pm_ctf_events
        )
        SELECT
          r.condition_id,
          r.payout_numerators,
          arraySum(JSONExtract(r.payout_numerators, 'Array(Float64)')) AS sum_num
        FROM pm_condition_resolutions r
        INNER JOIN ctf_conditions c ON lower(r.condition_id) = c.condition_id
        WHERE sum_num = 0
        LIMIT 100
      `,
      format: 'JSONEachRow'
    })
    const weirdPayouts = await weirdPayoutsResult.json() as Array<{
      condition_id: string
      payout_numerators: string
      sum_num: number
    }>

    if (weirdPayouts.length > 0) {
      console.log(`🚨 Found ${weirdPayouts.length} CTF conditions with ZERO payout sum:\n`)
      console.log('Condition (40)                             | Payout')
      console.log('-'.repeat(70))
      weirdPayouts.slice(0, 10).forEach(w => {
        const cond = w.condition_id.slice(0, 40).padEnd(40)
        console.log(`${cond} | ${w.payout_numerators}`)
      })
      if (weirdPayouts.length > 10) {
        console.log(`... and ${weirdPayouts.length - 10} more`)
      }
    } else {
      console.log('✅ All CTF resolutions have valid (non-zero) payout sums')
    }

    // Check D: Global zero-sum validation
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 D) Global Zero-Sum Validation...\n')

    const globalZeroSumResult = await clickhouse.query({
      query: `
        SELECT sum(realized_pnl) AS total_realized_pnl
        FROM vw_pm_realized_pnl_v3
        WHERE is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const globalZeroSum = await globalZeroSumResult.json() as Array<{ total_realized_pnl: number }>

    const totalPnL = globalZeroSum[0].total_realized_pnl
    const isNearZero = Math.abs(totalPnL) < 1000 // Within $1K is acceptable

    console.log(`System-wide Total PnL (resolved): $${totalPnL.toLocaleString(undefined, {maximumFractionDigits: 2})}`)

    if (isNearZero) {
      console.log('✅ Global zero-sum PASSED (within rounding tolerance)')
    } else {
      const percentage = Math.abs(totalPnL) / 1000000 * 100
      console.log(`⚠️  Global zero-sum: $${Math.abs(totalPnL).toLocaleString()} deviation (${percentage.toFixed(4)}% of $1M)`)
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 RESOLUTION COVERAGE SUMMARY\n')

    const allChecksPassed =
      ctfNoRes.length === 0 &&
      ledgerNoRes.length === 0 &&
      weirdPayouts.length === 0 &&
      isNearZero

    console.log('Check Results:')
    console.log(`  A) CTF without resolutions:     ${ctfNoRes.length === 0 ? '✅ PASS (0 found)' : `⚠️  ${ctfNoRes.length} found`}`)
    console.log(`  B) Resolved without res data:   ${ledgerNoRes.length === 0 ? '✅ PASS (0 found)' : `⚠️  ${ledgerNoRes.length} found`}`)
    console.log(`  C) Zero-sum payout vectors:     ${weirdPayouts.length === 0 ? '✅ PASS (0 found)' : `⚠️  ${weirdPayouts.length} found`}`)
    console.log(`  D) Global zero-sum:             ${isNearZero ? '✅ PASS' : `⚠️  $${Math.abs(totalPnL).toLocaleString()} deviation`}`)

    console.log()
    if (allChecksPassed) {
      console.log('✅ ALL CHECKS PASSED - Resolution data is complete and consistent')
    } else {
      console.log('⚠️  SOME CHECKS FAILED - Investigation needed (see above)')
    }

    // Flag markets for data quality
    if (ctfNoRes.length > 0 || ledgerNoRes.length > 0) {
      console.log('\nℹ️  Markets with issues should be flagged in pm_market_data_quality as:')
      console.log('   - missing_resolution (if CTF event exists but no resolution)')
    }

    console.log('\n' + '='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

resolutionCoverageChecks()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
