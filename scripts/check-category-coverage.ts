#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('Checking category coverage...\n')

  // Check how many markets have event_id
  const marketQuery = await clickhouse.query({
    query: `
      SELECT
        count() as total_markets,
        countIf(event_id != '') as markets_with_event
      FROM markets_dim
    `,
    format: 'JSONEachRow'
  })
  const marketData = await marketQuery.json<{ total_markets: string, markets_with_event: string }>()
  console.log('Markets Dimension:')
  console.log(`  Total markets: ${marketData[0].total_markets}`)
  console.log(`  Markets with event_id: ${marketData[0].markets_with_event}`)
  console.log(`  Coverage: ${(parseInt(marketData[0].markets_with_event) / parseInt(marketData[0].total_markets) * 100).toFixed(2)}%\n`)

  // Check how many trades have markets in markets_dim
  const tradeJoinQuery = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(m.market_id IS NOT NULL) as trades_with_market_dim,
        countIf(m.event_id != '') as trades_with_event
      FROM trades_raw t
      LEFT JOIN markets_dim m ON t.market_id = m.market_id
    `,
    format: 'JSONEachRow'
  })
  const tradeJoinData = await tradeJoinQuery.json<{ total_trades: string, trades_with_market_dim: string, trades_with_event: string }>()
  console.log('Trades Coverage:')
  console.log(`  Total trades: ${tradeJoinData[0].total_trades}`)
  console.log(`  Trades with market in markets_dim: ${tradeJoinData[0].trades_with_market_dim} (${(parseInt(tradeJoinData[0].trades_with_market_dim) / parseInt(tradeJoinData[0].total_trades) * 100).toFixed(2)}%)`)
  console.log(`  Trades with event_id: ${tradeJoinData[0].trades_with_event} (${(parseInt(tradeJoinData[0].trades_with_event) / parseInt(tradeJoinData[0].total_trades) * 100).toFixed(2)}%)\n`)

  // Check actual categorization in trades_raw
  const categorizedQuery = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(canonical_category != 'Uncategorized') as categorized,
        countIf(length(raw_tags) > 0) as with_tags
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })
  const categorizedData = await categorizedQuery.json<{ total: string, categorized: string, with_tags: string }>()
  console.log('Actual Categorization in trades_raw:')
  console.log(`  Total trades: ${categorizedData[0].total}`)
  console.log(`  Categorized: ${categorizedData[0].categorized} (${(parseInt(categorizedData[0].categorized) / parseInt(categorizedData[0].total) * 100).toFixed(2)}%)`)
  console.log(`  With tags: ${categorizedData[0].with_tags} (${(parseInt(categorizedData[0].with_tags) / parseInt(categorizedData[0].total) * 100).toFixed(2)}%)`)
}

main().catch(console.error)
