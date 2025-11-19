#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function listTables() {
  const client = getClickHouseClient()
  try {
    const result = await client.query({
      query: `
        SELECT
          name,
          engine,
          total_rows,
          formatReadableSize(total_bytes) as size
        FROM system.tables
        WHERE database = 'default'
          AND (name LIKE '%trade%' OR name LIKE '%cashflow%' OR name LIKE '%fill%')
          AND engine NOT LIKE '%View%'
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow'
    })
    const tables = await result.json<any[]>()
    
    console.log('\nTrade/Fill/Cashflow Tables:\n')
    tables.forEach((t: any) => {
      const rows = parseInt(t.total_rows || 0)
      console.log(`${t.name}:`)
      console.log(`  Engine: ${t.engine}`)
      console.log(`  Rows: ${rows.toLocaleString()}`)
      console.log(`  Size: ${t.size}\n`)
    })
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

listTables()
