/**
 * PnL Engine V1 - Wallet Discrepancy Diagnostic
 *
 * Investigates critical discrepancy for wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b:
 * - Polymarket UI: 92 predictions, ~$96,000 profit
 * - Our calculation: 115 markets, -$18,362.49 loss
 *
 * This script checks:
 * 1. CTF events (splits, merges, redeems) - V1 doesn't track these
 * 2. Resolved vs unresolved market breakdown
 * 3. Market-level PnL details
 * 4. Trade data completeness
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function diagnoseWallet() {
  console.log('🔍 PnL Engine V1 - Wallet Discrepancy Diagnostic\n')
  console.log('='.repeat(80))
  console.log(`\nWallet: ${WALLET}`)
  console.log('\nPolymarket UI:      92 predictions, ~$96,000 profit')
  console.log('Our Calculation:    115 markets, -$18,362.49 loss')
  console.log('Discrepancy:        $114,000+ difference\n')
  console.log('='.repeat(80))

  try {
    // Investigation 1: Check CTF events (splits, merges, redeems)
    console.log('\n📊 Investigation 1: CTF Events (Not tracked in V1)\n')
    console.log('Checking pm_ctf_events for splits/merges/redeems...\n')

    const ctfEventsResult = await clickhouse.query({
      query: `
        SELECT
          event_type,
          count() as event_count,
          sum(toFloat64OrZero(amount_or_payout)) as total_amount
        FROM pm_ctf_events
        WHERE lower(user_address) = '${WALLET}'
          AND is_deleted = 0
        GROUP BY event_type
        ORDER BY event_count DESC
      `,
      format: 'JSONEachRow',
    })
    const ctfEvents = await ctfEventsResult.json() as Array<{
      event_type: string
      event_count: string
      total_amount: number
    }>

    if (ctfEvents.length > 0) {
      console.log('CTF Events Found:')
      console.log('Event Type          | Count      | Total Amount')
      console.log('-'.repeat(55))
      ctfEvents.forEach(row => {
        const eventType = row.event_type.padEnd(18)
        const count = parseInt(row.event_count).toLocaleString().padStart(10)
        const amount = parseFloat(row.total_amount).toFixed(2).padStart(12)
        console.log(`${eventType} | ${count} | ${amount}`)
      })
      console.log('\n⚠️  V1 SCOPE LIMITATION: CTF events (splits/merges/redeems) NOT tracked')
      console.log('   These can significantly affect PnL calculations')
    } else {
      console.log('✅ No CTF events found for this wallet')
      console.log('   CTF events are NOT the cause of the discrepancy')
    }

    // Investigation 2: Resolved vs Unresolved breakdown
    console.log('\n' + '='.repeat(80))
    console.log('📊 Investigation 2: Resolved vs Unresolved Market Breakdown\n')

    const resolutionBreakdownResult = await clickhouse.query({
      query: `
        SELECT
          is_resolved,
          count(DISTINCT condition_id) as market_count,
          sum(realized_pnl) as total_pnl,
          sum(trade_cash) as total_trade_cash,
          sum(resolution_cash) as total_resolution_cash,
          count() as position_count
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${WALLET}'
        GROUP BY is_resolved
        ORDER BY is_resolved DESC
      `,
      format: 'JSONEachRow',
    })
    const resolutionBreakdown = await resolutionBreakdownResult.json() as Array<{
      is_resolved: number
      market_count: string
      total_pnl: number
      total_trade_cash: number
      total_resolution_cash: number
      position_count: string
    }>

    console.log('Status   | Markets | Positions | Trade Cash      | Resolution Cash | Total PnL')
    console.log('-'.repeat(90))
    resolutionBreakdown.forEach(row => {
      const status = (row.is_resolved === 1 ? 'RESOLVED' : 'OPEN').padEnd(8)
      const markets = parseInt(row.market_count).toLocaleString().padStart(7)
      const positions = parseInt(row.position_count).toLocaleString().padStart(9)
      const tradeCash = `$${row.total_trade_cash.toFixed(2)}`.padStart(15)
      const resCash = `$${row.total_resolution_cash.toFixed(2)}`.padStart(15)
      const pnl = `$${row.total_pnl.toFixed(2)}`.padStart(9)
      console.log(`${status} | ${markets} | ${positions} | ${tradeCash} | ${resCash} | ${pnl}`)
    })

    const resolvedData = resolutionBreakdown.find(r => r.is_resolved === 1)
    if (resolvedData) {
      console.log(`\n📌 Our resolved markets: ${parseInt(resolvedData.market_count)} markets`)
      console.log(`📌 UI shows: 92 predictions`)
      console.log(`📌 Difference: ${parseInt(resolvedData.market_count) - 92} markets`)

      if (parseInt(resolvedData.market_count) > 92) {
        console.log('\n⚠️  We are tracking MORE markets than UI shows')
        console.log('   Possible causes:')
        console.log('   - UI filters out certain market types')
        console.log('   - UI consolidates multi-outcome positions')
        console.log('   - Our data includes markets UI considers invalid')
      }
    }

    // Investigation 3: Market-level PnL details (resolved only)
    console.log('\n' + '='.repeat(80))
    console.log('📊 Investigation 3: Resolved Market Details (Top 20 by |PnL|)\n')

    const marketDetailsResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          sum(realized_pnl) as market_pnl,
          sum(trade_cash) as trade_cash,
          sum(resolution_cash) as resolution_cash,
          sum(final_shares) as final_shares,
          sum(trade_count) as trades,
          groupArray(outcome_index) as outcomes
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
        GROUP BY condition_id
        ORDER BY abs(market_pnl) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    })
    const marketDetails = await marketDetailsResult.json() as Array<{
      condition_id: string
      market_pnl: number
      trade_cash: number
      resolution_cash: number
      final_shares: number
      trades: string
      outcomes: number[]
    }>

    console.log('Market (first 16)       | PnL         | Trade Cash  | Res Cash    | Shares   | Trades | Outcomes')
    console.log('-'.repeat(105))
    marketDetails.forEach(row => {
      const market = row.condition_id.slice(0, 23).padEnd(23)
      const pnl = `$${row.market_pnl.toFixed(2)}`.padStart(11)
      const tradeCash = `$${row.trade_cash.toFixed(2)}`.padStart(11)
      const resCash = `$${row.resolution_cash.toFixed(2)}`.padStart(11)
      const shares = row.final_shares.toFixed(2).padStart(8)
      const trades = parseInt(row.trades).toLocaleString().padStart(6)
      const outcomes = row.outcomes.join(',').padStart(8)
      console.log(`${market} | ${pnl} | ${tradeCash} | ${resCash} | ${shares} | ${trades} | ${outcomes}`)
    })

    // Investigation 4: Check for negative trade_cash with zero resolution_cash
    console.log('\n' + '='.repeat(80))
    console.log('📊 Investigation 4: Potential Problem Patterns\n')
    console.log('Looking for markets with negative trade_cash and zero resolution_cash...\n')

    const problemPatternsResult = await clickhouse.query({
      query: `
        SELECT
          'Negative trade_cash + zero resolution_cash' as pattern,
          count(DISTINCT condition_id) as market_count,
          sum(realized_pnl) as total_impact
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
          AND trade_cash < 0
          AND resolution_cash = 0
        UNION ALL
        SELECT
          'Positive trade_cash + zero resolution_cash' as pattern,
          count(DISTINCT condition_id) as market_count,
          sum(realized_pnl) as total_impact
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
          AND trade_cash > 0
          AND resolution_cash = 0
        UNION ALL
        SELECT
          'Large negative final_shares (>100)' as pattern,
          count(DISTINCT condition_id) as market_count,
          sum(realized_pnl) as total_impact
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
          AND final_shares < -100
      `,
      format: 'JSONEachRow',
    })
    const problemPatterns = await problemPatternsResult.json() as Array<{
      pattern: string
      market_count: string
      total_impact: number
    }>

    console.log('Pattern                                        | Markets | Impact PnL')
    console.log('-'.repeat(75))
    problemPatterns.forEach(row => {
      const pattern = row.pattern.padEnd(46)
      const markets = parseInt(row.market_count).toLocaleString().padStart(7)
      const impact = `$${row.total_impact.toFixed(2)}`.padStart(10)
      console.log(`${pattern} | ${markets} | ${impact}`)
    })

    // Investigation 5: Spot-check one specific market
    console.log('\n' + '='.repeat(80))
    console.log('📊 Investigation 5: Spot-Check Sample Market\n')
    console.log('Examining largest magnitude PnL market in detail...\n')

    if (marketDetails.length > 0) {
      const sampleMarket = marketDetails[0]
      console.log(`Market: ${sampleMarket.condition_id}`)
      console.log(`Market PnL: $${sampleMarket.market_pnl.toFixed(2)}`)
      console.log(`Outcomes: ${sampleMarket.outcomes.join(', ')}\n`)

      // Get detailed position breakdown
      const positionDetailsResult = await clickhouse.query({
        query: `
          SELECT
            outcome_index,
            trade_cash,
            final_shares,
            resolution_cash,
            realized_pnl,
            trade_count,
            resolved_price,
            is_winner
          FROM vw_pm_realized_pnl_v1
          WHERE wallet_address = '${WALLET}'
            AND condition_id = '${sampleMarket.condition_id}'
            AND is_resolved = 1
          ORDER BY outcome_index
        `,
        format: 'JSONEachRow',
      })
      const positionDetails = await positionDetailsResult.json() as Array<{
        outcome_index: number
        trade_cash: number
        final_shares: number
        resolution_cash: number
        realized_pnl: number
        trade_count: string
        resolved_price: number
        is_winner: number
      }>

      console.log('Outcome | Trade Cash  | Final Shares | Res Price | Res Cash    | PnL         | Trades | Winner')
      console.log('-'.repeat(105))
      positionDetails.forEach(row => {
        const outcome = row.outcome_index.toString().padStart(7)
        const tradeCash = `$${row.trade_cash.toFixed(2)}`.padStart(11)
        const shares = row.final_shares.toFixed(2).padStart(12)
        const resPrice = row.resolved_price.toFixed(2).padStart(9)
        const resCash = `$${row.resolution_cash.toFixed(2)}`.padStart(11)
        const pnl = `$${row.realized_pnl.toFixed(2)}`.padStart(11)
        const trades = parseInt(row.trade_count).toLocaleString().padStart(6)
        const winner = (row.is_winner === 1 ? 'YES' : 'NO').padEnd(6)
        console.log(`${outcome} | ${tradeCash} | ${shares} | ${resPrice} | ${resCash} | ${pnl} | ${trades} | ${winner}`)
      })

      console.log('\n📋 Manual UI Verification:')
      console.log(`   1. Visit: https://polymarket.com/profile/${WALLET}`)
      console.log(`   2. Search for condition_id: ${sampleMarket.condition_id}`)
      console.log(`   3. Compare PnL: $${sampleMarket.market_pnl.toFixed(2)} (our calculation)`)
      console.log(`   4. Check if market appears in UI at all`)
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 DIAGNOSTIC SUMMARY\n')
    console.log('Key Findings:')
    console.log(`  - Our data: ${resolvedData ? parseInt(resolvedData.market_count) : 'N/A'} resolved markets, -$18,362.49 PnL`)
    console.log(`  - UI shows: 92 predictions, ~$96,000 profit`)
    console.log(`  - Discrepancy: $114,000+`)
    console.log()
    console.log('Possible Causes:')
    console.log('  1. CTF events (splits/merges/redeems) not tracked in V1')
    console.log('  2. Different market filtering between our data and UI')
    console.log('  3. Data source differences (we use CLOB fills, UI may use different source)')
    console.log('  4. Resolution status mismatch (markets we think are resolved may not be)')
    console.log('  5. Multi-outcome market aggregation differences')
    console.log()
    console.log('Next Steps:')
    console.log('  1. Check if pm_ctf_events table exists and has data for this wallet')
    console.log('  2. Manually verify 2-3 largest PnL markets in UI')
    console.log('  3. Compare UI market list vs our 115 markets')
    console.log('  4. Investigate if trades are being double-counted or missed')
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// Run the diagnostic
diagnoseWallet()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
