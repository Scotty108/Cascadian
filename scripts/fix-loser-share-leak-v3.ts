/**
 * Step 1: Fix Loser-Share Leak in PnL View
 *
 * Issue: vw_pm_realized_pnl_v2 aggregates across all outcomes at once,
 * causing loser shares to "leak" into the final calculation.
 *
 * Example: "below $4.50 May" (ee3a38...)
 * - View shows: $26,187.88
 * - Recompute shows: $24,924.15
 * - Discrepancy: $1,263.73 (exactly matches outcome 0 loser shares!)
 *
 * Fix: Rebuild as V3 with per-outcome aggregation BEFORE any roll-up
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const TEST_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const TEST_MARKET = 'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2' // below $4.50 May

async function fixLoserShareLeak() {
  console.log('🔧 Step 1: Fix Loser-Share Leak in PnL View\n')
  console.log('='.repeat(80))

  try {
    // Step 1: Create V3 view with per-outcome aggregation
    console.log('\n1. Creating vw_pm_realized_pnl_v3 with per-outcome aggregation...\n')

    const createV3SQL = `
      CREATE OR REPLACE VIEW vw_pm_realized_pnl_v3 AS
      WITH per_outcome AS (
        -- Aggregate per-outcome FIRST (for correct resolution join)
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(cash_delta_usdc) AS outcome_trade_cash,
          sum(shares_delta) AS outcome_final_shares
        FROM vw_pm_ledger_v2
        GROUP BY wallet_address, condition_id, outcome_index
      ),
      with_resolution AS (
        -- Join with per-outcome resolution prices
        SELECT
          p.wallet_address,
          p.condition_id,
          p.outcome_index,
          p.outcome_trade_cash,
          p.outcome_final_shares,
          r.resolved_price,
          r.resolution_time
        FROM per_outcome p
        LEFT JOIN vw_pm_resolution_prices r
          ON p.condition_id = r.condition_id
         AND p.outcome_index = r.outcome_index
      )
      -- Roll up to MARKET level (prevents loser-share leak)
      -- KEY FIX: Net shares across ALL outcomes FIRST, then apply winner price
      -- This prevents double-counting loser shares in complete-set markets
      SELECT
        wallet_address,
        condition_id,
        sum(outcome_trade_cash) AS trade_cash,
        sum(outcome_final_shares) * max(if(resolved_price > 0, resolved_price, 0)) AS resolution_cash,
        sum(outcome_trade_cash) + sum(outcome_final_shares) * max(if(resolved_price > 0, resolved_price, 0)) AS realized_pnl,
        max(resolution_time) AS resolution_time,
        max(resolved_price IS NOT NULL) AS is_resolved
      FROM with_resolution
      GROUP BY wallet_address, condition_id
    `

    await clickhouse.command({ query: createV3SQL })
    console.log('✅ Created view: vw_pm_realized_pnl_v3')
    console.log('   Key fix: Per-outcome aggregation BEFORE resolution join')

    // Step 2: Test V3 against the problematic market
    console.log('\n2. Testing V3 against problematic market (ee3a38...)...\n')

    const v3TestResult = await clickhouse.query({
      query: `
        SELECT
          trade_cash,
          resolution_cash,
          realized_pnl,
          is_resolved,
          resolution_time
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND condition_id = '${TEST_MARKET}'
      `,
      format: 'JSONEachRow'
    })
    const v3Test = await v3TestResult.json() as Array<{
      trade_cash: number
      resolution_cash: number
      realized_pnl: number
      is_resolved: number
      resolution_time: string | null
    }>

    if (v3Test.length === 0) {
      console.log('❌ No results found for test market!')
      throw new Error('Test market not found in V3 view')
    }

    const v3Row = v3Test[0]
    console.log('V3 market-level calculation:\n')
    console.log(`Trade Cash:       $${v3Row.trade_cash.toFixed(2)}`)
    console.log(`Resolution Cash:  $${v3Row.resolution_cash.toFixed(2)}`)
    console.log(`Realized PnL:     $${v3Row.realized_pnl.toFixed(2)}`)
    console.log(`Is Resolved:      ${v3Row.is_resolved === 1 ? 'Yes' : 'No'}`)

    const totalPnL = v3Row.realized_pnl

    // Step 3: Compare V3 vs V2 vs Recompute
    console.log('\n3. Comparing V3 vs V2 vs Direct Recompute...\n')

    // V2 result
    const v2Result = await clickhouse.query({
      query: `
        SELECT sum(realized_pnl) AS pnl
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${TEST_WALLET}'
          AND condition_id = '${TEST_MARKET}'
      `,
      format: 'JSONEachRow'
    })
    const v2 = await v2Result.json() as Array<{ pnl: number | null }>
    const v2PnL = v2[0].pnl || 0

    // Direct recompute
    const recomputeResult = await clickhouse.query({
      query: `
        WITH ledger AS (
          SELECT
            sum(cash_delta_usdc) AS trade_cash,
            sum(shares_delta) AS final_shares
          FROM vw_pm_ledger_v2
          WHERE wallet_address = '${TEST_WALLET}'
            AND condition_id = '${TEST_MARKET}'
        ),
        pay AS (
          SELECT payout_numerators
          FROM pm_condition_resolutions
          WHERE lower(condition_id) = '${TEST_MARKET}'
        )
        SELECT
          l.trade_cash,
          l.final_shares,
          p.payout_numerators
        FROM ledger l
        CROSS JOIN pay p
      `,
      format: 'JSONEachRow'
    })
    const recompute = await recomputeResult.json() as Array<{
      trade_cash: number
      final_shares: number
      payout_numerators: string
    }>

    let recomputePnL = 0
    if (recompute.length > 0) {
      const r = recompute[0]
      const payouts = JSON.parse(r.payout_numerators) as number[]
      const winnerIndex = payouts.findIndex(p => p > 0)
      const payoutSum = payouts.reduce((sum, p) => sum + p, 0)
      const resolvedPrice = payoutSum > 0 ? payouts[winnerIndex] / payoutSum : 0
      recomputePnL = r.trade_cash + r.final_shares * resolvedPrice
    }

    console.log('Method          | PnL          | Difference from Recompute')
    console.log('-'.repeat(65))
    console.log(`V2 (OLD)        | $${v2PnL.toFixed(2).padStart(10)} | $${(v2PnL - recomputePnL).toFixed(2).padStart(10)} ❌`)
    console.log(`V3 (NEW)        | $${totalPnL.toFixed(2).padStart(10)} | $${(totalPnL - recomputePnL).toFixed(2).padStart(10)} ${Math.abs(totalPnL - recomputePnL) < 0.01 ? '✅' : '❌'}`)
    console.log(`Recompute       | $${recomputePnL.toFixed(2).padStart(10)} | $0.00 (baseline)`)

    // Step 4: Verify the fix
    console.log('\n4. Verification Results...\n')

    const v2Leak = v2PnL - recomputePnL
    const v3Leak = totalPnL - recomputePnL

    if (Math.abs(v2Leak - 1263.73) < 1) {
      console.log(`✅ V2 leak confirmed: $${v2Leak.toFixed(2)} (matches outcome 0 loser shares)`)
    } else {
      console.log(`⚠️  V2 leak: $${v2Leak.toFixed(2)} (expected ~$1,263.73)`)
    }

    if (Math.abs(v3Leak) < 0.01) {
      console.log(`✅ V3 leak FIXED: $${v3Leak.toFixed(2)} (no loser bleed!)`)
    } else {
      console.log(`❌ V3 still has leak: $${v3Leak.toFixed(2)}`)
    }

    // Step 5: Update data quality flag
    console.log('\n5. Updating data quality flag...\n')

    const updateFlagSQL = `
      INSERT INTO pm_market_data_quality (condition_id, data_quality, note, verified_at)
      VALUES (
        '${TEST_MARKET}',
        'ok',
        'Loser-share leak fixed in V3 view. View now matches recomputation.',
        now()
      )
    `

    if (Math.abs(v3Leak) < 0.01) {
      await clickhouse.command({ query: updateFlagSQL })
      console.log('✅ Updated quality flag: ee3a38... → ok (verified)')
    } else {
      console.log('⚠️  Skipping quality flag update - V3 still has discrepancy')
    }

    // Step 6: Create per-outcome detail view for debugging
    console.log('\n6. Creating per-outcome detail view (vw_pm_realized_pnl_v3_detail)...\n')

    const createDetailViewSQL = `
      CREATE OR REPLACE VIEW vw_pm_realized_pnl_v3_detail AS
      WITH per_outcome AS (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(cash_delta_usdc) AS outcome_trade_cash,
          sum(shares_delta) AS outcome_final_shares
        FROM vw_pm_ledger_v2
        GROUP BY wallet_address, condition_id, outcome_index
      )
      SELECT
        p.wallet_address,
        p.condition_id,
        p.outcome_index,
        p.outcome_trade_cash AS trade_cash,
        p.outcome_final_shares AS final_shares,
        r.resolved_price,
        r.resolution_time,
        if(r.resolved_price > 0, p.outcome_final_shares * r.resolved_price, 0) AS resolution_cash,
        (r.resolved_price IS NOT NULL) AS is_resolved
      FROM per_outcome p
      LEFT JOIN vw_pm_resolution_prices r
        ON p.condition_id = r.condition_id
       AND p.outcome_index = r.outcome_index
    `

    await clickhouse.command({ query: createDetailViewSQL })
    console.log('✅ Created view: vw_pm_realized_pnl_v3_detail')
    console.log('   Shows per-outcome detail for debugging (do NOT sum PnL from this view)')

    // Test detail view
    const detailTestResult = await clickhouse.query({
      query: `
        SELECT
          outcome_index,
          trade_cash,
          final_shares,
          resolved_price,
          resolution_cash
        FROM vw_pm_realized_pnl_v3_detail
        WHERE wallet_address = '${TEST_WALLET}'
          AND condition_id = '${TEST_MARKET}'
        ORDER BY outcome_index
      `,
      format: 'JSONEachRow'
    })
    const detailTest = await detailTestResult.json() as Array<{
      outcome_index: number
      trade_cash: number
      final_shares: number
      resolved_price: number | null
      resolution_cash: number
    }>

    console.log('\nPer-outcome detail (for reference):\n')
    console.log('Outcome | Trade Cash  | Final Shares | Resolved | Resolution Cash')
    console.log('-'.repeat(75))
    detailTest.forEach(row => {
      const outcome = row.outcome_index.toString().padStart(7)
      const tradeCash = `$${row.trade_cash.toFixed(2)}`.padStart(11)
      const shares = row.final_shares.toFixed(2).padStart(12)
      const resolved = (row.resolved_price !== null ? row.resolved_price.toFixed(2) : 'NULL').padStart(8)
      const resCash = `$${row.resolution_cash.toFixed(2)}`.padStart(15)
      console.log(`${outcome} | ${tradeCash} | ${shares} | ${resolved} | ${resCash}`)
    })
    console.log('\n⚠️  Note: Do NOT sum trade_cash from detail view - use market-level V3 view instead')

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n✅ STEP 1 COMPLETE\n')
    console.log('Created:')
    console.log('  - vw_pm_realized_pnl_v3 (market-level, leak-free)')
    console.log('  - vw_pm_realized_pnl_v3_detail (per-outcome detail for debugging)')
    console.log()
    console.log('Fix verified:')
    console.log(`  - V2 leak: $${v2Leak.toFixed(2)} (loser-share bleed)`)
    console.log(`  - V3 leak: $${v3Leak.toFixed(2)} ${Math.abs(v3Leak) < 0.01 ? '(FIXED! ✅)' : '(still has issue ❌)'}`)
    console.log(`  - Test market PnL: $${totalPnL.toFixed(2)} (${Math.abs(totalPnL - recomputePnL) < 0.01 ? 'matches' : 'differs from'} recompute)`)
    console.log()
    if (Math.abs(v3Leak) < 0.01) {
      console.log('Data quality updated:')
      console.log('  - ee3a38... → ok (verified)')
    } else {
      console.log('⚠️  Data quality NOT updated - V3 still has discrepancy')
    }
    console.log()
    console.log('Next: Step 2 - Design & build full CTF ledger (splits/merges/redeems)')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

fixLoserShareLeak()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
