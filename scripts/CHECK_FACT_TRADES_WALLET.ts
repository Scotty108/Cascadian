#!/usr/bin/env tsx
/**
 * Check fact_trades tables for wallet coverage using cid_hex column
 */

import { createClient } from '@clickhouse/client'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const TARGET_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad'

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: 'default',
  request_timeout: 300000,
})

async function main() {
  console.log('Checking fact_trades tables for wallet:', TARGET_WALLET)
  console.log('='.repeat(80))
  console.log('')

  const tables = [
    'cascadian_clean.fact_trades_BROKEN_CIDS',
    'cascadian_clean.fact_trades_clean',
    'cascadian_clean.fact_trades_backup',
    'default.fact_trades_clean',
  ]

  for (const table of tables) {
    console.log(`Querying ${table}...`)

    try {
      const result = await client.query({
        query: `
          SELECT
            COUNT(*) as total_rows,
            COUNT(DISTINCT cid_hex) as unique_markets,
            MIN(block_time) as earliest,
            MAX(block_time) as latest
          FROM ${table}
          WHERE lower(wallet_address) = lower('${TARGET_WALLET}')
        `,
        format: 'JSONEachRow',
      })

      const data = await result.json<any>()

      if (data[0].total_rows > 0) {
        console.log(`  ✅ FOUND DATA`)
        console.log(`     Total Rows: ${parseInt(data[0].total_rows).toLocaleString()}`)
        console.log(`     Unique Markets: ${parseInt(data[0].unique_markets).toLocaleString()}`)
        console.log(`     Date Range: ${data[0].earliest} to ${data[0].latest}`)
      } else {
        console.log(`  ❌ No data`)
      }
    } catch (error) {
      console.log(`  ⚠️  Error: ${error instanceof Error ? error.message : 'Unknown'}`)
    }

    console.log('')
  }

  // Get sample data from best table
  console.log('Getting sample data from fact_trades_clean...')
  const sampleResult = await client.query({
    query: `
      SELECT *
      FROM cascadian_clean.fact_trades_clean
      WHERE lower(wallet_address) = lower('${TARGET_WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  })

  const samples = await sampleResult.json<any>()
  console.log(JSON.stringify(samples, null, 2))

  await client.close()
}

main().catch(console.error)
