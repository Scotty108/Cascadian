#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  // Check total trades
  const tradesCount = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw',
    format: 'JSONEachRow',
  })
  const tradesData: any = await tradesCount.json()
  console.log(`Total trades in trades_raw: ${tradesData[0]?.count || 0}`)

  // Check sample market_ids
  const sampleTrades = await clickhouse.query({
    query: 'SELECT DISTINCT market_id FROM trades_raw LIMIT 5',
    format: 'JSONEachRow',
  })
  const sampleData: any = await sampleTrades.json()
  console.log(`\nSample market_ids from trades_raw:`)
  sampleData.forEach((row: any) => console.log(`  - ${row.market_id}`))

  // Check if any match
  const matchCount = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM trades_raw t
      INNER JOIN market_resolution_map m ON t.market_id = m.market_id
    `,
    format: 'JSONEachRow',
  })
  const matchData: any = await matchCount.json()
  console.log(`\nTrades matching market_resolution_map: ${matchData[0]?.count || 0}`)

  await clickhouse.close()
}

main()
