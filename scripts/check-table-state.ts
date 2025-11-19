#!/usr/bin/env npx tsx
/**
 * CHECK TABLE STATE
 * Quick script to check current state of erc1155_transfers and tmp_block_timestamps
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function checkTableState() {
  const client = getClickHouseClient()

  console.log('\n🔍 Checking current table state...\n')

  try {
    // Check databases
    console.log('=== Databases ===')
    const databases = await client.query({
      query: 'SHOW DATABASES',
      format: 'JSONEachRow',
    })
    const dbRows = await databases.json()
    console.log('Databases:', dbRows.map((r: any) => r.name).join(', '))

    // Check erc1155_transfers
    console.log('\n=== Current erc1155_transfers ===')
    const transfersResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_number) as min_block,
          max(block_number) as max_block,
          countIf(block_timestamp > 0) as rows_with_timestamp,
          countIf(block_timestamp = 0) as rows_without_timestamp
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow',
    })
    const transfersData = await transfersResult.json()
    console.log(JSON.stringify(transfersData[0], null, 2))

    // Check if tmp_block_timestamps exists
    console.log('\n=== Check tmp_block_timestamps ===')
    const tableCheckResult = await client.query({
      query: `
        SELECT count() as exists
        FROM system.tables
        WHERE database = 'default' AND name = 'tmp_block_timestamps'
      `,
      format: 'JSONEachRow',
    })
    const tableCheckData = await tableCheckResult.json()
    const tmpTableExists = tableCheckData[0].exists > 0

    if (tmpTableExists) {
      console.log('✅ tmp_block_timestamps exists')
      const tmpResult = await client.query({
        query: `
          SELECT
            count() as total_rows,
            min(block_number) as min_block,
            max(block_number) as max_block
          FROM default.tmp_block_timestamps
        `,
        format: 'JSONEachRow',
      })
      const tmpData = await tmpResult.json()
      console.log(JSON.stringify(tmpData[0], null, 2))
    } else {
      console.log('❌ tmp_block_timestamps does NOT exist')
    }

    // Sample data
    console.log('\n=== Sample erc1155_transfers (5 rows) ===')
    const sampleResult = await client.query({
      query: 'SELECT * FROM default.erc1155_transfers LIMIT 5',
      format: 'JSONEachRow',
    })
    const sampleData = await sampleResult.json()
    console.log(JSON.stringify(sampleData, null, 2))

  } catch (error: any) {
    console.error('❌ Error:', error.message)
    if (error.code) console.error('   Code:', error.code)
  } finally {
    await client.close()
  }
}

checkTableState().catch(console.error)
