#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function checkSchema() {
  const client = getClickHouseClient()
  try {
    const result = await client.query({
      query: 'SELECT * FROM default.wallet_ui_map LIMIT 1',
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()
    console.log('wallet_ui_map fields:', Object.keys(data[0]))
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}
checkSchema()
