import { clickhouse } from './lib/clickhouse/client'

async function main() {
  try {
    // 1. Get pm_trades details
    console.log('\n=== PM_TRADES (CLOB FILLS) INVENTORY ===\n')
    const pmTradesResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          min(timestamp) as earliest_trade,
          max(timestamp) as latest_trade,
          COUNT(DISTINCT market_id) as unique_markets,
          COUNT(DISTINCT maker_address) as unique_makers,
          COUNT(DISTINCT taker_address) as unique_takers,
          COUNT(DISTINCT COALESCE(maker_address, taker_address)) as unique_traders
        FROM pm_trades
      `,
      format: 'JSONEachRow',
    })
    const pmTrades = await pmTradesResult.json()
    console.log(JSON.stringify(pmTrades, null, 2))

    // 2. Get trades_raw details
    console.log('\n=== TRADES_RAW (WALLET TRADES) INVENTORY ===\n')
    const tradesRawResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          min(timestamp) as earliest_trade,
          max(timestamp) as latest_trade,
          COUNT(DISTINCT wallet_address) as unique_wallets,
          COUNT(DISTINCT market_id) as unique_markets,
          COUNT(DISTINCT side) as unique_sides
        FROM trades_raw
      `,
      format: 'JSONEachRow',
    })
    const tradesRaw = await tradesRawResult.json()
    console.log(JSON.stringify(tradesRaw, null, 2))

    // 3. Test wallets - get trade counts
    console.log('\n=== TEST WALLETS TRADE COVERAGE ===\n')
    const testWallets = [
      '0xHolyMoses7',
      'HolyMoses7',
      '0xniggemon',
      'niggemon'
    ]

    for (const wallet of testWallets) {
      const result = await clickhouse.query({
        query: `
          SELECT
            '${wallet}' as wallet,
            COUNT(*) as trades_raw_count,
            MIN(timestamp) as first_trade,
            MAX(timestamp) as last_trade
          FROM trades_raw
          WHERE lower(wallet_address) LIKE lower('%${wallet}%')
        `,
        format: 'JSONEachRow',
      })
      const data = await result.json()
      if (data[0] && data[0].trades_raw_count > 0) {
        console.log(JSON.stringify(data[0], null, 2))
      }
    }

    // 4. Check for CLOB-related staging tables
    console.log('\n=== RELATED DATA TABLES ===\n')
    const tableResult = await clickhouse.query({
      query: `
        SELECT
          name,
          total_rows,
          formatReadableSize(total_bytes) as size
        FROM system.tables
        WHERE database = currentDatabase()
          AND (
            name ILIKE '%clob%'
            OR name ILIKE '%fill%'
            OR name ILIKE '%trade%'
            OR name ILIKE '%polygon%'
            OR name ILIKE '%erc1155%'
            OR name ILIKE '%erc20%'
          )
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow',
    })
    const tables = await tableResult.json()
    console.log(JSON.stringify(tables, null, 2))

  } catch (error) {
    console.error('Error:', error)
  }
}

main()
