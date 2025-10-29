#!/usr/bin/env tsx
/**
 * Check True Database State
 * Query ClickHouse directly to verify wallet and trade counts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function checkDatabaseState() {
  try {
    console.log('=== EXACT DATABASE STATE ===\n')

    // 1. Total distinct wallets in trades_raw
    const walletsResult = await clickhouse.query({
      query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw',
      format: 'JSONEachRow',
    })
    const wallets = (await walletsResult.json()) as Array<{ count: string }>
    console.log('1. Total distinct wallets in trades_raw:', wallets[0].count)

    // 2. Total trades in trades_raw
    const tradesResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM trades_raw',
      format: 'JSONEachRow',
    })
    const trades = (await tradesResult.json()) as Array<{ count: string }>
    console.log('2. Total trades in trades_raw:', trades[0].count)

    // 3. Wallets with market_id != ''
    const walletsWithMarketResult = await clickhouse.query({
      query: "SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw WHERE market_id != ''",
      format: 'JSONEachRow',
    })
    const walletsWithMarket = (await walletsWithMarketResult.json()) as Array<{ count: string }>
    console.log('3. Wallets with market_id != \'\':', walletsWithMarket[0].count)

    // 4. Trades with market_id != ''
    const tradesWithMarketResult = await clickhouse.query({
      query: "SELECT COUNT(*) as count FROM trades_raw WHERE market_id != ''",
      format: 'JSONEachRow',
    })
    const tradesWithMarket = (await tradesWithMarketResult.json()) as Array<{ count: string }>
    console.log('4. Trades with market_id != \'\':', tradesWithMarket[0].count)

    // 5. Wallets with empty market_id
    const walletsEmptyMarketResult = await clickhouse.query({
      query: "SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw WHERE market_id = ''",
      format: 'JSONEachRow',
    })
    const walletsEmptyMarket = (await walletsEmptyMarketResult.json()) as Array<{ count: string }>
    console.log('5. Wallets with market_id = \'\':', walletsEmptyMarket[0].count)

    // 6. Trades with empty market_id
    const tradesEmptyMarketResult = await clickhouse.query({
      query: "SELECT COUNT(*) as count FROM trades_raw WHERE market_id = ''",
      format: 'JSONEachRow',
    })
    const tradesEmptyMarket = (await tradesEmptyMarketResult.json()) as Array<{ count: string }>
    console.log('6. Trades with market_id = \'\':', tradesEmptyMarket[0].count)

    // 7. Check percentage
    const pctWithMarket = (
      (parseFloat(tradesWithMarket[0].count) / parseFloat(trades[0].count)) *
      100
    ).toFixed(2)
    console.log('\n7. Percentage of trades with market_id:', pctWithMarket + '%')

    // 8. Sample of wallets without market_id (if any)
    if (parseInt(walletsEmptyMarket[0].count) > 0) {
      const sampleEmptyResult = await clickhouse.query({
        query: "SELECT DISTINCT wallet_address FROM trades_raw WHERE market_id = '' LIMIT 5",
        format: 'JSONEachRow',
      })
      const sampleEmpty = (await sampleEmptyResult.json()) as Array<{ wallet_address: string }>
      console.log(
        '\n8. Sample wallets without market_id:',
        sampleEmpty.map((r) => r.wallet_address).join(', ')
      )
    }

    // 9. Check date range of trades
    const dateRangeResult = await clickhouse.query({
      query: 'SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts FROM trades_raw',
      format: 'JSONEachRow',
    })
    const dateRange = (await dateRangeResult.json()) as Array<{
      min_ts: string
      max_ts: string
    }>
    console.log('\n9. Date range of trades:')
    console.log('   Min timestamp:', dateRange[0].min_ts)
    console.log('   Max timestamp:', dateRange[0].max_ts)

    // 10. Distribution by market_id presence
    const distributionResult = await clickhouse.query({
      query: `SELECT
        (market_id != '') as has_market,
        COUNT(*) as count,
        COUNT(DISTINCT wallet_address) as wallets
      FROM trades_raw
      GROUP BY has_market`,
      format: 'JSONEachRow',
    })
    const distribution = (await distributionResult.json()) as Array<{
      has_market: number
      count: string
      wallets: string
    }>
    console.log('\n10. Distribution by market_id presence:')
    distribution.forEach((row) => {
      console.log(
        '   has_market_id=' + row.has_market + ':',
        row.count,
        'trades,',
        row.wallets,
        'wallets'
      )
    })

    // 11. Check wallets_dim table
    console.log('\n=== WALLETS_DIM TABLE ===')
    const walletsDimResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM wallets_dim',
      format: 'JSONEachRow',
    })
    const walletsDim = (await walletsDimResult.json()) as Array<{ count: string }>
    console.log('11. Total wallets in wallets_dim:', walletsDim[0].count)

    // 12. Check wallet_metrics_30d table
    console.log('\n=== WALLET_METRICS_30D TABLE ===')
    const metricsResult = await clickhouse.query({
      query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM wallet_metrics_30d',
      format: 'JSONEachRow',
    })
    const metrics = (await metricsResult.json()) as Array<{ count: string }>
    console.log('12. Distinct wallets in wallet_metrics_30d:', metrics[0].count)

    // 13. Check metrics by category count
    const metricsCategoryResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM wallet_metrics_by_category',
      format: 'JSONEachRow',
    })
    const metricsCategory = (await metricsCategoryResult.json()) as Array<{ count: string }>
    console.log(
      '13. Total rows in wallet_metrics_by_category:',
      metricsCategory[0].count
    )

    // 14. Sample wallets from trades_raw
    console.log('\n=== SAMPLE WALLETS ===')
    const sampleWalletsResult = await clickhouse.query({
      query: `SELECT
        wallet_address,
        COUNT(*) as trade_count,
        COUNT(DISTINCT market_id) as market_count
      FROM trades_raw
      WHERE market_id != ''
      GROUP BY wallet_address
      ORDER BY trade_count DESC
      LIMIT 5`,
      format: 'JSONEachRow',
    })
    const sampleWallets = (await sampleWalletsResult.json()) as Array<{
      wallet_address: string
      trade_count: string
      market_count: string
    }>
    console.log('14. Top 5 wallets by trade count:')
    sampleWallets.forEach((w) => {
      console.log(`   ${w.wallet_address}: ${w.trade_count} trades, ${w.market_count} markets`)
    })

    // 15. Check if there's any filtering in wallet_metrics_30d
    console.log('\n=== POTENTIAL FILTERING ANALYSIS ===')
    const filteringResult = await clickhouse.query({
      query: `SELECT
        (SELECT COUNT(DISTINCT wallet_address) FROM trades_raw WHERE market_id != '') as total_wallets_in_trades,
        (SELECT COUNT(DISTINCT wallet_address) FROM wallet_metrics_30d) as wallets_in_metrics`,
      format: 'JSONEachRow',
    })
    const filtering = (await filteringResult.json()) as Array<{
      total_wallets_in_trades: string
      wallets_in_metrics: string
    }>
    console.log('15. Filtering analysis:')
    console.log('   Wallets with trades (market_id != \'\'):', filtering[0].total_wallets_in_trades)
    console.log('   Wallets in metrics_30d table:', filtering[0].wallets_in_metrics)
    const missing = parseInt(filtering[0].total_wallets_in_trades) - parseInt(filtering[0].wallets_in_metrics)
    console.log('   Missing from metrics:', missing)

    process.exit(0)
  } catch (error) {
    console.error('Error querying database:', error)
    process.exit(1)
  }
}

checkDatabaseState()
