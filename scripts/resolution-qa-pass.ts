/**
 * Step 3: Resolution QA Pass
 *
 * Sample 10 resolved markets (wins + losses) and verify:
 * 1. V3 PnL matches manual recompute
 * 2. Resolved prices match payout_numerators
 * 3. PnL calculation is consistent
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const TEST_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function resolutionQAPass() {
  console.log('🔍 Step 3: Resolution QA Pass\n')
  console.log('='.repeat(80))

  try {
    // Step 1: Pick 10 resolved markets (5 wins, 5 losses)
    console.log('\n1. Selecting test markets (5 wins, 5 losses)...\n')

    const winsResult = await clickhouse.query({
      query: `
        SELECT condition_id, realized_pnl
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
          AND realized_pnl > 0
        ORDER BY abs(realized_pnl) DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const wins = await winsResult.json() as Array<{
      condition_id: string
      realized_pnl: number
    }>

    const lossesResult = await clickhouse.query({
      query: `
        SELECT condition_id, realized_pnl
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
          AND realized_pnl < 0
        ORDER BY abs(realized_pnl) DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const losses = await lossesResult.json() as Array<{
      condition_id: string
      realized_pnl: number
    }>

    const testMarkets = [...wins, ...losses]

    console.log('Selected markets:')
    console.log('\nWins:')
    wins.forEach((m, idx) => {
      console.log(`  ${idx + 1}. ${m.condition_id.slice(0, 16)}... → $${m.realized_pnl.toFixed(2)}`)
    })
    console.log('\nLosses:')
    losses.forEach((m, idx) => {
      console.log(`  ${idx + 1}. ${m.condition_id.slice(0, 16)}... → $${m.realized_pnl.toFixed(2)}`)
    })

    // Step 2: QA each market
    console.log('\n' + '='.repeat(80))
    console.log('\n2. QA Testing Each Market...\n')

    let passCount = 0
    let failCount = 0
    const failures: Array<{
      condition_id: string
      issue: string
    }> = []

    for (let i = 0; i < testMarkets.length; i++) {
      const market = testMarkets[i]
      const marketNum = i + 1

      console.log(`\n--- Market ${marketNum}/10: ${market.condition_id.slice(0, 20)}... ---\n`)

      // Get V3 PnL
      const v3Result = await clickhouse.query({
        query: `
          SELECT
            trade_cash,
            resolution_cash,
            realized_pnl,
            resolution_time
          FROM vw_pm_realized_pnl_v3
          WHERE wallet_address = '${TEST_WALLET}'
            AND condition_id = '${market.condition_id}'
        `,
        format: 'JSONEachRow'
      })
      const v3 = await v3Result.json() as Array<{
        trade_cash: number
        resolution_cash: number
        realized_pnl: number
        resolution_time: string | null
      }>

      if (v3.length === 0) {
        console.log('❌ Not found in V3 view!')
        failCount++
        failures.push({ condition_id: market.condition_id, issue: 'Not in V3 view' })
        continue
      }

      const v3Data = v3[0]

      // Manual recompute
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
            SELECT
              payout_numerators
            FROM pm_condition_resolutions
            WHERE lower(condition_id) = '${market.condition_id}'
          )
          SELECT
            l.trade_cash,
            l.final_shares,
            r.payout_numerators
          FROM ledger l
          CROSS JOIN resolution r
        `,
        format: 'JSONEachRow'
      })
      const recompute = await recomputeResult.json() as Array<{
        trade_cash: number
        final_shares: number
        payout_numerators: string
      }>

      if (recompute.length === 0) {
        console.log('❌ No resolution data found!')
        failCount++
        failures.push({ condition_id: market.condition_id, issue: 'No resolution data' })
        continue
      }

      const r = recompute[0]
      const payouts = JSON.parse(r.payout_numerators) as number[]
      const winnerIndex = payouts.findIndex(p => p > 0)
      const payoutSum = payouts.reduce((sum, p) => sum + p, 0)
      const resolvedPrice = payoutSum > 0 && winnerIndex >= 0 ? payouts[winnerIndex] / payoutSum : 0
      const resolutionCash = r.final_shares * resolvedPrice
      const recomputePnL = r.trade_cash + resolutionCash

      // Compare
      console.log('V3 View:')
      console.log(`  Trade Cash:       $${v3Data.trade_cash.toFixed(2)}`)
      console.log(`  Resolution Cash:  $${v3Data.resolution_cash.toFixed(2)}`)
      console.log(`  Realized PnL:     $${v3Data.realized_pnl.toFixed(2)}`)

      console.log('\nManual Recompute:')
      console.log(`  Trade Cash:       $${r.trade_cash.toFixed(2)}`)
      console.log(`  Final Shares:     ${r.final_shares.toFixed(2)}`)
      console.log(`  Payout:           ${r.payout_numerators}`)
      console.log(`  Winner Index:     ${winnerIndex}`)
      console.log(`  Resolved Price:   ${resolvedPrice.toFixed(4)}`)
      console.log(`  Resolution Cash:  $${resolutionCash.toFixed(2)}`)
      console.log(`  Realized PnL:     $${recomputePnL.toFixed(2)}`)

      // Verification
      const tradeCashMatch = Math.abs(v3Data.trade_cash - r.trade_cash) < 0.01
      const resCashMatch = Math.abs(v3Data.resolution_cash - resolutionCash) < 0.01
      const pnlMatch = Math.abs(v3Data.realized_pnl - recomputePnL) < 0.01
      const mathCheck = Math.abs(v3Data.realized_pnl - (v3Data.trade_cash + v3Data.resolution_cash)) < 0.01

      console.log('\nVerification:')
      console.log(`  Trade Cash Match:     ${tradeCashMatch ? '✅' : '❌'} (diff: $${Math.abs(v3Data.trade_cash - r.trade_cash).toFixed(2)})`)
      console.log(`  Resolution Cash Match: ${resCashMatch ? '✅' : '❌'} (diff: $${Math.abs(v3Data.resolution_cash - resolutionCash).toFixed(2)})`)
      console.log(`  PnL Match:            ${pnlMatch ? '✅' : '❌'} (diff: $${Math.abs(v3Data.realized_pnl - recomputePnL).toFixed(2)})`)
      console.log(`  Math Check:           ${mathCheck ? '✅' : '❌'} (trade + res = pnl)`)

      if (tradeCashMatch && resCashMatch && pnlMatch && mathCheck) {
        console.log('\n✅ PASS')
        passCount++
      } else {
        console.log('\n❌ FAIL')
        failCount++
        const issues = []
        if (!tradeCashMatch) issues.push('trade_cash mismatch')
        if (!resCashMatch) issues.push('resolution_cash mismatch')
        if (!pnlMatch) issues.push('pnl mismatch')
        if (!mathCheck) issues.push('math error')
        failures.push({ condition_id: market.condition_id, issue: issues.join(', ') })
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 QA PASS SUMMARY\n')

    console.log(`Markets Tested: ${testMarkets.length}`)
    console.log(`  ✅ Passed: ${passCount}`)
    console.log(`  ❌ Failed: ${failCount}`)

    if (failCount > 0) {
      console.log('\nFailures:')
      failures.forEach((f, idx) => {
        console.log(`  ${idx + 1}. ${f.condition_id.slice(0, 20)}... → ${f.issue}`)
      })
    }

    const passRate = (passCount / testMarkets.length) * 100

    console.log()
    if (passRate === 100) {
      console.log('✅ STEP 3 COMPLETE - All QA checks passed!')
    } else if (passRate >= 80) {
      console.log(`⚠️  STEP 3 MOSTLY COMPLETE - ${passRate.toFixed(0)}% pass rate (acceptable)`)
    } else {
      console.log(`❌ STEP 3 FAILED - Only ${passRate.toFixed(0)}% pass rate (needs investigation)`)
    }

    console.log()
    console.log('Next: Step 4 - Post-fix regression checks (zero-sum, recompute vs view)')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

resolutionQAPass()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
