/**
 * Step 4: Post-Fix Regression Checks
 *
 * Verify V3 hasn't broken anything:
 * 1. Zero-sum validation (per-market and system-wide)
 * 2. View vs recompute consistency (sample markets)
 * 3. Comparison with V2 totals (should differ by loser-share leak only)
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const TEST_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function postFixRegressionChecks() {
  console.log('🔍 Step 4: Post-Fix Regression Checks\n')
  console.log('='.repeat(80))

  try {
    // Check 1: Zero-sum validation on V3
    console.log('\n1. Zero-Sum Validation (V3)...\n')

    const zeroSumResult = await clickhouse.query({
      query: `
        WITH pnl_by_wallet AS (
          SELECT
            wallet_address,
            sum(realized_pnl) AS total_pnl
          FROM vw_pm_realized_pnl_v3
          WHERE is_resolved = 1
          GROUP BY wallet_address
        )
        SELECT
          sum(total_pnl) AS system_total_pnl,
          count() AS wallet_count
        FROM pnl_by_wallet
      `,
      format: 'JSONEachRow'
    })
    const zeroSum = await zeroSumResult.json() as Array<{
      system_total_pnl: number
      wallet_count: string
    }>

    const systemPnL = zeroSum[0].system_total_pnl
    const walletCount = parseInt(zeroSum[0].wallet_count)

    console.log(`System-wide PnL (all wallets): $${systemPnL.toLocaleString(undefined, {maximumFractionDigits: 2})}`)
    console.log(`Wallets with resolved positions: ${walletCount.toLocaleString()}`)

    const zeroSumPerfect = Math.abs(systemPnL) < 1000 // Within $1000 is acceptable
    const zeroSumAccuracy = 100 - (Math.abs(systemPnL) / 1000000) * 100 // As % of $1M

    console.log()
    if (zeroSumPerfect) {
      console.log(`✅ Zero-sum PASSED (${zeroSumAccuracy.toFixed(4)}% accuracy)`)
    } else {
      console.log(`⚠️  Zero-sum: $${Math.abs(systemPnL).toLocaleString()} deviation (${zeroSumAccuracy.toFixed(4)}% accuracy)`)
    }

    // Check 2: Per-market zero-sum sample
    console.log('\n' + '='.repeat(80))
    console.log('\n2. Per-Market Zero-Sum Sample (10 markets)...\n')

    const marketSampleResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          sum(realized_pnl) AS market_total_pnl,
          count() AS wallet_count
        FROM vw_pm_realized_pnl_v3
        WHERE is_resolved = 1
        GROUP BY condition_id
        ORDER BY abs(market_total_pnl) DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const marketSamples = await marketSampleResult.json() as Array<{
      condition_id: string
      market_total_pnl: number
      wallet_count: string
    }>

    console.log('Condition (16)    | Total PnL   | Wallets | Zero-Sum?')
    console.log('-'.repeat(65))

    let perfectCount = 0
    marketSamples.forEach(m => {
      const condId = m.condition_id.slice(0, 16)
      const pnl = `$${m.market_total_pnl.toFixed(2)}`.padStart(11)
      const wallets = parseInt(m.wallet_count).toString().padStart(7)
      const isZero = Math.abs(m.market_total_pnl) < 0.01
      const status = isZero ? '✅' : `❌ ($${Math.abs(m.market_total_pnl).toFixed(2)} off)`
      console.log(`${condId} | ${pnl} | ${wallets} | ${status}`)
      if (isZero) perfectCount++
    })

    console.log()
    console.log(`Perfect zero-sum: ${perfectCount}/10 markets (${(perfectCount/10*100).toFixed(0)}%)`)

    // Check 3: V2 vs V3 comparison
    console.log('\n' + '='.repeat(80))
    console.log('\n3. V2 vs V3 Comparison (Test Wallet)...\n')

    const v2TotalResult = await clickhouse.query({
      query: `
        SELECT sum(realized_pnl) AS total_pnl
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const v2Total = await v2TotalResult.json() as Array<{ total_pnl: number | null }>
    const v2PnL = v2Total[0].total_pnl || 0

    const v3TotalResult = await clickhouse.query({
      query: `
        SELECT sum(realized_pnl) AS total_pnl
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const v3Total = await v3TotalResult.json() as Array<{ total_pnl: number | null }>
    const v3PnL = v3Total[0].total_pnl || 0

    const v2v3Diff = v2PnL - v3PnL

    console.log(`V2 Total PnL: $${v2PnL.toLocaleString(undefined, {maximumFractionDigits: 2})}`)
    console.log(`V3 Total PnL: $${v3PnL.toLocaleString(undefined, {maximumFractionDigits: 2})}`)
    console.log(`Difference:   $${v2v3Diff.toLocaleString(undefined, {maximumFractionDigits: 2})}`)

    console.log()
    if (Math.abs(v2v3Diff) < 0.01) {
      console.log('⚠️  V2 and V3 are identical - loser-share fix may not have applied!')
    } else if (v2PnL > v3PnL) {
      console.log(`✅ V3 is LOWER than V2 by $${v2v3Diff.toFixed(2)} (expected - fixed loser-share leak)`)
    } else {
      console.log(`⚠️  V3 is HIGHER than V2 by $${Math.abs(v2v3Diff).toFixed(2)} (unexpected)`)
    }

    // Check 4: Spot-check view vs recompute consistency
    console.log('\n' + '='.repeat(80))
    console.log('\n4. View vs Recompute Consistency (5 random markets)...\n')

    const randomMarketsResult = await clickhouse.query({
      query: `
        SELECT condition_id, realized_pnl
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
        ORDER BY rand()
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const randomMarkets = await randomMarketsResult.json() as Array<{
      condition_id: string
      realized_pnl: number
    }>

    let consistentCount = 0

    for (const market of randomMarkets) {
      // Get view PnL
      const viewPnL = market.realized_pnl

      // Recompute
      const recomputeResult = await clickhouse.query({
        query: `
          WITH ledger AS (
            SELECT
              sum(cash_delta_usdc) AS trade_cash,
              sum(shares_delta) AS final_shares
            FROM vw_pm_ledger_v2
            WHERE wallet_address = '${TEST_WALLET}'
              AND condition_id = '${market.condition_id}'
          ),
          resolution AS (
            SELECT payout_numerators
            FROM pm_condition_resolutions
            WHERE lower(condition_id) = '${market.condition_id}'
          )
          SELECT
            l.trade_cash + l.final_shares *
              CASE
                WHEN arraySum(JSONExtractArrayRaw(r.payout_numerators)) > 0
                THEN toFloat64(JSONExtract(r.payout_numerators, 'Array(Float64)')[
                  indexOf(JSONExtract(r.payout_numerators, 'Array(Float64)'),
                    arrayMax(JSONExtract(r.payout_numerators, 'Array(Float64)')))
                ]) / arraySum(JSONExtractArrayRaw(r.payout_numerators))
                ELSE 0
              END AS recompute_pnl
          FROM ledger l
          CROSS JOIN resolution r
        `,
        format: 'JSONEachRow'
      })
      const recompute = await recomputeResult.json() as Array<{ recompute_pnl: number }>
      const recomputePnL = recompute[0].recompute_pnl

      const match = Math.abs(viewPnL - recomputePnL) < 0.01

      console.log(`${market.condition_id.slice(0, 16)}... → View: $${viewPnL.toFixed(2)}, Recompute: $${recomputePnL.toFixed(2)} ${match ? '✅' : '❌'}`)

      if (match) consistentCount++
    }

    console.log()
    console.log(`Consistent: ${consistentCount}/5 (${(consistentCount/5*100).toFixed(0)}%)`)

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 REGRESSION CHECK SUMMARY\n')

    const allChecksPassed = zeroSumPerfect && (perfectCount >= 8) && (v2PnL > v3PnL) && (consistentCount === 5)

    console.log('Results:')
    console.log(`  1. System zero-sum:      ${zeroSumPerfect ? '✅ PASS' : '⚠️  ACCEPTABLE'}`)
    console.log(`  2. Per-market zero-sum:   ${perfectCount}/10 perfect ${perfectCount >= 8 ? '✅ PASS' : '⚠️  CHECK'}`)
    console.log(`  3. V2 vs V3:              ${v2PnL > v3PnL ? '✅ PASS (V3 fixed leak)' : '⚠️  UNEXPECTED'}`)
    console.log(`  4. View vs Recompute:     ${consistentCount}/5 match ${consistentCount === 5 ? '✅ PASS' : '⚠️  CHECK'}`)

    console.log()
    if (allChecksPassed) {
      console.log('✅ STEP 4 COMPLETE - All regression checks passed!')
    } else {
      console.log('⚠️  STEP 4 COMPLETE - Some checks need investigation')
    }

    console.log()
    console.log('Next: Step 5 - Prep AMM backfill validation script')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

postFixRegressionChecks()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
