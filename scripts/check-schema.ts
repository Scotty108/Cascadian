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
  const result = await clickhouse.query({
    query: 'DESCRIBE TABLE trades_raw',
    format: 'JSONEachRow',
  })

  const columns: any[] = await result.json()
  console.log('Columns in trades_raw:')
  columns.forEach(col => console.log(`  - ${col.name}: ${col.type}`))

  await clickhouse.close()
}

main()
