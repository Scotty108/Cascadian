#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function verifyAllTables() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n📊 ALL TABLES IN DATABASE (sorted by row count)\n')
    
    const result = await client.query({
      query: `
        SELECT 
          name,
          engine,
          total_rows,
          formatReadableSize(total_bytes) as size,
          total_bytes
        FROM system.tables
        WHERE database = 'default'
          AND name NOT LIKE '.%'
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow'
    })
    
    const tables = await result.json<any>()
    
    console.log('Table Name                                    | Engine              | Rows           | Size')
    console.log('----------------------------------------------|---------------------|----------------|------------')
    
    tables.forEach((t: any) => {
      const name = t.name.padEnd(45)
      const engine = t.engine.padEnd(19)
      const rows = t.total_rows.toString().padStart(14)
      console.log(`${name} | ${engine} | ${rows} | ${t.size}`)
    })
    
    console.log('\n📈 SUMMARY STATISTICS:')
    console.log(`Total tables: ${tables.length}`)
    console.log(`Total rows: ${tables.reduce((sum: number, t: any) => sum + parseInt(t.total_rows), 0).toLocaleString()}`)
    
    // Find the 388M table
    const bigTables = tables.filter((t: any) => parseInt(t.total_rows) > 100_000_000)
    console.log(`\n🔍 Tables with >100M rows:`)
    bigTables.forEach((t: any) => {
      console.log(`  - ${t.name}: ${parseInt(t.total_rows).toLocaleString()} rows`)
    })
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

verifyAllTables()
