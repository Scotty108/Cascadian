/**
 * Internal Reconciliation for Wallet
 *
 * Clean analysis using only our data (no external UI API)
 * Goals:
 * 1. Count total traded vs resolved vs unresolved markets
 * 2. Identify unresolved markets (likely the "missing" predictions)
 * 3. Audit egg market PnL
 * 4. Quantify gap from unresolved positions
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function internalReconciliation() {
  console.log('🔍 Internal Wallet Reconciliation\n')
  console.log('='.repeat(80))
  console.log(`\nWallet: ${WALLET}\n`)
  console.log('='.repeat(80))

  try {
    // Query 1: Total markets traded
    console.log('\n📊 Query 1: Total Markets Traded\n')

    const totalTradedResult = await clickhouse.query({
      query: `
        SELECT countDistinct(condition_id) AS total_traded
        FROM vw_pm_ledger_v2
        WHERE wallet_address = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const totalTraded = await totalTradedResult.json() as Array<{ total_traded: string }>

    console.log(`Total distinct markets traded: ${parseInt(totalTraded[0].total_traded)}`)

    // Query 2: Resolved vs Unresolved breakdown
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 2: Resolved vs Unresolved Markets\n')

    const resolvedBreakdownResult = await clickhouse.query({
      query: `
        SELECT
          is_resolved,
          countDistinct(condition_id) AS markets
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${WALLET}'
        GROUP BY is_resolved
        ORDER BY is_resolved DESC
      `,
      format: 'JSONEachRow'
    })
    const resolvedBreakdown = await resolvedBreakdownResult.json() as Array<{
      is_resolved: number
      markets: string
    }>

    console.log('Status      | Markets')
    console.log('-'.repeat(30))
    resolvedBreakdown.forEach(row => {
      const status = (row.is_resolved === 1 ? 'Resolved' : 'Unresolved').padEnd(11)
      const count = parseInt(row.markets).toString().padStart(7)
      console.log(`${status} | ${count}`)
    })

    const resolvedCount = resolvedBreakdown.find(r => r.is_resolved === 1)
    const unresolvedCount = resolvedBreakdown.find(r => r.is_resolved === 0)

    console.log()
    console.log(`Resolved markets:   ${resolvedCount ? parseInt(resolvedCount.markets) : 0}`)
    console.log(`Unresolved markets: ${unresolvedCount ? parseInt(unresolvedCount.markets) : 0}`)
    console.log()
    console.log('💡 The "missing" markets (92 - 87 = 5) might be unresolved!')

    // Query 3: Unresolved markets with trade cash
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 3: Unresolved Markets (Still Open)\n')

    const unresolvedMarketsResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          sum(trade_cash) AS trade_cash_usdc,
          sum(final_shares) AS shares,
          count(*) AS positions
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 0
        GROUP BY condition_id
        ORDER BY abs(trade_cash_usdc) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })
    const unresolvedMarkets = await unresolvedMarketsResult.json() as Array<{
      condition_id: string
      trade_cash_usdc: number
      shares: number
      positions: string
    }>

    if (unresolvedMarkets.length > 0) {
      console.log('Top Unresolved Markets (by absolute trade cash):\n')
      console.log('Condition ID (first 24)   | Trade Cash  | Shares      | Positions')
      console.log('-'.repeat(75))
      unresolvedMarkets.forEach(row => {
        const condId = row.condition_id.slice(0, 23).padEnd(23)
        const cash = `$${row.trade_cash_usdc.toFixed(2)}`.padStart(11)
        const shares = row.shares.toFixed(2).padStart(11)
        const positions = parseInt(row.positions).toString().padStart(9)
        console.log(`${condId} | ${cash} | ${shares} | ${positions}`)
      })

      const totalUnresolvedCash = unresolvedMarkets.reduce((sum, r) => sum + r.trade_cash_usdc, 0)
      console.log()
      console.log(`Total trade cash in unresolved: $${totalUnresolvedCash.toFixed(2)}`)
      console.log()
      console.log('⚠️  Note: This is COST BASIS only (unrealized PnL)')
      console.log('   Polymarket UI likely includes current market value for open positions')
    } else {
      console.log('✅ No unresolved markets found')
    }

    // Query 4: Egg market audit
    console.log('\n' + '='.repeat(80))
    console.log('\n🥚 Query 4: Egg Market Audit\n')

    const eggMarketResult = await clickhouse.query({
      query: `
        WITH egg AS (
          SELECT lower(condition_id) AS condition_id, question
          FROM pm_market_metadata
          WHERE lower(question) LIKE '%egg%'
            AND lower(question) LIKE '%4.50%'
            AND lower(question) LIKE '%may%'
          LIMIT 1
        )
        SELECT
          m.question,
          p.condition_id,
          sum(p.realized_pnl) AS realized_pnl,
          sum(p.trade_cash) AS trade_cash,
          sum(p.resolution_cash) AS resolution_cash,
          max(p.is_resolved) AS resolved_flag,
          any(p.resolution_time) AS resolution_time
        FROM vw_pm_realized_pnl_v2 p
        JOIN egg m ON p.condition_id = m.condition_id
        WHERE p.wallet_address = '${WALLET}'
        GROUP BY p.condition_id, m.question
      `,
      format: 'JSONEachRow'
    })
    const eggMarket = await eggMarketResult.json() as Array<{
      question: string
      condition_id: string
      realized_pnl: number | null
      trade_cash: number
      resolution_cash: number
      resolved_flag: number
      resolution_time: string | null
    }>

    if (eggMarket.length > 0) {
      const egg = eggMarket[0]
      console.log('Egg Market Found:\n')
      console.log(`Question:        ${egg.question}`)
      console.log(`Condition ID:    ${egg.condition_id}`)
      console.log(`Resolved:        ${egg.resolved_flag === 1 ? 'YES' : 'NO'}`)
      console.log(`Resolution Time: ${egg.resolution_time || 'N/A'}`)
      console.log(`Trade Cash:      $${egg.trade_cash.toFixed(2)}`)
      console.log(`Resolution Cash: $${egg.resolution_cash.toFixed(2)}`)
      console.log(`Realized PnL:    ${egg.realized_pnl !== null ? '$' + egg.realized_pnl.toFixed(2) : 'NULL'}`)
      console.log()

      if (egg.realized_pnl !== null && Math.abs(egg.realized_pnl - 41289.47) < 100) {
        console.log('✅ PnL matches expected ~$41,289.47 from screenshot!')
      } else if (egg.realized_pnl !== null) {
        console.log(`⚠️  PnL ($${egg.realized_pnl.toFixed(2)}) differs from expected $41,289.47`)
      } else {
        console.log('⚠️  Market is unresolved - no realized PnL yet')
      }
    } else {
      console.log('❌ Egg market not found in pm_market_metadata')
      console.log('   Trying broader search...\n')

      // Fallback: search for any egg-related markets
      const eggBroadResult = await clickhouse.query({
        query: `
          SELECT DISTINCT lower(question) AS question
          FROM pm_market_metadata
          WHERE lower(question) LIKE '%egg%'
          LIMIT 10
        `,
        format: 'JSONEachRow'
      })
      const eggBroad = await eggBroadResult.json() as Array<{ question: string }>

      if (eggBroad.length > 0) {
        console.log('Egg-related markets in metadata:')
        eggBroad.forEach(m => console.log(`  - ${m.question}`))
      } else {
        console.log('No egg-related markets found in metadata at all')
      }
    }

    // Query 5: Quantify unresolved gap
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 5: Quantify Unresolved Gap\n')

    const unresolvedGapResult = await clickhouse.query({
      query: `
        SELECT
          countDistinct(condition_id) AS unresolved_markets,
          sum(trade_cash) AS unresolved_trade_cash
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 0
      `,
      format: 'JSONEachRow'
    })
    const unresolvedGap = await unresolvedGapResult.json() as Array<{
      unresolved_markets: string
      unresolved_trade_cash: number
    }>

    const unresolvedMarketCount = parseInt(unresolvedGap[0].unresolved_markets)
    const unresolvedTradeCash = unresolvedGap[0].unresolved_trade_cash || 0

    console.log(`Unresolved markets:     ${unresolvedMarketCount}`)
    console.log(`Unresolved trade cash:  $${unresolvedTradeCash.toFixed(2)}`)
    console.log()
    console.log('💡 Interpretation:')
    console.log(`   - Trade cash = money spent/received on trades (cost basis)`)
    console.log(`   - UI likely shows current market value for these positions`)
    console.log(`   - Gap = Current value - Cost basis (unrealized PnL)`)

    // Query 6: Resolved PnL summary (with non-null filter)
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 6: Resolved PnL Summary\n')

    const resolvedSummaryResult = await clickhouse.query({
      query: `
        SELECT
          countDistinct(condition_id) AS resolved_markets_all,
          sum(realized_pnl) AS total_realized_pnl_all
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const resolvedSummary = await resolvedSummaryResult.json() as Array<{
      resolved_markets_all: string
      total_realized_pnl_all: number
    }>

    // Also query with non-null filter (our original approach)
    const resolvedNonNullResult = await clickhouse.query({
      query: `
        SELECT
          countDistinct(condition_id) AS resolved_markets_nonnull,
          sum(realized_pnl) AS total_realized_pnl_nonnull
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
          AND realized_pnl IS NOT NULL
      `,
      format: 'JSONEachRow'
    })
    const resolvedNonNull = await resolvedNonNullResult.json() as Array<{
      resolved_markets_nonnull: string
      total_realized_pnl_nonnull: number
    }>

    const resolvedMarketCountAll = parseInt(resolvedSummary[0].resolved_markets_all)
    const totalResolvedPnLAll = resolvedSummary[0].total_realized_pnl_all

    const resolvedMarketCountNonNull = parseInt(resolvedNonNull[0].resolved_markets_nonnull)
    const totalResolvedPnLNonNull = resolvedNonNull[0].total_realized_pnl_nonnull

    console.log(`Resolved markets (all):               ${resolvedMarketCountAll}`)
    console.log(`Total realized PnL (all):             $${totalResolvedPnLAll.toFixed(2)}`)
    console.log()
    console.log(`Resolved markets (non-null PnL only): ${resolvedMarketCountNonNull}`)
    console.log(`Total realized PnL (non-null only):   $${totalResolvedPnLNonNull.toFixed(2)}`)
    console.log()
    console.log(`Difference: ${resolvedMarketCountAll - resolvedMarketCountNonNull} markets with NULL realized_pnl`)
    console.log(`           (likely zero-share positions or rounding artifacts)`)

    // Final summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 FINAL SUMMARY\n')
    console.log('Key Findings:')
    console.log()
    console.log(`Total markets traded:                 ${parseInt(totalTraded[0].total_traded)}`)
    console.log(`  - Resolved (all):                   ${resolvedMarketCountAll}`)
    console.log(`  - Resolved (non-null PnL):          ${resolvedMarketCountNonNull}`)
    console.log(`  - Unresolved (open):                ${unresolvedMarketCount}`)
    console.log()
    console.log(`Total PnL (non-null only):            $${totalResolvedPnLNonNull.toFixed(2)}`)
    console.log(`Total PnL (all resolved):             $${totalResolvedPnLAll.toFixed(2)}`)
    console.log()
    console.log('Gap Analysis:')
    console.log(`  Polymarket UI shows:                ~$96,000 (92 predictions)`)
    console.log(`  Our V2 resolved PnL (non-null):     $${totalResolvedPnLNonNull.toFixed(2)} (${resolvedMarketCountNonNull} markets)`)
    console.log(`  Remaining gap:                      $${(96000 - totalResolvedPnLNonNull).toFixed(2)}`)
    console.log()
    console.log('Likely Explanation:')
    console.log(`  📊 Market count discrepancy: UI shows 92, we have ${resolvedMarketCountNonNull}`)
    const marketDiff = 92 - resolvedMarketCountNonNull
    if (marketDiff > 0) {
      console.log(`     - ${marketDiff} markets in UI but not in our data`)
    } else if (marketDiff < 0) {
      console.log(`     - ${Math.abs(marketDiff)} markets in our data but not in UI`)
    }
    console.log()
    console.log(`  💰 PnL gap: $${(96000 - totalResolvedPnLNonNull).toFixed(2)}`)
    console.log(`     - Could be different data sources`)
    console.log(`     - Could be different calculation methodology`)
    console.log(`     - Could be timing differences (when data was captured)`)
    if (unresolvedMarketCount > 0) {
      console.log(`     - ${unresolvedMarketCount} unresolved positions (unrealized PnL)`)
    }
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

internalReconciliation()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
