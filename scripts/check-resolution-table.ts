#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  try {
    // Check if table exists
    const result = await clickhouse.query({
      query: `
        SELECT COUNT(*) as count
        FROM system.tables
        WHERE database = currentDatabase()
          AND name = 'market_resolution_map'
      `,
      format: 'JSONEachRow',
    })
    const data: any = await result.json()
    const exists = data[0]?.count > 0

    console.log(`market_resolution_map exists: ${exists}`)

    if (exists) {
      const countResult = await clickhouse.query({
        query: 'SELECT COUNT(*) as count FROM market_resolution_map',
        format: 'JSONEachRow',
      })
      const countData: any = await countResult.json()
      console.log(`Row count: ${countData[0]?.count || 0}`)
    }
  } catch (error) {
    console.error('Error:', error)
  } finally {
    await clickhouse.close()
  }
}

main()
