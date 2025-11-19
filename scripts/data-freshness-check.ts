import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function check() {
  console.log('═'.repeat(100))
  console.log('DATA FRESHNESS CHECK')
  console.log('═'.repeat(100))

  try {
    // Check latest timestamps
    console.log('\n[CHECK 1] Most recent trades in our database')
    const latestResult = await clickhouse.query({
      query: `
        SELECT
          MAX(timestamp) as latest_trade,
          COUNT(*) as total_trades,
          COUNT(DISTINCT wallet_address) as unique_wallets
        FROM trades_raw
      `
    })

    const latestText = await latestResult.text()
    let latestData: any = { data: [] }
    try {
      latestData = JSON.parse(latestText)
    } catch {
      console.log('Response:', latestText)
      return
    }

    if (latestData.data && latestData.data[0]) {
      const row = latestData.data[0]
      console.log(`✅ Latest trade timestamp: ${row.latest_trade}`)
      console.log(`✅ Total trades: ${row.total_trades}`)
      console.log(`✅ Unique wallets: ${row.unique_wallets}`)
    }

    // Check recent trades
    console.log('\n[CHECK 2] Trades from last 30 days')
    const recentResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as last_30_days,
          COUNT(DISTINCT wallet_address) as wallets_last_30
        FROM trades_raw
        WHERE timestamp >= now() - INTERVAL 30 DAY
      `
    })

    const recentText = await recentResult.text()
    let recentData: any = { data: [] }
    try {
      recentData = JSON.parse(recentText)
    } catch {
      console.log('Failed to parse')
      return
    }

    if (recentData.data && recentData.data[0]) {
      const row = recentData.data[0]
      console.log(`✅ Trades in last 30 days: ${row.last_30_days}`)
      console.log(`✅ Unique wallets (last 30 days): ${row.wallets_last_30}`)
    }

    // Check November 2025 trades
    console.log('\n[CHECK 3] Trades from November 2025')
    const novResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as nov_trades,
          COUNT(DISTINCT wallet_address) as nov_wallets,
          MIN(timestamp) as first_nov,
          MAX(timestamp) as last_nov
        FROM trades_raw
        WHERE timestamp >= '2025-11-01'
      `
    })

    const novText = await novResult.text()
    let novData: any = { data: [] }
    try {
      novData = JSON.parse(novText)
    } catch {
      return
    }

    if (novData.data && novData.data[0]) {
      const row = novData.data[0]
      console.log(`✅ Trades in November 2025: ${row.nov_trades}`)
      console.log(`✅ Unique wallets (Nov 2025): ${row.nov_wallets}`)
      console.log(`✅ Date range: ${row.first_nov} to ${row.last_nov}`)
    }

    // Check condition_id coverage
    console.log('\n[CHECK 4] Condition ID coverage by date')
    const coverageResult = await clickhouse.query({
      query: `
        SELECT
          toDate(timestamp) as date,
          COUNT(*) as trades,
          COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_condition_id,
          ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) * 100.0 / COUNT(*), 2) as pct_coverage
        FROM trades_raw
        WHERE timestamp >= now() - INTERVAL 10 DAY
        GROUP BY date
        ORDER BY date DESC
        LIMIT 10
      `
    })

    const coverageText = await coverageResult.text()
    let coverageData: any = { data: [] }
    try {
      coverageData = JSON.parse(coverageText)
    } catch {
      return
    }

    console.log('\n[Last 10 days of coverage]')
    if (coverageData.data && coverageData.data.length > 0) {
      console.log('Date\t\tTrades\tWith ID\tCoverage%')
      console.log('─'.repeat(50))
      for (const row of coverageData.data) {
        console.log(`${row.date}\t${row.trades}\t${row.with_condition_id}\t${row.pct_coverage}%`)
      }
    }

    console.log('\n[CONCLUSION]')
    console.log('─'.repeat(100))
    console.log('Key Questions:')
    console.log('1. Is our data current (through November 2025)?')
    console.log('2. Are we missing wallets from recent dates?')
    console.log('3. Why does the test wallet (Nov 2025) show 0 trades?')
    console.log('4. Is the data import pipeline still running or stalled?')

  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

check()
