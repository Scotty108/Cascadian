#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('Checking ClickHouse tables...\n')

  // Check condition_market_map
  try {
    const result = await clickhouse.query({
      query: "SHOW TABLES LIKE 'condition_market_map'",
      format: 'JSONEachRow'
    })
    const rows = await result.json() as any[]
    console.log('condition_market_map:', rows.length > 0 ? 'EXISTS' : 'NOT FOUND')
  } catch (error: any) {
    console.log('condition_market_map: ERROR -', error.message)
  }

  // Check markets_dim
  try {
    const result = await clickhouse.query({
      query: "SHOW TABLES LIKE 'markets_dim'",
      format: 'JSONEachRow'
    })
    const rows = await result.json() as any[]
    console.log('markets_dim:', rows.length > 0 ? 'EXISTS' : 'NOT FOUND')
  } catch (error: any) {
    console.log('markets_dim: ERROR -', error.message)
  }

  // Check events_dim
  try {
    const result = await clickhouse.query({
      query: "SHOW TABLES LIKE 'events_dim'",
      format: 'JSONEachRow'
    })
    const rows = await result.json() as any[]
    console.log('events_dim:', rows.length > 0 ? 'EXISTS' : 'NOT FOUND')
  } catch (error: any) {
    console.log('events_dim: ERROR -', error.message)
  }

  // Check trades_raw columns
  console.log('\ntrades_raw columns:')
  try {
    const result = await clickhouse.query({
      query: 'DESCRIBE TABLE trades_raw',
      format: 'JSONEachRow'
    })
    const rows = await result.json() as any[]
    const importantCols = ['tx_timestamp', 'wallet_address', 'condition_id', 'market_id', 'realized_pnl_usd', 'is_resolved']
    for (const col of importantCols) {
      const found = rows.find((r: any) => r.name === col)
      if (found) {
        console.log(`  ${col}: ${found.type}`)
      } else {
        console.log(`  ${col}: MISSING`)
      }
    }
  } catch (error: any) {
    console.log('ERROR -', error.message)
  }
}

main()
