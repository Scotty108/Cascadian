import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function verifyClickHouseData() {
  console.log('🔍 Verifying ClickHouse data...\n')

  try {
    // Count total trades
    console.log('📊 Total trades:')
    const countResult = await clickhouse.query({
      query: 'SELECT count() as total FROM trades_raw',
      format: 'JSONEachRow',
    })
    const countData = await countResult.json() as Array<{ total: string }>
    const totalTrades = parseInt(countData[0].total)
    console.log(`   ${totalTrades} trades\n`)

    if (totalTrades === 0) {
      console.log('⚠️  No trades found in ClickHouse')
      console.log('   Run sync-wallet-trades.ts first')
      return
    }

    // Count by wallet
    console.log('📊 Trades by wallet:')
    const walletResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          count() as trade_count,
          sum(usd_value) as total_volume
        FROM trades_raw
        GROUP BY wallet_address
        ORDER BY trade_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const walletData = await walletResult.json<{
      wallet_address: string
      trade_count: string
      total_volume: string
    }>()

    walletData.forEach((row) => {
      console.log(`   ${row.wallet_address}`)
      console.log(`      Trades: ${row.trade_count}`)
      console.log(`      Volume: $${parseFloat(row.total_volume).toFixed(2)}`)
    })

    // Show sample trades
    console.log('\n\n📝 Sample trades:')
    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          trade_id,
          wallet_address,
          market_id,
          timestamp,
          side,
          entry_price,
          shares,
          usd_value
        FROM trades_raw
        ORDER BY timestamp DESC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    })
    const sampleData = await sampleResult.json<{
      trade_id: string
      wallet_address: string
      market_id: string
      timestamp: number
      side: string
      entry_price: number
      shares: number
      usd_value: number
    }>()

    sampleData.forEach((trade, i) => {
      // ClickHouse returns DateTime as seconds since epoch
      const timestampSeconds = typeof trade.timestamp === 'number' ? trade.timestamp : parseInt(String(trade.timestamp))
      const date = new Date(timestampSeconds * 1000)
      const dateStr = isNaN(date.getTime()) ? 'Invalid date' : date.toISOString()

      console.log(`\n${i + 1}. ${trade.side} trade on ${dateStr}`)
      console.log(`   Wallet: ${trade.wallet_address.slice(0, 10)}...`)
      console.log(`   Market: ${trade.market_id}`)
      console.log(`   Price: $${Number(trade.entry_price).toFixed(4)}`)
      console.log(`   Shares: ${Number(trade.shares).toFixed(2)}`)
      console.log(`   Value: $${Number(trade.usd_value).toFixed(2)}`)
    })

    // Check materialized view
    console.log('\n\n📊 Checking materialized view (wallet_metrics_daily):')
    const metricsResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          date,
          total_trades,
          wins,
          losses,
          total_pnl,
          total_volume
        FROM wallet_metrics_daily
        ORDER BY date DESC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    })
    const metricsData = await metricsResult.json<{
      wallet_address: string
      date: string
      total_trades: string
      wins: string
      losses: string
      total_pnl: string
      total_volume: string
    }>()

    if (metricsData.length === 0) {
      console.log('   ⚠️  No metrics found (materialized view might be empty)')
    } else {
      metricsData.forEach((row) => {
        console.log(`\n   ${row.wallet_address.slice(0, 10)}... on ${row.date}`)
        console.log(`      Trades: ${row.total_trades}`)
        console.log(`      Volume: $${parseFloat(row.total_volume).toFixed(2)}`)
      })
    }

    console.log('\n\n✅ Data verification complete!')
    console.log(`   ${totalTrades} trades successfully stored in ClickHouse`)
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

verifyClickHouseData()
