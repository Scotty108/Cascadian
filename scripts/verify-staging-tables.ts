#!/usr/bin/env npx tsx
/**
 * VERIFY STAGING TABLES
 * Check that staging tables were created and have data
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function verifyStagingTables() {
  const client = getClickHouseClient()

  console.log('\n🔍 Verifying staging tables...\n')

  try {
    // Check erc1155_transfers_v2
    console.log('=== staging.erc1155_transfers_v2 ===')
    const transfersResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_number) as min_block,
          max(block_number) as max_block,
          count(DISTINCT block_number) as unique_blocks,
          countIf(block_timestamp = toDateTime(0)) as zero_timestamps
        FROM staging.erc1155_transfers_v2
      `,
      format: 'JSONEachRow',
    })
    const transfersData = await transfersResult.json<any>()
    console.log(JSON.stringify(transfersData[0], null, 2))

    // Check tmp_block_timestamps_v2
    console.log('\n=== staging.tmp_block_timestamps_v2 ===')
    const timestampsResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM staging.tmp_block_timestamps_v2
      `,
      format: 'JSONEachRow',
    })
    const timestampsData = await timestampsResult.json<any>()
    console.log(JSON.stringify(timestampsData[0], null, 2))

    // Sample data
    console.log('\n=== Sample transfers (5 rows) ===')
    const sampleResult = await client.query({
      query: 'SELECT * FROM staging.erc1155_transfers_v2 LIMIT 5',
      format: 'JSONEachRow',
    })
    const sampleData = await sampleResult.json()
    console.log(JSON.stringify(sampleData, null, 2))

    console.log('\n✅ Verification complete!')

  } catch (error: any) {
    console.error('❌ Error:', error.message)
  } finally {
    await client.close()
  }
}

verifyStagingTables().catch(console.error)
