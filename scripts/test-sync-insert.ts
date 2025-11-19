#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('Testing synchronous insert...\n')

  // Get current count
  const beforeResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM erc1155_transfers'
  })
  const beforeText = await beforeResult.text()
  const beforeCount = parseInt(beforeText.trim())
  console.log(`Before: ${beforeCount} rows\n`)

  // Try sync insert with settings
  console.log('Executing synchronous INSERT...')
  const insertSQL = `INSERT INTO erc1155_transfers
    (tx_hash, log_index, block_number, block_timestamp, contract, token_id, from_address, to_address, value, operator, decoded_data, raw_json)
    VALUES
      ('0xtest1', 1, 62500000, now(), '0x4d97dcd97ec945f40cf65f87097ace5ea0476045', '0xabc', '0xfrom1', '0xto1', 0, '', '', '0x'),
      ('0xtest2', 2, 62500001, now(), '0x4d97dcd97ec945f40cf65f87097ace5ea0476045', '0xdef', '0xfrom2', '0xto2', 0, '', '', '0x')`

  try {
    const result = await clickhouse.query({
      query: insertSQL,
      query_id: `test_${Date.now()}`
    })
    console.log(`✅ Insert executed\n`)
  } catch (e) {
    console.error(`❌ Insert failed:`, e)
  }

  // Wait 2 seconds
  await new Promise(r => setTimeout(r, 2000))

  // Check count again
  const afterResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM erc1155_transfers'
  })
  const afterText = await afterResult.text()
  const afterCount = parseInt(afterText.trim())
  console.log(`After: ${afterCount} rows`)
  console.log(`Inserted: ${afterCount - beforeCount} rows\n`)

  if (afterCount > beforeCount) {
    console.log('✅ SYNC INSERT WORKS - Data is persisting!')
  } else {
    console.log('❌ STILL NOT PERSISTING - Need different approach')
  }
}

main().catch(console.error)
