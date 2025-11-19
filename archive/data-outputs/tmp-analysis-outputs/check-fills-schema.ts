#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function checkSchema() {
  const client = getClickHouseClient()
  try {
    // Check if view exists
    const viewCheck = await client.query({
      query: `SELECT count() as exists FROM system.tables WHERE database = 'default' AND name = 'vw_clob_fills_enriched'`,
      format: 'JSONEachRow'
    })
    const exists = await viewCheck.json<any[]>()
    
    if (parseInt(exists[0].exists) === 0) {
      console.log('❌ View vw_clob_fills_enriched does not exist')
      console.log('\nChecking for alternative fills tables...\n')
      
      const tablesResult = await client.query({
        query: `SELECT name FROM system.tables WHERE database = 'default' AND (name LIKE '%fill%' OR name LIKE '%trade%') ORDER BY name`,
        format: 'JSONEachRow'
      })
      const tables = await tablesResult.json<any[]>()
      console.log('Available fills/trades tables:')
      tables.forEach(t => console.log(`  - ${t.name}`))
      return
    }
    
    const result = await client.query({
      query: 'DESCRIBE TABLE vw_clob_fills_enriched',
      format: 'JSONEachRow'
    })
    const schema = await result.json<any[]>()
    
    console.log('\nSchema of vw_clob_fills_enriched:\n')
    schema.forEach(col => {
      console.log(`  ${col.name}: ${col.type}`)
    })
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

checkSchema()
