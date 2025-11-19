#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function checkDefinition() {
  const client = getClickHouseClient()
  try {
    // Check if it's a table or view
    const typeResult = await client.query({
      query: `
        SELECT engine, create_table_query
        FROM system.tables
        WHERE database = 'default' AND name = 'trade_cashflows_v3'
      `,
      format: 'JSONEachRow'
    })
    const typeInfo = await typeResult.json<any[]>()
    
    if (typeInfo.length === 0) {
      console.log('❌ trade_cashflows_v3 does not exist')
      return
    }
    
    console.log('\nTable type:', typeInfo[0].engine)
    console.log('\n' + '='.repeat(80))
    console.log('CREATE TABLE/VIEW DEFINITION')
    console.log('='.repeat(80) + '\n')
    console.log(typeInfo[0].create_table_query)
    console.log('')
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

checkDefinition()
