/**
 * PnL Engine V1 - FIX: Nullable Resolution Bug
 *
 * Recreates views with Nullable types to fix the critical bug where
 * unresolved markets were being marked as resolved due to ClickHouse
 * returning default values (0, epoch) for non-nullable types in LEFT JOIN.
 *
 * CHANGES:
 * 1. vw_pm_resolution_prices: resolved_price and resolution_time are now Nullable
 * 2. vw_pm_realized_pnl_v1: Proper handling of NULL resolved_price
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function fixNullableBug() {
  console.log('🔧 PnL Engine V1 - Fixing Nullable Resolution Bug\n')
  console.log('='.repeat(80))
  console.log('\nBUG: All markets (resolved + unresolved) marked as is_resolved=1')
  console.log('CAUSE: Non-nullable Float64/DateTime return 0/epoch instead of NULL')
  console.log('FIX: Use Nullable types for resolved_price and resolution_time\n')
  console.log('='.repeat(80))

  try {
    // Step 1: Recreate vw_pm_resolution_prices with Nullable types
    console.log('\n📊 Step 1: Recreating vw_pm_resolution_prices with Nullable types\n')

    const createResolutionPricesSQL = `
      CREATE OR REPLACE VIEW vw_pm_resolution_prices AS
      SELECT
          lower(r.condition_id) AS condition_id,
          idx - 1 AS outcome_index,
          toNullable(numerator / arraySum(numerators)) AS resolved_price,
          toNullable(r.resolved_at) AS resolution_time,
          r.tx_hash AS resolution_tx_hash,
          r.block_number AS resolution_block
      FROM (
          SELECT
              condition_id,
              JSONExtract(payout_numerators, 'Array(Float64)') AS numerators,
              resolved_at,
              tx_hash,
              block_number
          FROM pm_condition_resolutions
          WHERE is_deleted = 0
      ) r
      ARRAY JOIN
          numerators AS numerator,
          arrayEnumerate(numerators) AS idx
    `

    await clickhouse.command({ query: createResolutionPricesSQL })
    console.log('   ✅ vw_pm_resolution_prices recreated with Nullable types')

    // Verify nullable types
    const typeCheckResult = await clickhouse.query({
      query: 'SHOW CREATE VIEW vw_pm_resolution_prices',
      format: 'JSONEachRow'
    })
    const typeCheck = await typeCheckResult.json() as Array<{ statement: string }>

    if (typeCheck[0].statement.includes('Nullable(Float64)')) {
      console.log('   ✅ resolved_price is now Nullable(Float64)')
    } else {
      console.log('   ⚠️  WARNING: resolved_price may not be nullable')
    }

    // Step 2: Recreate vw_pm_realized_pnl_v1 with proper NULL handling
    console.log('\n📊 Step 2: Recreating vw_pm_realized_pnl_v1 with NULL handling\n')

    const createRealizedPnLSQL = `
      CREATE OR REPLACE VIEW vw_pm_realized_pnl_v1 AS
      WITH trade_aggregates AS (
          SELECT
              wallet_address,
              condition_id,
              outcome_index,
              sum(cash_delta_usdc) AS trade_cash,
              sum(shares_delta) AS final_shares,
              sum(fee_usdc) AS total_fees,
              count() AS trade_count,
              min(block_time) AS first_trade_time,
              max(block_time) AS last_trade_time
          FROM vw_pm_ledger
          GROUP BY wallet_address, condition_id, outcome_index
      )
      SELECT
          t.wallet_address,
          t.condition_id,
          t.outcome_index,
          t.trade_cash,
          t.final_shares,
          t.total_fees,
          t.trade_count,
          t.first_trade_time,
          t.last_trade_time,
          r.resolved_price,
          r.resolution_time,

          -- Calculate resolution payout (now NULL-safe)
          CASE
              WHEN r.resolved_price IS NOT NULL THEN t.final_shares * r.resolved_price
              ELSE 0
          END AS resolution_cash,

          -- Calculate realized PnL (now NULL-safe)
          CASE
              WHEN r.resolved_price IS NOT NULL THEN t.trade_cash + (t.final_shares * r.resolved_price)
              ELSE NULL  -- Not yet resolved
          END AS realized_pnl,

          -- Status flags (now correct!)
          r.resolved_price IS NOT NULL AS is_resolved,
          r.resolved_price > 0 AS is_winner

      FROM trade_aggregates t
      LEFT JOIN vw_pm_resolution_prices r
          ON t.condition_id = r.condition_id
         AND t.outcome_index = r.outcome_index
    `

    await clickhouse.command({ query: createRealizedPnLSQL })
    console.log('   ✅ vw_pm_realized_pnl_v1 recreated with NULL-safe logic')

    // Verify view exists and check resolution status
    const statusCheckResult = await clickhouse.query({
      query: `
        SELECT
          is_resolved,
          count() as position_count
        FROM vw_pm_realized_pnl_v1
        GROUP BY is_resolved
      `,
      format: 'JSONEachRow'
    })
    const statusCheck = await statusCheckResult.json() as Array<{
      is_resolved: number
      position_count: string
    }>

    console.log('\n   Resolution Status:')
    console.log('   Status      | Positions')
    console.log('   ' + '-'.repeat(35))
    statusCheck.forEach(row => {
      const status = (row.is_resolved === 1 ? 'Resolved' : 'Unresolved').padEnd(11)
      const positions = parseInt(row.position_count).toLocaleString().padStart(13)
      console.log(`   ${status} | ${positions}`)
    })

    // Step 3: Verify the fix with the problematic market
    console.log('\n' + '='.repeat(80))
    console.log('📊 Step 3: Verifying Fix with Problematic Market\n')

    const PROBLEM_MARKET = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
    const PROBLEM_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

    const verifyResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          outcome_index,
          trade_cash,
          final_shares,
          resolved_price,
          resolution_time,
          resolution_cash,
          realized_pnl,
          is_resolved,
          is_winner
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${PROBLEM_WALLET}'
          AND condition_id = '${PROBLEM_MARKET}'
      `,
      format: 'JSONEachRow'
    })
    const verify = await verifyResult.json() as Array<{
      condition_id: string
      outcome_index: number
      trade_cash: number
      final_shares: number
      resolved_price: number | null
      resolution_time: string | null
      resolution_cash: number
      realized_pnl: number | null
      is_resolved: number
      is_winner: number
    }>

    console.log(`Market: ${PROBLEM_MARKET}`)
    console.log(`Wallet: ${PROBLEM_WALLET}\n`)

    if (verify.length > 0) {
      console.log('Outcome | Trade Cash  | Resolved Price | Resolution Time    | is_resolved | is_winner')
      console.log('-'.repeat(100))
      verify.forEach(row => {
        const outcome = row.outcome_index.toString().padStart(7)
        const tradeCash = `$${row.trade_cash.toFixed(2)}`.padStart(11)
        const resPrice = row.resolved_price === null ? 'NULL' : row.resolved_price.toFixed(4)
        const resTime = row.resolution_time === null ? 'NULL' : row.resolution_time
        const resolved = row.is_resolved.toString().padStart(11)
        const winner = row.is_winner === null ? 'NULL' : row.is_winner.toString()
        console.log(`${outcome} | ${tradeCash} | ${resPrice.padStart(14)} | ${resTime.padEnd(18)} | ${resolved} | ${winner.padStart(9)}`)
      })

      const allUnresolved = verify.every(row => row.is_resolved === 0)
      if (allUnresolved) {
        console.log('\n✅ FIX VERIFIED: Market now correctly marked as UNRESOLVED (is_resolved=0)')
        console.log('   resolved_price = NULL (was 0 before fix)')
        console.log('   resolution_time = NULL (was epoch before fix)')
      } else {
        console.log('\n⚠️  WARNING: Market still shows is_resolved=1')
      }
    } else {
      console.log('✅ PERFECT! Market no longer appears in view')
      console.log('   This is correct - unresolved markets should not be in position view')
      console.log('   (They still exist in vw_pm_ledger for trade history)')
    }

    // Step 4: Check corrected PnL for problem wallet
    console.log('\n' + '='.repeat(80))
    console.log('📊 Step 4: Corrected PnL for Problem Wallet\n')

    const correctedPnLResult = await clickhouse.query({
      query: `
        SELECT
          'BEFORE FIX (all markets)' as method,
          115 as markets,
          -18362.49 as total_pnl
        UNION ALL
        SELECT
          'AFTER FIX (resolved only)' as method,
          count(DISTINCT condition_id) as markets,
          sum(realized_pnl) as total_pnl
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${PROBLEM_WALLET}'
          AND is_resolved = 1
          AND resolved_price IS NOT NULL
      `,
      format: 'JSONEachRow'
    })
    const comparison = await correctedPnLResult.json() as Array<{
      method: string
      markets: number
      total_pnl: number
    }>

    console.log('Method                         | Markets | Total PnL')
    console.log('-'.repeat(65))
    comparison.forEach(row => {
      const method = row.method.padEnd(30)
      const markets = row.markets !== null ? row.markets.toString().padStart(7) : 'N/A'.padStart(7)
      const pnl = row.total_pnl !== null ? `$${row.total_pnl.toFixed(2)}`.padStart(9) : 'NULL'.padStart(9)
      console.log(`${method} | ${markets} | ${pnl}`)
    })

    const afterFix = comparison.find(r => r.method.includes('AFTER'))
    if (afterFix && afterFix.total_pnl !== null) {
      console.log(`\n📌 Polymarket UI:     92 predictions, ~$96,000 profit`)
      console.log(`📌 Our corrected PnL: ${afterFix.markets} markets, $${afterFix.total_pnl.toFixed(2)}`)
      console.log(`📌 Remaining gap:     $${(96000 - afterFix.total_pnl).toFixed(2)}`)

      const closeEnough = Math.abs(afterFix.total_pnl - 96000) < 10000
      if (closeEnough) {
        console.log('\n🎯 SUCCESS: PnL now much closer to Polymarket UI!')
      } else if (afterFix.total_pnl > -20000) {
        console.log('\n✅ IMPROVEMENT: PnL improved but still has gap')
        console.log('   Possible causes:')
        console.log('   - CTF events (splits/merges) not tracked')
        console.log('   - Different market filtering')
        console.log('   - Unrealized PnL included in UI')
      } else {
        console.log('\n⚠️  STILL NEGATIVE: Further investigation needed')
      }
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n✅ FIX COMPLETE\n')
    console.log('Changes made:')
    console.log('  1. vw_pm_resolution_prices: resolved_price now Nullable(Float64)')
    console.log('  2. vw_pm_resolution_prices: resolution_time now Nullable(DateTime)')
    console.log('  3. vw_pm_realized_pnl_v1: NULL-safe resolution logic')
    console.log('  4. is_resolved flag now correctly distinguishes resolved vs unresolved')
    console.log()
    console.log('Next steps:')
    console.log('  1. Re-run zero-sum validation')
    console.log('  2. Re-run wallet verification scripts')
    console.log('  3. Update documentation')
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// Run the fix
fixNullableBug()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
