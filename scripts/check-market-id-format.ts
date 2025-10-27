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
  console.log('Sample market_ids from market_resolution_map:')
  const mapSample = await clickhouse.query({
    query: 'SELECT market_id FROM market_resolution_map LIMIT 5',
    format: 'JSONEachRow',
  })
  const mapData: any = await mapSample.json()
  mapData.forEach((row: any) => console.log(`  - ${row.market_id}`))

  console.log('\nSample market_ids from trades_raw:')
  const tradesSample = await clickhouse.query({
    query: 'SELECT DISTINCT market_id FROM trades_raw LIMIT 5',
    format: 'JSONEachRow',
  })
  const tradesData: any = await tradesSample.json()
  tradesData.forEach((row: any) => console.log(`  - ${row.market_id}`))

  console.log('\nSample condition_ids from market_resolution_map:')
  const conditionSample = await clickhouse.query({
    query: 'SELECT condition_id FROM market_resolution_map LIMIT 5',
    format: 'JSONEachRow',
  })
  const conditionData: any = await conditionSample.json()
  conditionData.forEach((row: any) => console.log(`  - ${row.condition_id}`))

  await clickhouse.close()
}

main()
