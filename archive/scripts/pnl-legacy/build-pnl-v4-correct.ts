/**
 * Build PnL V4 - CORRECT Per-Outcome Multiplication
 *
 * V3 Bug: Nets shares across outcomes BEFORE applying price
 *   sum(shares) * max(price) = WRONG
 *
 * V4 Fix: Multiplies price per outcome BEFORE summing
 *   sum(shares_i * price_i) = CORRECT
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const EGG_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const TEST_MARKET = 'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2'

async function buildPnLV4() {
  console.log('🔧 Build PnL V4 - Correct Per-Outcome Multiplication\n')
  console.log('='.repeat(80))

  try {
    // Step 1: Create V4 view with CORRECT per-outcome multiplication
    console.log('\n1. Creating vw_pm_realized_pnl_v4 (CORRECT formula)...\n')

    const createV4SQL = `
      CREATE OR REPLACE VIEW vw_pm_realized_pnl_v4 AS
      WITH per_outcome AS (
        -- Step 1: Aggregate per-outcome
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
        -- Step 2: Join with per-outcome resolution prices
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
      ),
      per_outcome_pnl AS (
        -- Step 3: CRITICAL FIX - Multiply shares by price PER OUTCOME
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          outcome_trade_cash,
          if(resolved_price IS NOT NULL, outcome_final_shares * resolved_price, 0) AS outcome_resolution_cash,
          resolved_price,
          resolution_time
        FROM with_resolution
      )
      -- Step 4: Market-level rollup - SUM resolution cash across outcomes
      SELECT
        wallet_address,
        condition_id,
        sum(outcome_trade_cash) AS trade_cash,
        sum(outcome_resolution_cash) AS resolution_cash,
        sum(outcome_trade_cash) + sum(outcome_resolution_cash) AS realized_pnl,
        max(resolution_time) AS resolution_time,
        max(resolved_price IS NOT NULL) AS is_resolved
      FROM per_outcome_pnl
      GROUP BY wallet_address, condition_id
    `

    await clickhouse.command({ query: createV4SQL })
    console.log('✅ Created view: vw_pm_realized_pnl_v4')
    console.log('   Key fix: Multiply shares * price PER OUTCOME, then sum')

    // Step 2: Validate V4 against test market
    console.log('\n2. Validating V4 against test market (ee3a38...)...\n')

    const v4Result = await clickhouse.query({
      query: `
        SELECT
          trade_cash,
          resolution_cash,
          realized_pnl,
          is_resolved
        FROM vw_pm_realized_pnl_v4
        WHERE wallet_address = '${EGG_WALLET}'
          AND condition_id = '${TEST_MARKET}'
      `,
      format: 'JSONEachRow'
    })
    const v4 = await v4Result.json() as Array<{
      trade_cash: number
      resolution_cash: number
      realized_pnl: number
      is_resolved: number
    }>

    if (v4.length === 0) {
      throw new Error('Test market not found in V4 view')
    }

    const v4Row = v4[0]
    console.log('V4 Calculation:')
    console.log(`  Trade Cash:       $${v4Row.trade_cash.toFixed(2)}`)
    console.log(`  Resolution Cash:  $${v4Row.resolution_cash.toFixed(2)}`)
    console.log(`  Realized PnL:     $${v4Row.realized_pnl.toFixed(2)}`)

    // Step 3: Compare V2 vs V3 vs V4 for egg wallet
    console.log('\n3. Comparing V2 vs V3 vs V4 (Egg Wallet, Resolved Only)...\n')

    const comparisonResult = await clickhouse.query({
      query: `
        SELECT 'V2' AS version, sum(realized_pnl) AS pnl, countDistinct(condition_id) AS markets
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${EGG_WALLET}' AND is_resolved = 1
        UNION ALL
        SELECT 'V3', sum(realized_pnl), countDistinct(condition_id)
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${EGG_WALLET}' AND is_resolved = 1
        UNION ALL
        SELECT 'V4', sum(realized_pnl), countDistinct(condition_id)
        FROM vw_pm_realized_pnl_v4
        WHERE wallet_address = '${EGG_WALLET}' AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const comparison = await comparisonResult.json() as Array<{
      version: string
      pnl: number
      markets: string
    }>

    console.log('Version | Realized PnL      | Markets | Status')
    console.log('-'.repeat(65))
    comparison.forEach(r => {
      const ver = r.version.padEnd(7)
      const pnl = (`$${parseFloat(r.pnl).toLocaleString(undefined, {maximumFractionDigits: 2})}`).padStart(17)
      const markets = r.markets.toString().padStart(7)
      let status = ''
      if (r.version === 'V2') status = '(baseline)'
      if (r.version === 'V3') status = '❌ BROKEN (-$177K)'
      if (r.version === 'V4') {
        const v2Pnl = parseFloat(comparison.find(c => c.version === 'V2')?.pnl || 0)
        const v4Pnl = parseFloat(r.pnl)
        const delta = Math.abs(v4Pnl - v2Pnl)
        status = delta < 100 ? '✅ MATCHES V2' : `⚠️ Differs by $${delta.toFixed(2)}`
      }
      console.log(`${ver} | ${pnl} | ${markets} | ${status}`)
    })

    // Step 4: Direct recompute validation
    console.log('\n4. Validating V4 against direct recompute...\n')

    const recomputeResult = await clickhouse.query({
      query: `
        WITH ledger AS (
          SELECT
            outcome_index,
            sum(cash_delta_usdc) AS trade_cash,
            sum(shares_delta) AS final_shares
          FROM vw_pm_ledger_v2
          WHERE wallet_address = '${EGG_WALLET}'
            AND condition_id = '${TEST_MARKET}'
          GROUP BY outcome_index
        ),
        resolutions AS (
          SELECT outcome_index, resolved_price
          FROM vw_pm_resolution_prices
          WHERE condition_id = '${TEST_MARKET}'
        )
        SELECT
          sum(l.trade_cash) AS total_trade_cash,
          sum(l.final_shares * COALESCE(r.resolved_price, 0)) AS total_resolution_cash
        FROM ledger l
        LEFT JOIN resolutions r USING (outcome_index)
      `,
      format: 'JSONEachRow'
    })
    const recompute = await recomputeResult.json() as Array<{
      total_trade_cash: number
      total_resolution_cash: number
    }>

    const recomputeTrade = recompute[0].total_trade_cash
    const recomputeRes = recompute[0].total_resolution_cash
    const recomputePnL = recomputeTrade + recomputeRes

    console.log('Direct Recompute:')
    console.log(`  Trade Cash:       $${recomputeTrade.toFixed(2)}`)
    console.log(`  Resolution Cash:  $${recomputeRes.toFixed(2)}`)
    console.log(`  Realized PnL:     $${recomputePnL.toFixed(2)}`)

    console.log('\nV4 vs Recompute:')
    console.log(`  Trade Cash Δ:     $${(v4Row.trade_cash - recomputeTrade).toFixed(2)}`)
    console.log(`  Res Cash Δ:       $${(v4Row.resolution_cash - recomputeRes).toFixed(2)}`)
    console.log(`  PnL Δ:            $${(v4Row.realized_pnl - recomputePnL).toFixed(2)}`)

    const v4Matches = Math.abs(v4Row.realized_pnl - recomputePnL) < 0.01

    if (v4Matches) {
      console.log('\n✅ V4 MATCHES direct recompute perfectly!')
    } else {
      console.log('\n❌ V4 does NOT match recompute - investigate further')
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 SUMMARY\n')

    const v2Pnl = parseFloat(comparison.find(c => c.version === 'V2')?.pnl || 0)
    const v3Pnl = parseFloat(comparison.find(c => c.version === 'V3')?.pnl || 0)
    const v4Pnl = parseFloat(comparison.find(c => c.version === 'V4')?.pnl || 0)

    console.log('Egg Wallet (Resolved Only):')
    console.log(`  V2: $${v2Pnl.toLocaleString(undefined, {maximumFractionDigits: 2})} (baseline)`)
    console.log(`  V3: $${v3Pnl.toLocaleString(undefined, {maximumFractionDigits: 2})} (BROKEN - off by $${(v2Pnl - v3Pnl).toLocaleString()})`)
    console.log(`  V4: $${v4Pnl.toLocaleString(undefined, {maximumFractionDigits: 2})} ${Math.abs(v4Pnl - v2Pnl) < 100 ? '(✅ CORRECT)' : '(⚠️ DIFFERS)'}`)

    console.log('\nTest Market (ee3a38...):')
    console.log(`  V4 PnL:        $${v4Row.realized_pnl.toFixed(2)}`)
    console.log(`  Recompute PnL: $${recomputePnL.toFixed(2)}`)
    console.log(`  Match:         ${v4Matches ? '✅ Yes' : '❌ No'}`)

    if (v4Matches && Math.abs(v4Pnl - v2Pnl) < 100) {
      console.log('\n✅ V4 IS CANONICAL')
      console.log('   - Matches direct recompute')
      console.log('   - Aligns with V2 baseline')
      console.log('   - Fixes V3 per-outcome bug')
      console.log('\nNext steps:')
      console.log('  1. Deprecate V3 (BROKEN)')
      console.log('  2. Use V4 for all queries')
      console.log('  3. Update data quality views to use V4')
      console.log('  4. Run UI parity spot checks with V4')
    } else {
      console.log('\n⚠️  V4 NEEDS INVESTIGATION')
      console.log('   V4 does not match expected baseline')
    }

    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

buildPnLV4()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
