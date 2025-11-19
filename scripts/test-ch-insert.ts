#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('Testing ClickHouse insert...')

  try {
    // Test 1: Simple insert
    const testValues = [
      `('0xtest1', 0, 78000000, '0x4d97dcd97ec945f40cf65f87097ace5ea0476045', '0xtoken1', '0xfrom1', '0xto1', '0xdata1')`,
      `('0xtest2', 1, 78000001, '0x4d97dcd97ec945f40cf65f87097ace5ea0476045', '0xtoken2', '0xfrom2', '0xto2', '0xdata2')`
    ]

    const sql = `INSERT INTO erc1155_transfers VALUES ${testValues.join(', ')}`
    console.log('SQL:', sql.substring(0, 150) + '...')

    const start = Date.now()
    const result = await clickhouse.query({ query: sql })
    const elapsed = Date.now() - start

    console.log(`✅ Insert succeeded in ${elapsed}ms`)

    // Test 2: Verify count
    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM erc1155_transfers'
    })
    const countText = await countResult.text()
    console.log(`✅ Current row count: ${countText.trim()}`)

  } catch (e: any) {
    console.error('❌ Error:', e.message)
  }
}

main()
