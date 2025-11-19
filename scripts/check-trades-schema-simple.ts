#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function main() {
  const client = getClickHouseClient()
  const result = await client.query({ query: 'SELECT * FROM default.trades_raw LIMIT 1', format: 'JSONEachRow' })
  const data = await result.json()
  console.log('Sample row fields:', Object.keys(data[0]))
  await client.close()
}

main().catch(console.error)
