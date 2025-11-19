#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function checkSchema() {
  const client = getClickHouseClient()
  try {
    const result = await client.query({
      query: 'SELECT * FROM default.erc20_transfers_staging LIMIT 1',
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()
    console.log('erc20_transfers_staging fields:', Object.keys(data[0]))
    
    // Also get row count
    const countResult = await client.query({
      query: 'SELECT count() as c FROM default.erc20_transfers_staging',
      format: 'JSONEachRow'
    })
    const count = await countResult.json<any>()
    console.log('Total rows:', count[0].c)
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}
checkSchema()
