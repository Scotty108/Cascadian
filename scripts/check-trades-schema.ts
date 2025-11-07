#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function checkSchema() {
  const client = getClickHouseClient()

  // Check trades_raw schema
  const result = await client.query({
    query: 'DESCRIBE TABLE trades_raw',
    format: 'JSONEachRow'
  })

  const schema = await result.json()
  console.log('trades_raw schema:')
  console.log(JSON.stringify(schema, null, 2))

  // Sample data
  const sample = await client.query({
    query: 'SELECT * FROM trades_raw LIMIT 2',
    format: 'JSONEachRow'
  })

  const data = await sample.json()
  console.log('\nSample data:')
  console.log(JSON.stringify(data, null, 2))
}

checkSchema().catch(console.error)
