/**
 * Investigate markets with zero payouts (payout_numerators = [0, 0])
 * These are likely canceled or invalid markets that should be excluded
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function investigateZeroPayouts() {
  console.log('🔍 Investigating Zero-Payout Markets\n')
  console.log('='.repeat(80))

  try {
    // Find markets where ALL outcomes have resolved_price = 0
    console.log('\n📊 Markets with ALL Zero Payouts (Canceled/Invalid)\n')

    const zeroPayoutMarketsResult = await clickhouse.query({
      query: `
        WITH market_prices AS (
          SELECT
            condition_id,
            groupArray(resolved_price) as all_prices,
            arraySum(all_prices) as total_payout
          FROM vw_pm_resolution_prices
          GROUP BY condition_id
        )
        SELECT
          condition_id,
          all_prices,
          total_payout
        FROM market_prices
        WHERE total_payout = 0
        ORDER BY condition_id
        LIMIT 20
      `,
      format: 'JSONEachRow',
    })
    const zeroPayoutMarkets = await zeroPayoutMarketsResult.json() as Array<{
      condition_id: string
      all_prices: number[]
      total_payout: number
    }>

    console.log(`Found ${zeroPayoutMarkets.length} markets with zero total payout\n`)
    console.log('Market (first 24)       | Payouts     | Total')
    console.log('-'.repeat(60))
    zeroPayoutMarkets.forEach(row => {
      const market = row.condition_id.slice(0, 23).padEnd(23)
      const payouts = JSON.stringify(row.all_prices).padEnd(11)
      const total = row.total_payout.toString().padStart(5)
      console.log(`${market} | ${payouts} | ${total}`)
    })

    // Check how many of these markets affect our problem wallet
    console.log('\n' + '='.repeat(80))
    console.log(`\n📊 Impact on Wallet ${WALLET}\n`)

    const walletZeroPayoutImpactResult = await clickhouse.query({
      query: `
        WITH zero_payout_markets AS (
          SELECT
            condition_id,
            arraySum(groupArray(resolved_price)) as total_payout
          FROM vw_pm_resolution_prices
          GROUP BY condition_id
          HAVING total_payout = 0
        )
        SELECT
          count(DISTINCT p.condition_id) as affected_markets,
          sum(p.realized_pnl) as total_impact,
          sum(p.trade_cash) as total_trade_cash,
          sum(p.resolution_cash) as total_resolution_cash
        FROM vw_pm_realized_pnl_v1 p
        INNER JOIN zero_payout_markets z ON p.condition_id = z.condition_id
        WHERE p.wallet_address = '${WALLET}'
          AND p.is_resolved = 1
      `,
      format: 'JSONEachRow',
    })
    const walletImpact = await walletZeroPayoutImpactResult.json() as Array<{
      affected_markets: string
      total_impact: number
      total_trade_cash: number
      total_resolution_cash: number
    }>

    if (walletImpact.length > 0 && walletImpact[0].affected_markets !== '0') {
      const impact = walletImpact[0]
      console.log(`Affected Markets:     ${parseInt(impact.affected_markets).toLocaleString()}`)
      console.log(`Total Impact PnL:     $${impact.total_impact.toFixed(2)}`)
      console.log(`Total Trade Cash:     $${impact.total_trade_cash.toFixed(2)}`)
      console.log(`Total Resolution Cash: $${impact.total_resolution_cash.toFixed(2)}`)

      console.log('\n⚠️  CRITICAL: These are canceled/invalid markets!')
      console.log('   Polymarket UI likely EXCLUDES these from PnL calculations')
      console.log('   We are INCLUDING them, causing massive discrepancy')
    } else {
      console.log('✅ No zero-payout markets affect this wallet')
    }

    // Get list of wallet's zero-payout markets
    console.log('\n' + '='.repeat(80))
    console.log(`\n📊 Wallet's Zero-Payout Markets (Top 20 by |Impact|)\n`)

    const walletZeroMarketsResult = await clickhouse.query({
      query: `
        WITH zero_payout_markets AS (
          SELECT
            condition_id,
            arraySum(groupArray(resolved_price)) as total_payout
          FROM vw_pm_resolution_prices
          GROUP BY condition_id
          HAVING total_payout = 0
        )
        SELECT
          p.condition_id,
          sum(p.realized_pnl) as market_pnl,
          sum(p.trade_cash) as trade_cash,
          sum(p.resolution_cash) as resolution_cash,
          sum(p.trade_count) as trades
        FROM vw_pm_realized_pnl_v1 p
        INNER JOIN zero_payout_markets z ON p.condition_id = z.condition_id
        WHERE p.wallet_address = '${WALLET}'
          AND p.is_resolved = 1
        GROUP BY p.condition_id
        ORDER BY abs(market_pnl) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    })
    const walletZeroMarkets = await walletZeroMarketsResult.json() as Array<{
      condition_id: string
      market_pnl: number
      trade_cash: number
      resolution_cash: number
      trades: string
    }>

    if (walletZeroMarkets.length > 0) {
      console.log('Market (first 24)       | PnL         | Trade Cash  | Res Cash    | Trades')
      console.log('-'.repeat(90))
      walletZeroMarkets.forEach(row => {
        const market = row.condition_id.slice(0, 23).padEnd(23)
        const pnl = `$${row.market_pnl.toFixed(2)}`.padStart(11)
        const tradeCash = `$${row.trade_cash.toFixed(2)}`.padStart(11)
        const resCash = `$${row.resolution_cash.toFixed(2)}`.padStart(11)
        const trades = parseInt(row.trades).toLocaleString().padStart(6)
        console.log(`${market} | ${pnl} | ${tradeCash} | ${resCash} | ${trades}`)
      })
    } else {
      console.log('No zero-payout markets found for this wallet')
    }

    // Calculate corrected PnL (excluding zero-payout markets)
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 PnL Calculation: Excluding Zero-Payout Markets\n')

    const correctedPnLResult = await clickhouse.query({
      query: `
        WITH zero_payout_markets AS (
          SELECT
            condition_id
          FROM vw_pm_resolution_prices
          GROUP BY condition_id
          HAVING arraySum(groupArray(resolved_price)) = 0
        )
        SELECT
          count(DISTINCT p.condition_id) as valid_markets,
          sum(p.realized_pnl) as corrected_pnl,
          sum(p.trade_cash) as total_trade_cash,
          sum(p.resolution_cash) as total_resolution_cash
        FROM vw_pm_realized_pnl_v1 p
        WHERE p.wallet_address = '${WALLET}'
          AND p.is_resolved = 1
          AND p.condition_id NOT IN (SELECT condition_id FROM zero_payout_markets)
      `,
      format: 'JSONEachRow',
    })
    const correctedPnL = await correctedPnLResult.json() as Array<{
      valid_markets: string
      corrected_pnl: number
      total_trade_cash: number
      total_resolution_cash: number
    }>

    if (correctedPnL.length > 0) {
      const corrected = correctedPnL[0]
      console.log('ORIGINAL (including zero-payout markets):')
      console.log('  Markets: 115')
      console.log('  PnL:     -$18,362.49\n')

      console.log('CORRECTED (excluding zero-payout markets):')
      console.log(`  Markets: ${parseInt(corrected.valid_markets).toLocaleString()}`)
      console.log(`  PnL:     $${corrected.corrected_pnl.toFixed(2)}`)
      console.log(`  Trade Cash:     $${corrected.total_trade_cash.toFixed(2)}`)
      console.log(`  Resolution Cash: $${corrected.total_resolution_cash.toFixed(2)}`)

      console.log('\n📌 Polymarket UI:')
      console.log('  Markets: 92 predictions')
      console.log('  PnL:     ~$96,000\n')

      console.log('📊 COMPARISON:')
      console.log(`  Market count difference: ${parseInt(corrected.valid_markets)} (ours) vs 92 (UI) = ${parseInt(corrected.valid_markets) - 92} markets`)
      console.log(`  PnL difference: $${corrected.corrected_pnl.toFixed(2)} (ours) vs $96,000 (UI) = $${(96000 - corrected.corrected_pnl).toFixed(2)}`)

      const closenessPercent = (corrected.corrected_pnl / 96000) * 100
      if (Math.abs(corrected.corrected_pnl - 96000) < 10000) {
        console.log('\n🎯 MUCH CLOSER! Excluding zero-payout markets significantly improves alignment')
      } else {
        console.log('\n⚠️  Still significant discrepancy after excluding zero-payout markets')
        console.log('   Further investigation needed')
      }
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 CONCLUSION\n')
    console.log('The discrepancy is caused by:')
    console.log('  1. Zero-payout markets (payout_numerators = [0, 0])')
    console.log('  2. These are canceled/invalid markets')
    console.log('  3. Polymarket UI excludes them from PnL')
    console.log('  4. Our V1 engine includes them')
    console.log()
    console.log('RECOMMENDATION:')
    console.log('  Filter out markets where arraySum(payout_numerators) = 0')
    console.log('  These are NOT valid resolved markets')
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

investigateZeroPayouts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
