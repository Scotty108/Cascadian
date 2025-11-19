#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const WALLET = '0x1699e13609a154eabe8234ff078f1000ea5980e2'

async function investigate() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('INVESTIGATING WALLET: ' + WALLET)
    console.log('=' .repeat(80))
    console.log('')
    console.log('Polymarket UI shows:')
    console.log('  P&L: -$14,009.48')
    console.log('  Closed trades: ~70')
    console.log('  Volume: $1.66M')
    console.log('')
    console.log('Our calculation shows:')
    console.log('  P&L: +$99,914.99')
    console.log('  Markets: 30')
    console.log('')
    console.log('=' .repeat(80))
    console.log('')

    // Check our realized P&L table
    console.log('1. Our realized_pnl_by_market_final:')
    console.log('-'.repeat(80))

    const ourPnl = await client.query({
      query: `
        SELECT
          count() as market_count,
          sum(realized_pnl_usd) as total_pnl,
          sum(if(realized_pnl_usd > 0, realized_pnl_usd, 0)) as total_gains,
          sum(if(realized_pnl_usd < 0, realized_pnl_usd, 0)) as total_losses
        FROM realized_pnl_by_market_final
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const ourData = await ourPnl.json<any[]>()

    console.log(`  Markets: ${ourData[0].market_count}`)
    console.log(`  Total P&L: $${parseFloat(ourData[0].total_pnl).toLocaleString()}`)
    console.log(`  Gains: $${parseFloat(ourData[0].total_gains).toLocaleString()}`)
    console.log(`  Losses: $${parseFloat(ourData[0].total_losses).toLocaleString()}`)
    console.log('')

    // Check how many trades this wallet has
    console.log('2. Trade activity (from trade_cashflows_v3):')
    console.log('-'.repeat(80))

    const trades = await client.query({
      query: `
        SELECT
          count(DISTINCT condition_id_norm) as unique_markets,
          count() as total_flows,
          sum(abs(cashflow_usdc)) as total_volume
        FROM trade_cashflows_v3
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const tradeData = await trades.json<any[]>()

    console.log(`  Unique markets traded: ${tradeData[0].unique_markets}`)
    console.log(`  Total cashflows: ${tradeData[0].total_flows}`)
    console.log(`  Total volume: $${parseFloat(tradeData[0].total_volume).toLocaleString()}`)
    console.log('')

    // Check how many are resolved vs unresolved
    console.log('3. Resolved vs unresolved markets:')
    console.log('-'.repeat(80))

    const resolution = await client.query({
      query: `
        SELECT
          countIf(w.win_idx IS NOT NULL) as resolved_markets,
          countIf(w.win_idx IS NULL) as unresolved_markets
        FROM (
          SELECT DISTINCT condition_id_norm
          FROM trade_cashflows_v3
          WHERE wallet = '${WALLET}'
        ) AS t
        LEFT JOIN winning_index AS w ON w.condition_id_norm = t.condition_id_norm
      `,
      format: 'JSONEachRow'
    })
    const resData = await resolution.json<any[]>()

    console.log(`  Resolved: ${resData[0].resolved_markets}`)
    console.log(`  Unresolved: ${resData[0].unresolved_markets}`)
    console.log(`  Total: ${parseInt(resData[0].resolved_markets) + parseInt(resData[0].unresolved_markets)}`)
    console.log('')

    // Sample top 10 markets by P&L
    console.log('4. Top 10 markets by P&L (our calculation):')
    console.log('-'.repeat(80))

    const topMarkets = await client.query({
      query: `
        SELECT
          condition_id_norm,
          realized_pnl_usd
        FROM realized_pnl_by_market_final
        WHERE wallet = '${WALLET}'
        ORDER BY realized_pnl_usd DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const markets = await topMarkets.json<any[]>()

    markets.forEach((m, idx) => {
      console.log(`  ${idx + 1}. ${m.condition_id_norm.substring(0, 16)}... : $${parseFloat(m.realized_pnl_usd).toLocaleString()}`)
    })
    console.log('')

    // Check the formula we're using
    console.log('5. Sample cashflows + positions for one market:')
    console.log('-'.repeat(80))

    if (markets.length > 0) {
      const sampleMarket = markets[0].condition_id_norm

      const cashflows = await client.query({
        query: `
          SELECT sum(cashflow_usdc) as total_cashflow
          FROM trade_cashflows_v3
          WHERE wallet = '${WALLET}' AND condition_id_norm = '${sampleMarket}'
        `,
        format: 'JSONEachRow'
      })
      const cfData = await cashflows.json<any[]>()

      const position = await client.query({
        query: `
          SELECT net_shares
          FROM outcome_positions_v2
          WHERE wallet = '${WALLET}' AND condition_id_norm = '${sampleMarket}'
        `,
        format: 'JSONEachRow'
      })
      const posData = await position.json<any[]>()

      const winIdx = await client.query({
        query: `
          SELECT win_idx
          FROM winning_index
          WHERE condition_id_norm = '${sampleMarket}'
        `,
        format: 'JSONEachRow'
      })
      const winData = await winIdx.json<any[]>()

      console.log(`  Market: ${sampleMarket.substring(0, 16)}...`)
      console.log(`  Cashflow (cost basis): $${parseFloat(cfData[0]?.total_cashflow || 0).toLocaleString()}`)
      console.log(`  Net shares: ${posData[0]?.net_shares || 0}`)
      console.log(`  Winning index: ${winData[0]?.win_idx ?? 'NULL'}`)
      console.log(`  Our P&L: $${parseFloat(markets[0].realized_pnl_usd).toLocaleString()}`)
      console.log('')
    }

    console.log('=' .repeat(80))
    console.log('DIAGNOSIS:')
    console.log('=' .repeat(80))
    console.log('')
    console.log('Key discrepancies:')
    console.log(`  • We calculate: +$${parseFloat(ourData[0].total_pnl).toLocaleString()}`)
    console.log(`  • Polymarket shows: -$14,009.48`)
    console.log(`  • Difference: $${(parseFloat(ourData[0].total_pnl) + 14009.48).toLocaleString()}`)
    console.log('')
    console.log(`  • We count: ${ourData[0].market_count} markets (only resolved)`)
    console.log(`  • Polymarket shows: ~70 closed trades`)
    console.log(`  • Missing: ${70 - parseInt(ourData[0].market_count)} trades`)
    console.log('')
    console.log('Possible issues:')
    console.log('  1. Formula sign error (gains/losses flipped)')
    console.log('  2. Only counting resolved markets (missing unresolved closed positions)')
    console.log('  3. Fee handling difference')
    console.log('  4. Unrealized P&L contamination')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    throw error
  } finally {
    await client.close()
  }
}

investigate()
