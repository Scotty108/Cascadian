/**
 * PnL Engine V1 - View Recompute Validation
 *
 * Validates that vw_pm_realized_pnl_v1 calculations match direct recomputation
 * from vw_pm_ledger + vw_pm_resolution_prices.
 *
 * This catches any view/mapping glitches or aggregation bugs.
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

// Test wallets - mix of large and small traders
const TEST_WALLETS = [
  '0x56687bf447db6ffa42ffe2204a05edaa20f55839',  // Top 3 wallet
  '0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf',  // Top 4 wallet
  '0xd235973291b2b75ff4070e9c0b01728c520b0f29',  // Top 5 wallet
  '0xf29bb8e0712075041e87e8605b69833ef738dd4c',  // User provided wallet
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',  // User provided wallet
  '0xb744f56635b537e859152d14b022af5afe485210',  // User provided wallet
  '0x685eff0c9641faaf8a142dcfcd4883b27cbb6f30',  // User provided wallet
]

async function validateRecompute() {
  console.log('🔍 PnL Engine V1 - View Recompute Validation\n')
  console.log('=' .repeat(80))
  console.log('\nValidating that view calculations match direct recomputation...\n')
  console.log('Test Wallets:')
  TEST_WALLETS.forEach((w, i) => console.log(`  ${i + 1}. ${w}`))
  console.log('\n' + '='.repeat(80))

  try {
    // Recompute PnL from scratch and compare to view
    console.log('\n📊 Recompute Validation\n')
    console.log('Comparing view PnL vs. direct calculation from ledger + resolutions\n')

    const recomputeResult = await clickhouse.query({
      query: `
        WITH base AS (
          SELECT
            l.wallet_address,
            l.condition_id,
            l.outcome_index,
            sum(l.cash_delta_usdc) AS trade_cash,
            sum(l.shares_delta) AS final_shares
          FROM vw_pm_ledger l
          WHERE l.wallet_address IN (${TEST_WALLETS.map(w => `'${w}'`).join(', ')})
          GROUP BY l.wallet_address, l.condition_id, l.outcome_index
        ),
        res AS (
          SELECT
            condition_id,
            outcome_index,
            resolved_price
          FROM vw_pm_resolution_prices
        ),
        recomputed AS (
          SELECT
            b.wallet_address,
            sum(b.trade_cash + if(r.resolved_price IS NOT NULL, b.final_shares * r.resolved_price, 0)) AS recomputed_pnl
          FROM base b
          LEFT JOIN res r ON b.condition_id = r.condition_id AND b.outcome_index = r.outcome_index
          GROUP BY b.wallet_address
        ),
        view_pnl AS (
          SELECT
            wallet_address,
            sum(realized_pnl) AS view_pnl
          FROM vw_pm_realized_pnl_v1
          WHERE wallet_address IN (${TEST_WALLETS.map(w => `'${w}'`).join(', ')})
            AND is_resolved = 1
          GROUP BY wallet_address
        )
        SELECT
          COALESCE(r.wallet_address, v.wallet_address) AS wallet_address,
          COALESCE(r.recomputed_pnl, 0) AS recomputed_pnl,
          COALESCE(v.view_pnl, 0) AS view_pnl,
          COALESCE(r.recomputed_pnl, 0) - COALESCE(v.view_pnl, 0) AS diff
        FROM recomputed r
        FULL OUTER JOIN view_pnl v ON r.wallet_address = v.wallet_address
        ORDER BY abs(diff) DESC
      `,
      format: 'JSONEachRow',
    })
    const recompute = await recomputeResult.json() as Array<{
      wallet_address: string
      recomputed_pnl: number
      view_pnl: number
      diff: number
    }>

    console.log('Wallet Address                             | Recomputed PnL  | View PnL        | Difference      | Status')
    console.log('-'.repeat(125))

    let maxDiff = 0
    let passCount = 0
    let failCount = 0

    recompute.forEach(row => {
      const wallet = row.wallet_address.padEnd(42)
      const recomputed = `$${row.recomputed_pnl.toFixed(2)}`.padStart(15)
      const viewPnl = `$${row.view_pnl.toFixed(2)}`.padStart(15)
      const diff = `$${row.diff.toFixed(2)}`.padStart(15)

      const absDiff = Math.abs(row.diff)
      maxDiff = Math.max(maxDiff, absDiff)

      let status = ''
      if (absDiff < 0.01) {
        status = '✅ PERFECT'
        passCount++
      } else if (absDiff < 1.00) {
        status = '✅ GOOD'
        passCount++
      } else {
        status = '❌ FAIL'
        failCount++
      }

      console.log(`${wallet} | ${recomputed} | ${viewPnl} | ${diff} | ${status}`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Validation Summary\n')
    console.log(`Total Wallets Tested:  ${recompute.length}`)
    console.log(`Perfect Match (<$0.01): ${recompute.filter(r => Math.abs(r.diff) < 0.01).length}`)
    console.log(`Good Match (<$1.00):    ${recompute.filter(r => Math.abs(r.diff) < 1.00).length}`)
    console.log(`Failed (≥$1.00):        ${recompute.filter(r => Math.abs(r.diff) >= 1.00).length}`)
    console.log(`\nMax Absolute Diff:     $${maxDiff.toFixed(2)}`)

    console.log('\n' + '='.repeat(80))

    if (failCount === 0) {
      if (maxDiff < 0.01) {
        console.log('\n🎯 VALIDATION PASSED - PERFECT ALIGNMENT\n')
        console.log('   ✅ All wallets have perfect match (<$0.01 difference)')
        console.log('   ✅ View calculations are correct')
        console.log('   ✅ No mapping or aggregation bugs detected')
        console.log('\n   Ready to compare with Polymarket UI!')
        console.log('   Any remaining differences vs UI are due to:')
        console.log('     - Unrealized PnL (open positions)')
        console.log('     - CTF split/merge/redeem flows (not in V1)')
        console.log('     - Token mapping gaps (1.48%)')
      } else {
        console.log('\n✅ VALIDATION PASSED - GOOD ALIGNMENT\n')
        console.log(`   ✅ All wallets within acceptable tolerance (<$1.00 difference)`)
        console.log(`   ✅ Max difference: $${maxDiff.toFixed(2)} (rounding acceptable)`)
        console.log('   ✅ View calculations are correct')
      }
    } else {
      console.log('\n❌ VALIDATION FAILED - ALIGNMENT ISSUES DETECTED\n')
      console.log(`   ❌ ${failCount} wallet(s) have significant differences (≥$1.00)`)
      console.log('   ❌ Potential view/mapping glitch or aggregation bug')
      console.log('\n   Investigation needed:')
      console.log('     1. Check view JOIN logic')
      console.log('     2. Verify aggregation functions')
      console.log('     3. Review token mapping completeness')
    }

    console.log('\n' + '='.repeat(80))

    // Additional diagnostic: Check per-market alignment for worst wallet
    if (recompute.length > 0) {
      const worstWallet = recompute.reduce((max, row) =>
        Math.abs(row.diff) > Math.abs(max.diff) ? row : max
      )

      if (Math.abs(worstWallet.diff) > 0.01) {
        console.log('\n🔬 Deep Dive: Worst Wallet Market-Level Analysis\n')
        console.log(`Wallet: ${worstWallet.wallet_address}`)
        console.log(`Difference: $${worstWallet.diff.toFixed(2)}\n`)

        const marketAnalysisResult = await clickhouse.query({
          query: `
            WITH base AS (
              SELECT
                l.condition_id,
                l.outcome_index,
                sum(l.cash_delta_usdc) AS trade_cash,
                sum(l.shares_delta) AS final_shares
              FROM vw_pm_ledger l
              WHERE l.wallet_address = '${worstWallet.wallet_address}'
              GROUP BY l.condition_id, l.outcome_index
            ),
            res AS (
              SELECT
                condition_id,
                outcome_index,
                resolved_price
              FROM vw_pm_resolution_prices
            ),
            recomputed AS (
              SELECT
                b.condition_id,
                b.outcome_index,
                b.trade_cash + if(r.resolved_price IS NOT NULL, b.final_shares * r.resolved_price, 0) AS recomputed_pnl,
                r.resolved_price
              FROM base b
              LEFT JOIN res r ON b.condition_id = r.condition_id AND b.outcome_index = r.outcome_index
              WHERE r.resolved_price IS NOT NULL
            ),
            view_pnl AS (
              SELECT
                condition_id,
                outcome_index,
                realized_pnl AS view_pnl
              FROM vw_pm_realized_pnl_v1
              WHERE wallet_address = '${worstWallet.wallet_address}'
                AND is_resolved = 1
            )
            SELECT
              COALESCE(r.condition_id, v.condition_id) AS condition_id,
              COALESCE(r.outcome_index, v.outcome_index) AS outcome_index,
              COALESCE(r.recomputed_pnl, 0) AS recomputed_pnl,
              COALESCE(v.view_pnl, 0) AS view_pnl,
              COALESCE(r.recomputed_pnl, 0) - COALESCE(v.view_pnl, 0) AS diff
            FROM recomputed r
            FULL OUTER JOIN view_pnl v ON r.condition_id = v.condition_id AND r.outcome_index = v.outcome_index
            WHERE abs(diff) > 0.01
            ORDER BY abs(diff) DESC
            LIMIT 10
          `,
          format: 'JSONEachRow',
        })
        const marketAnalysis = await marketAnalysisResult.json() as Array<{
          condition_id: string
          outcome_index: number
          recomputed_pnl: number
          view_pnl: number
          diff: number
        }>

        if (marketAnalysis.length > 0) {
          console.log('Markets with differences >$0.01:')
          console.log('\nMarket (first 24)       | Out | Recomputed      | View PnL        | Diff')
          console.log('-'.repeat(85))
          marketAnalysis.forEach(row => {
            const market = row.condition_id.slice(0, 23).padEnd(23)
            const outcome = row.outcome_index.toString().padStart(3)
            const recomputed = `$${row.recomputed_pnl.toFixed(2)}`.padStart(15)
            const viewPnl = `$${row.view_pnl.toFixed(2)}`.padStart(15)
            const diff = `$${row.diff.toFixed(2)}`.padStart(10)
            console.log(`${market} | ${outcome} | ${recomputed} | ${viewPnl} | ${diff}`)
          })
        } else {
          console.log('✅ No individual market differences >$0.01 found')
          console.log('   Difference likely due to rounding accumulation')
        }
      }
    }

    console.log('\n' + '='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// Run the validation
validateRecompute()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
