#!/usr/bin/env npx tsx
/**
 * Quick coverage test - simplified to avoid header overflow
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function quickTest() {
  console.log('Quick Coverage Test')
  console.log('='.repeat(80))

  // Test 1: How many missing trades match to erc1155?
  console.log('\n📊 Coverage Test (sampling 100K missing trades)')
  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as sampled_missing_trades,
        COUNT(DISTINCT e.tx_hash) as matched_to_erc1155,
        round(COUNT(DISTINCT e.tx_hash) / COUNT(*) * 100, 2) as recovery_pct
      FROM (
        SELECT transaction_hash
        FROM trades_raw
        WHERE (condition_id IS NULL OR condition_id = '')
        LIMIT 100000
      ) t
      LEFT JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash)
    `,
    format: 'JSONEachRow'
  })
  const coverage = await coverageResult.json<any>()
  console.table(coverage)

  // Test 2: Validation against known good data
  console.log('\n✅ Validation (comparing extracted vs actual condition_id)')
  const validationResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as sample_size,
        countIf(t.condition_id = lower(substring(e.token_id, 43, 64))) as exact_matches,
        round(countIf(t.condition_id = lower(substring(e.token_id, 43, 64))) / COUNT(*) * 100, 2) as match_pct
      FROM (
        SELECT condition_id, transaction_hash
        FROM trades_raw
        WHERE condition_id != '' AND condition_id IS NOT NULL
        LIMIT 10000
      ) t
      INNER JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash)
      WHERE length(e.token_id) = 66
    `,
    format: 'JSONEachRow'
  })
  const validation = await validationResult.json<any>()
  console.table(validation)

  // Test 3: Total counts
  console.log('\n📏 Table Sizes')
  const sizesResult = await clickhouse.query({
    query: `
      SELECT
        'trades_raw (missing condition_id)' as table_name,
        COUNT(*) as row_count
      FROM trades_raw
      WHERE condition_id IS NULL OR condition_id = ''
      UNION ALL
      SELECT
        'erc1155_transfers' as table_name,
        COUNT(*) as row_count
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow'
  })
  const sizes = await sizesResult.json<any>()
  console.table(sizes)

  console.log('\n' + '='.repeat(80))
  console.log('✅ Quick test complete')
}

quickTest().catch(console.error)
