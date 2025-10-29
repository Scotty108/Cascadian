import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function investigateWalletCount() {
  console.log('🔍 Investigating wallet count...\n')

  try {
    // 1. Total distinct wallets in trades_raw
    console.log('1️⃣ Total distinct wallets in trades_raw:')
    const walletCountResult = await clickhouse.query({
      query: 'SELECT uniqExact(wallet_address) AS total_wallets FROM trades_raw',
      format: 'JSONEachRow',
    })
    const walletCountData = await walletCountResult.json() as Array<{ total_wallets: string }>
    const totalWallets = parseInt(walletCountData[0].total_wallets)
    console.log(`   ${totalWallets} distinct wallets\n`)

    // 2. Time range of trades data
    console.log('2️⃣ Time range of trades data:')
    const timeRangeResult = await clickhouse.query({
      query: `
        SELECT
          min(timestamp) AS earliest_trade,
          max(timestamp) AS latest_trade,
          dateDiff('day', min(timestamp), max(timestamp)) AS days_covered
        FROM trades_raw
      `,
      format: 'JSONEachRow',
    })
    const timeRangeData = await timeRangeResult.json() as Array<{
      earliest_trade: string
      latest_trade: string
      days_covered: string
    }>
    console.log(`   Earliest trade: ${timeRangeData[0].earliest_trade}`)
    console.log(`   Latest trade: ${timeRangeData[0].latest_trade}`)
    console.log(`   Days covered: ${timeRangeData[0].days_covered} days\n`)

    // 3. Market coverage in trades_raw
    console.log('3️⃣ Market coverage:')
    const tradesMarketsResult = await clickhouse.query({
      query: `
        SELECT
          countDistinct(market_id) AS markets_in_trades,
          count() AS total_trades
        FROM trades_raw
      `,
      format: 'JSONEachRow',
    })
    const tradesMarketsData = await tradesMarketsResult.json() as Array<{
      markets_in_trades: string
      total_trades: string
    }>
    console.log(`   Markets with trades: ${tradesMarketsData[0].markets_in_trades}`)
    console.log(`   Total trades: ${tradesMarketsData[0].total_trades}\n`)

    // 4. Total markets in markets_dim
    console.log('4️⃣ Total markets in markets_dim:')
    const dimMarketsResult = await clickhouse.query({
      query: 'SELECT count() AS total_markets FROM markets_dim',
      format: 'JSONEachRow',
    })
    const dimMarketsData = await dimMarketsResult.json() as Array<{ total_markets: string }>
    console.log(`   Total markets: ${dimMarketsData[0].total_markets}\n`)

    // 5. Check if we're filtering by resolved markets
    console.log('5️⃣ Resolved vs unresolved markets:')
    const resolvedResult = await clickhouse.query({
      query: `
        SELECT
          uniqExact(wallet_address) AS wallets_all,
          countDistinct(market_id) AS markets_all
        FROM trades_raw
      `,
      format: 'JSONEachRow',
    })
    const resolvedData = await resolvedResult.json() as Array<{
      wallets_all: string
      markets_all: string
    }>
    console.log(`   All wallets (no filter): ${resolvedData[0].wallets_all}`)
    console.log(`   All markets (no filter): ${resolvedData[0].markets_all}\n`)

    // Check wallets in resolved markets only
    const resolvedFilterResult = await clickhouse.query({
      query: `
        SELECT
          uniqExact(wallet_address) AS wallets_resolved,
          countDistinct(market_id) AS markets_resolved
        FROM trades_raw
        WHERE is_resolved = 1
      `,
      format: 'JSONEachRow',
    })
    const resolvedFilterData = await resolvedFilterResult.json() as Array<{
      wallets_resolved: string
      markets_resolved: string
    }>
    console.log(`   Wallets in resolved markets only: ${resolvedFilterData[0].wallets_resolved}`)
    console.log(`   Markets resolved: ${resolvedFilterData[0].markets_resolved}\n`)

    // 6. Distribution of trades per wallet
    console.log('6️⃣ Wallet activity distribution:')
    const distributionResult = await clickhouse.query({
      query: `
        WITH wallet_trade_counts AS (
          SELECT
            wallet_address,
            count() as trade_count
          FROM trades_raw
          GROUP BY wallet_address
        )
        SELECT
          quantile(0.5)(trade_count) AS median_trades,
          avg(trade_count) AS avg_trades,
          max(trade_count) AS max_trades,
          min(trade_count) AS min_trades
        FROM wallet_trade_counts
      `,
      format: 'JSONEachRow',
    })
    const distributionData = await distributionResult.json() as Array<{
      median_trades: string
      avg_trades: string
      max_trades: string
      min_trades: string
    }>
    console.log(`   Median trades per wallet: ${parseFloat(distributionData[0].median_trades).toFixed(2)}`)
    console.log(`   Average trades per wallet: ${parseFloat(distributionData[0].avg_trades).toFixed(2)}`)
    console.log(`   Max trades (single wallet): ${distributionData[0].max_trades}`)
    console.log(`   Min trades (single wallet): ${distributionData[0].min_trades}\n`)

    // 7. Top 10 most active wallets
    console.log('7️⃣ Top 10 most active wallets:')
    const topWalletsResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          count() as trade_count,
          countDistinct(market_id) as markets_traded
        FROM trades_raw
        GROUP BY wallet_address
        ORDER BY trade_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const topWalletsData = await topWalletsResult.json() as Array<{
      wallet_address: string
      trade_count: string
      markets_traded: string
    }>
    topWalletsData.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.wallet_address.slice(0, 12)}...`)
      console.log(`      Trades: ${row.trade_count}, Markets: ${row.markets_traded}`)
    })

    console.log('\n✅ Investigation complete!')
    console.log(`\n📊 Summary:`)
    console.log(`   - You have ${totalWallets} distinct wallets in trades_raw`)
    console.log(`   - Covering ${tradesMarketsData[0].markets_in_trades} markets`)
    console.log(`   - With ${tradesMarketsData[0].total_trades} total trades`)
    console.log(`   - Over ${timeRangeData[0].days_covered} days`)
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

investigateWalletCount()
