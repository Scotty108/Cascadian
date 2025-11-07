#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function checkSchema() {
  const client = getClickHouseClient()

  // Check market_resolutions_final schema
  const result = await client.query({
    query: 'DESCRIBE TABLE market_resolutions_final',
    format: 'JSONEachRow'
  })

  const schema = await result.json()
  console.log('market_resolutions_final schema:')
  console.log(JSON.stringify(schema, null, 2))

  // Sample data
  const sample = await client.query({
    query: 'SELECT * FROM market_resolutions_final LIMIT 3',
    format: 'JSONEachRow'
  })

  const data = await sample.json()
  console.log('\nSample data:')
  console.log(JSON.stringify(data, null, 2))
}

checkSchema().catch(console.error)
