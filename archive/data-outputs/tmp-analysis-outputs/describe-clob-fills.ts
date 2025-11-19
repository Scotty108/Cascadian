#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function describeTable() {
  const client = getClickHouseClient()
  try {
    const result = await client.query({
      query: 'DESCRIBE TABLE clob_fills',
      format: 'JSONEachRow'
    })
    const schema = await result.json<any[]>()

    console.log('clob_fills schema:')
    schema.forEach(col => {
      console.log(`  ${col.name}: ${col.type}`)
    })

  } finally {
    await client.close()
  }
}

describeTable()
