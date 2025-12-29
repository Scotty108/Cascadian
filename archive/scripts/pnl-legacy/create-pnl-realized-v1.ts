/**
 * PnL Engine V1 - Step 2B: Create Realized PnL View
 *
 * Creates vw_pm_realized_pnl_v1 that combines:
 * - Trade cash flows from vw_pm_ledger
 * - Resolution payouts from vw_pm_resolution_prices
 *
 * Per PNL_ENGINE_CANONICAL_SPEC.md:
 * - Aggregates per (wallet, condition_id, outcome_index)
 * - trade_cash = SUM(cash_delta_usdc)
 * - final_shares = SUM(shares_delta)
 * - resolution_cash = final_shares * resolved_price
 * - realized_pnl = trade_cash + resolution_cash
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function createRealizedPnLView() {
  console.log('🏗️  PnL Engine V1 - Step 2B: Creating Realized PnL View\n')
  console.log('=' .repeat(80))

  try {
    // Step 1: Create the realized PnL view
    console.log('\n📊 Step 1: Creating vw_pm_realized_pnl_v1 VIEW...\n')

    const createViewSQL = `
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

          -- Resolution data
          r.resolved_price,
          r.resolution_time,

          -- Calculate resolution payout
          CASE
              WHEN r.resolved_price IS NOT NULL THEN t.final_shares * r.resolved_price
              ELSE 0
          END AS resolution_cash,

          -- Calculate realized PnL
          CASE
              WHEN r.resolved_price IS NOT NULL THEN t.trade_cash + (t.final_shares * r.resolved_price)
              ELSE NULL  -- Not yet resolved
          END AS realized_pnl,

          -- Status flags
          r.resolved_price IS NOT NULL AS is_resolved,
          r.resolved_price > 0 AS is_winner

      FROM trade_aggregates t
      LEFT JOIN vw_pm_resolution_prices r
          ON t.condition_id = r.condition_id
         AND t.outcome_index = r.outcome_index
    `

    await clickhouse.command({ query: createViewSQL })
    console.log('   ✅ View created successfully')

    // Verify view exists
    const viewCheck = await clickhouse.query({
      query: "SELECT count() as total FROM vw_pm_realized_pnl_v1 LIMIT 1",
      format: 'JSONEachRow',
    })
    const viewCount = await viewCheck.json() as Array<{ total: string }>
    console.log(`   📈 Total wallet-market-outcome positions: ${parseInt(viewCount[0].total).toLocaleString()}`)

    console.log('\n' + '='.repeat(80))
    console.log('🔍 VALIDATION CHECKS\n')

    // Check 1: Resolution status
    console.log('📊 Check 1: Resolution Status\n')
    const resolutionStatusResult = await clickhouse.query({
      query: `
        SELECT
          is_resolved,
          count() as position_count,
          sum(trade_count) as total_trades
        FROM vw_pm_realized_pnl_v1
        GROUP BY is_resolved
      `,
      format: 'JSONEachRow',
    })
    const resolutionStatus = await resolutionStatusResult.json() as Array<{
      is_resolved: number
      position_count: string
      total_trades: string
    }>

    console.log('   Status      | Positions     | Trades')
    console.log('   ' + '-'.repeat(50))
    resolutionStatus.forEach(row => {
      const status = (row.is_resolved === 1 ? 'Resolved' : 'Unresolved').padEnd(11)
      const positions = parseInt(row.position_count).toLocaleString().padStart(13)
      const trades = parseInt(row.total_trades).toLocaleString().padStart(10)
      console.log(`   ${status} | ${positions} | ${trades}`)
    })

    // Check 2: Winner/Loser distribution
    console.log('\n📊 Check 2: Winner/Loser Distribution (Resolved Only)\n')
    const winnerDistResult = await clickhouse.query({
      query: `
        SELECT
          is_winner,
          count() as position_count,
          avg(realized_pnl) as avg_pnl,
          sum(realized_pnl) as total_pnl
        FROM vw_pm_realized_pnl_v1
        WHERE is_resolved = 1
        GROUP BY is_winner
      `,
      format: 'JSONEachRow',
    })
    const winnerDist = await winnerDistResult.json() as Array<{
      is_winner: number
      position_count: string
      avg_pnl: number
      total_pnl: number
    }>

    console.log('   Type   | Positions     | Avg PnL      | Total PnL')
    console.log('   ' + '-'.repeat(60))
    winnerDist.forEach(row => {
      const type = (row.is_winner === 1 ? 'Winner' : 'Loser').padEnd(6)
      const positions = parseInt(row.position_count).toLocaleString().padStart(13)
      const avgPnl = `$${row.avg_pnl.toFixed(2)}`.padStart(12)
      const totalPnl = `$${row.total_pnl.toFixed(2)}`.padStart(15)
      console.log(`   ${type} | ${positions} | ${avgPnl} | ${totalPnl}`)
    })

    // Check 3: Sample resolved positions
    console.log('\n📊 Check 3: Sample Resolved Positions\n')
    const sampleResolvedResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          trade_cash,
          final_shares,
          resolved_price,
          resolution_cash,
          realized_pnl,
          is_winner
        FROM vw_pm_realized_pnl_v1
        WHERE is_resolved = 1
          AND abs(final_shares) > 0.01
        ORDER BY abs(realized_pnl) DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const sampleResolved = await sampleResolvedResult.json() as Array<{
      wallet_address: string
      condition_id: string
      outcome_index: number
      trade_cash: number
      final_shares: number
      resolved_price: number
      resolution_cash: number
      realized_pnl: number
      is_winner: number
    }>

    console.log('   Wallet (first 10)  | Out | Trade $   | Shares    | Res $ | PnL $     | Win')
    console.log('   ' + '-'.repeat(85))
    sampleResolved.forEach(row => {
      const wallet = row.wallet_address.slice(0, 10)
      const outcome = row.outcome_index.toString().padStart(3)
      const tradeCash = row.trade_cash.toFixed(2).padStart(9)
      const shares = row.final_shares.toFixed(2).padStart(9)
      const resCash = row.resolution_cash.toFixed(2).padStart(5)
      const pnl = row.realized_pnl.toFixed(2).padStart(9)
      const win = row.is_winner === 1 ? 'Y' : 'N'
      console.log(`   ${wallet} | ${outcome} | ${tradeCash} | ${shares} | ${resCash} | ${pnl} | ${win}`)
    })

    // Check 4: Wallet-level PnL
    console.log('\n📊 Check 4: Top 10 Wallets by Realized PnL\n')
    const topWalletsResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          sum(realized_pnl) as total_realized_pnl,
          count() as resolved_positions,
          sum(trade_count) as total_trades
        FROM vw_pm_realized_pnl_v1
        WHERE is_resolved = 1
        GROUP BY wallet_address
        ORDER BY total_realized_pnl DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const topWallets = await topWalletsResult.json() as Array<{
      wallet_address: string
      total_realized_pnl: number
      resolved_positions: string
      total_trades: string
    }>

    console.log('   Wallet Address (first 16)  | Realized PnL  | Positions | Trades')
    console.log('   ' + '-'.repeat(75))
    topWallets.forEach(row => {
      const wallet = row.wallet_address.slice(0, 24).padEnd(24)
      const pnl = `$${row.total_realized_pnl.toFixed(2)}`.padStart(13)
      const positions = parseInt(row.resolved_positions).toLocaleString().padStart(9)
      const trades = parseInt(row.total_trades).toLocaleString().padStart(6)
      console.log(`   ${wallet} | ${pnl} | ${positions} | ${trades}`)
    })

    // Check 5: PnL distribution
    console.log('\n📊 Check 5: Realized PnL Distribution\n')
    const pnlDistResult = await clickhouse.query({
      query: `
        WITH pnl_buckets AS (
          SELECT
            CASE
              WHEN realized_pnl < -1000 THEN '< -$1000'
              WHEN realized_pnl >= -1000 AND realized_pnl < -100 THEN '-$1000 to -$100'
              WHEN realized_pnl >= -100 AND realized_pnl < -10 THEN '-$100 to -$10'
              WHEN realized_pnl >= -10 AND realized_pnl < 0 THEN '-$10 to $0'
              WHEN realized_pnl >= 0 AND realized_pnl < 10 THEN '$0 to $10'
              WHEN realized_pnl >= 10 AND realized_pnl < 100 THEN '$10 to $100'
              WHEN realized_pnl >= 100 AND realized_pnl < 1000 THEN '$100 to $1000'
              ELSE '> $1000'
            END AS bucket,
            realized_pnl
          FROM vw_pm_realized_pnl_v1
          WHERE is_resolved = 1
        )
        SELECT
          bucket,
          count() as count,
          sum(realized_pnl) as total_pnl
        FROM pnl_buckets
        GROUP BY bucket
        ORDER BY
          CASE bucket
            WHEN '< -$1000' THEN 1
            WHEN '-$1000 to -$100' THEN 2
            WHEN '-$100 to -$10' THEN 3
            WHEN '-$10 to $0' THEN 4
            WHEN '$0 to $10' THEN 5
            WHEN '$10 to $100' THEN 6
            WHEN '$100 to $1000' THEN 7
            ELSE 8
          END
      `,
      format: 'JSONEachRow',
    })
    const pnlDist = await pnlDistResult.json() as Array<{
      bucket: string
      count: string
      total_pnl: number
    }>

    console.log('   Bucket             | Count      | Total PnL')
    console.log('   ' + '-'.repeat(55))
    pnlDist.forEach(row => {
      const bucket = row.bucket.padEnd(18)
      const count = parseInt(row.count).toLocaleString().padStart(10)
      const totalPnl = `$${row.total_pnl.toFixed(2)}`.padStart(15)
      console.log(`   ${bucket} | ${count} | ${totalPnl}`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('\n✅ Realized PnL View Creation Complete!\n')

    console.log('📋 Summary:')
    console.log('   - View combines trade cash flows + resolution payouts')
    console.log('   - Aggregated per (wallet, condition_id, outcome_index)')
    console.log('   - realized_pnl = trade_cash + (final_shares × resolved_price)')
    console.log('   - NULL for unresolved markets (no PnL yet)')
    console.log()
    console.log('📋 Next Steps:')
    console.log('   1. Run zero-sum validation on resolved markets')
    console.log('   2. Spot-check random wallets against known data')
    console.log('   3. (Optional) Investigate 1.48% join-gap')
    console.log('=' .repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// Run the script
createRealizedPnLView()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
