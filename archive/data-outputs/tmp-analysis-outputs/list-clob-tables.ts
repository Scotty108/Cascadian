#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function listTables() {
  const client = getClickHouseClient()
  try {
    const result = await client.query({
      query: "SHOW TABLES LIKE '%clob%'",
      format: 'JSONEachRow'
    })
    const tables = await result.json<Array<{ name: string }>>()

    console.log('CLOB tables found:')
    tables.forEach(t => console.log(`  - ${t.name}`))

    console.log('\n\nAll tables:')
    const all = await client.query({
      query: 'SHOW TABLES',
      format: 'JSONEachRow'
    })
    const allTables = await all.json<Array<{ name: string }>>()
    allTables.forEach(t => console.log(`  - ${t.name}`))

  } finally {
    await client.close()
  }
}

listTables()
