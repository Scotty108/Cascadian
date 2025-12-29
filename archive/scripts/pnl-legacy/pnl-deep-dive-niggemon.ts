#!/usr/bin/env tsx
/**
 * Deep Dive: Niggemon P&L Analysis
 *
 * Purpose: Detailed analysis of niggemon's actual P&L calculations
 * Time estimate: 2-3 minutes
 */

import { getClickHouseClient } from '../lib/clickhouse/client'

const NIGGEMON_WALLET = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'

async function runDeepDive() {
  const client = getClickHouseClient()

  console.log('=' .repeat(80))
  console.log('NIGGEMON P&L DEEP DIVE')
  console.log('=' .repeat(80))
  console.log()

  // 1. Get wallet summary from wallet_pnl_summary_v2
  console.log('📊 WALLET SUMMARY (wallet_pnl_summary_v2)')
  console.log('-' .repeat(80))

  const summaryQuery = `
    SELECT
      wallet,
      realized_pnl_usd,
      unrealized_pnl_usd,
      total_pnl_usd,
      total_volume_usd,
      num_markets,
      num_resolved_markets,
      win_rate,
      avg_pnl_per_market,
      last_updated
    FROM wallet_pnl_summary_v2
    WHERE wallet = '${NIGGEMON_WALLET}'
  `

  try {
    const result = await client.query({
      query: summaryQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    if (data.length > 0) {
      const summary = data[0]
      console.log(`Realized P&L:     $${Number(summary.realized_pnl_usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      console.log(`Unrealized P&L:   $${Number(summary.unrealized_pnl_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      console.log(`Total P&L:        $${Number(summary.total_pnl_usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      console.log(`Total Volume:     $${Number(summary.total_volume_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      console.log(`Markets Traded:   ${summary.num_markets}`)
      console.log(`Resolved Markets: ${summary.num_resolved_markets}`)
      console.log(`Win Rate:         ${(Number(summary.win_rate || 0) * 100).toFixed(2)}%`)
      console.log(`Avg P&L/Market:   $${Number(summary.avg_pnl_per_market || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      console.log(`Last Updated:     ${summary.last_updated}`)
    } else {
      console.log('No summary data found')
    }
  } catch (error: any) {
    console.log(`Error: ${error.message}`)
  }

  console.log()

  // 2. Get top 10 most profitable markets
  console.log('🏆 TOP 10 MOST PROFITABLE MARKETS')
  console.log('-' .repeat(80))

  const topMarketsQuery = `
    SELECT
      market_id,
      realized_pnl_usd,
      unrealized_pnl_usd,
      total_pnl_usd,
      total_shares,
      avg_entry_price,
      num_trades
    FROM realized_pnl_by_market_v2
    WHERE wallet = '${NIGGEMON_WALLET}'
    ORDER BY total_pnl_usd DESC
    LIMIT 10
  `

  try {
    const result = await client.query({
      query: topMarketsQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    data.forEach((market: any, i: number) => {
      console.log(`\n${i + 1}. Market: ${market.market_id.substring(0, 20)}...`)
      console.log(`   Total P&L:      $${Number(market.total_pnl_usd).toFixed(2)}`)
      console.log(`   Realized:       $${Number(market.realized_pnl_usd).toFixed(2)}`)
      console.log(`   Unrealized:     $${Number(market.unrealized_pnl_usd || 0).toFixed(2)}`)
      console.log(`   Shares:         ${Number(market.total_shares || 0).toFixed(2)}`)
      console.log(`   Avg Entry:      $${Number(market.avg_entry_price || 0).toFixed(4)}`)
      console.log(`   Trades:         ${market.num_trades}`)
    })
  } catch (error: any) {
    console.log(`Error: ${error.message}`)
  }

  console.log()

  // 3. Get worst 10 markets
  console.log('💥 TOP 10 WORST PERFORMING MARKETS')
  console.log('-' .repeat(80))

  const worstMarketsQuery = `
    SELECT
      market_id,
      realized_pnl_usd,
      unrealized_pnl_usd,
      total_pnl_usd,
      total_shares,
      avg_entry_price,
      num_trades
    FROM realized_pnl_by_market_v2
    WHERE wallet = '${NIGGEMON_WALLET}'
    ORDER BY total_pnl_usd ASC
    LIMIT 10
  `

  try {
    const result = await client.query({
      query: worstMarketsQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    data.forEach((market: any, i: number) => {
      console.log(`\n${i + 1}. Market: ${market.market_id.substring(0, 20)}...`)
      console.log(`   Total P&L:      $${Number(market.total_pnl_usd).toFixed(2)}`)
      console.log(`   Realized:       $${Number(market.realized_pnl_usd).toFixed(2)}`)
      console.log(`   Unrealized:     $${Number(market.unrealized_pnl_usd || 0).toFixed(2)}`)
      console.log(`   Shares:         ${Number(market.total_shares || 0).toFixed(2)}`)
      console.log(`   Avg Entry:      $${Number(market.avg_entry_price || 0).toFixed(4)}`)
      console.log(`   Trades:         ${market.num_trades}`)
    })
  } catch (error: any) {
    console.log(`Error: ${error.message}`)
  }

  console.log()

  // 4. Cashflow timeline (last 20 entries)
  console.log('📈 RECENT CASHFLOW HISTORY (Last 20)')
  console.log('-' .repeat(80))

  const cashflowQuery = `
    SELECT
      timestamp,
      market_id,
      cashflow_usdc,
      running_total
    FROM trade_cashflows_v3
    WHERE wallet = '${NIGGEMON_WALLET}'
    ORDER BY timestamp DESC
    LIMIT 20
  `

  try {
    const result = await client.query({
      query: cashflowQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    data.forEach((entry: any) => {
      const cashflow = Number(entry.cashflow_usdc)
      const sign = cashflow >= 0 ? '+' : ''
      console.log(`${entry.timestamp} | ${sign}$${cashflow.toFixed(2).padStart(10)} | Running: $${Number(entry.running_total || 0).toFixed(2).padStart(12)} | Market: ${entry.market_id.substring(0, 20)}...`)
    })
  } catch (error: any) {
    console.log(`Error: ${error.message}`)
  }

  console.log()

  // 5. Monthly P&L breakdown
  console.log('📅 MONTHLY P&L BREAKDOWN')
  console.log('-' .repeat(80))

  const monthlyQuery = `
    SELECT
      toStartOfMonth(timestamp) as month,
      SUM(cashflow_usdc) as monthly_pnl,
      COUNT(*) as num_cashflows,
      COUNT(DISTINCT market_id) as markets_traded
    FROM trade_cashflows_v3
    WHERE wallet = '${NIGGEMON_WALLET}'
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `

  try {
    const result = await client.query({
      query: monthlyQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    data.forEach((month: any) => {
      const pnl = Number(month.monthly_pnl)
      const sign = pnl >= 0 ? '+' : ''
      console.log(`${month.month.substring(0, 7)} | ${sign}$${pnl.toFixed(2).padStart(10)} | ${String(month.num_cashflows).padStart(4)} cashflows | ${String(month.markets_traded).padStart(3)} markets`)
    })
  } catch (error: any) {
    console.log(`Error: ${error.message}`)
  }

  console.log()

  // 6. Validation: Compare cashflows to summary
  console.log('✅ VALIDATION: Cashflow Total vs Summary')
  console.log('-' .repeat(80))

  const validationQuery = `
    SELECT
      (SELECT SUM(cashflow_usdc) FROM trade_cashflows_v3 WHERE wallet = '${NIGGEMON_WALLET}') as cashflow_total,
      (SELECT realized_pnl_usd FROM wallet_pnl_summary_v2 WHERE wallet = '${NIGGEMON_WALLET}') as summary_total
  `

  try {
    const result = await client.query({
      query: validationQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    if (data.length > 0) {
      const cashflowTotal = Number(data[0].cashflow_total)
      const summaryTotal = Number(data[0].summary_total)
      const diff = Math.abs(cashflowTotal - summaryTotal)
      const match = diff < 0.01

      console.log(`Cashflow Total:   $${cashflowTotal.toFixed(2)}`)
      console.log(`Summary Total:    $${summaryTotal.toFixed(2)}`)
      console.log(`Difference:       $${diff.toFixed(2)}`)
      console.log(`Match:            ${match ? '✓ YES' : '✗ NO'}`)

      if (match) {
        console.log('\n✓ VALIDATION PASSED: Cashflows match summary totals')
      } else {
        console.log('\n✗ VALIDATION FAILED: Discrepancy detected')
      }
    }
  } catch (error: any) {
    console.log(`Error: ${error.message}`)
  }

  console.log()
  console.log('=' .repeat(80))
  console.log('DEEP DIVE COMPLETE')
  console.log('=' .repeat(80))
}

runDeepDive().catch(console.error)
