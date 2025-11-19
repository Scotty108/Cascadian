#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function checkSchema() {
  const client = getClickHouseClient()
  try {
    const result = await client.query({
      query: 'DESCRIBE TABLE winning_index',
      format: 'JSONEachRow'
    })
    const schema = await result.json<any[]>()
    
    console.log('\nSchema of winning_index:\n')
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
