#!/usr/bin/env npx tsx
/**
 * FINAL FEASIBILITY TEST: Can we populate 77.4M condition_ids via metadata?
 *
 * Strategy: trades_raw → erc1155_transfers (via tx_hash) → ctf_token_map → condition_id
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function finalTest() {
  console.log('='.repeat(100))
  console.log('FINAL FEASIBILITY TEST: Condition ID Recovery via Metadata Joins')
  console.log('='.repeat(100))

  // Step 1: Test the JOIN path
  console.log('\n🧪 Step 1: Test JOIN - trades → erc1155 via tx_hash')
  console.log('-'.repeat(100))
  try {
    const testJoinResult = await clickhouse.query({
      query: `
        SELECT
          t.transaction_hash,
          t.market_id as trade_market_id,
          t.condition_id as trade_condition_id,
          e.token_id as erc1155_token_id,
          e.value as transfer_amount
        FROM trades_raw t
        INNER JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash)
        WHERE (t.condition_id IS NULL OR t.condition_id = '')
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const testJoin = await testJoinResult.json<any>()
    console.log('SUCCESS! Sample join (first 10 rows):')
    console.table(testJoin)
  } catch (error: any) {
    console.error('JOIN FAILED:', error.message)
    return
  }

  // Step 2: Extract condition_id from token_id
  console.log('\n🔍 Step 2: Extract condition_id from token_id')
  console.log('-'.repeat(100))
  console.log('Token ID structure: [collection_id (20 bytes)][condition_id (32 bytes)][index (1 byte)]')
  console.log('We need bytes 21-52 (0-indexed) = substring(token_id, 43, 64)')

  const extractTestResult = await clickhouse.query({
    query: `
      SELECT
        t.transaction_hash,
        e.token_id as full_token_id,
        lower(substring(e.token_id, 3, 40)) as collection_id,
        lower(substring(e.token_id, 43, 64)) as extracted_condition_id,
        t.condition_id as current_condition_id
      FROM trades_raw t
      INNER JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash)
      WHERE (t.condition_id IS NULL OR t.condition_id = '')
        AND length(e.token_id) = 66
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })
  const extractTest = await extractTestResult.json<any>()
  console.log('Extraction test results:')
  console.table(extractTest)

  // Step 3: Count coverage
  console.log('\n📊 Step 3: Coverage Analysis')
  console.log('-'.repeat(100))
  const coverageResult = await clickhouse.query({
    query: `
      WITH missing_trades AS (
        SELECT transaction_hash
        FROM trades_raw
        WHERE (condition_id IS NULL OR condition_id = '')
      )
      SELECT
        (SELECT COUNT(*) FROM missing_trades) as total_missing_trades,
        COUNT(DISTINCT m.transaction_hash) as missing_with_tx_hash,
        COUNT(DISTINCT e.tx_hash) as matched_to_erc1155,
        round(COUNT(DISTINCT e.tx_hash) / (SELECT COUNT(*) FROM missing_trades) * 100, 2) as recovery_pct
      FROM missing_trades m
      LEFT JOIN erc1155_transfers e ON lower(m.transaction_hash) = lower(e.tx_hash)
    `,
    format: 'JSONEachRow'
  })
  const coverage = await coverageResult.json<any>()
  console.log('Coverage statistics:')
  console.table(coverage)

  // Step 4: Validate condition_id extraction quality
  console.log('\n✅ Step 4: Validation - Compare extracted condition_id with known good trades')
  console.log('-'.repeat(100))
  const validationResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as sample_size,
        countIf(t.condition_id = lower(substring(e.token_id, 43, 64))) as exact_matches,
        round(countIf(t.condition_id = lower(substring(e.token_id, 43, 64))) / COUNT(*) * 100, 2) as match_pct
      FROM trades_raw t
      INNER JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash)
      WHERE t.condition_id != '' AND t.condition_id IS NOT NULL
        AND length(e.token_id) = 66
      LIMIT 10000
    `,
    format: 'JSONEachRow'
  })
  const validation = await validationResult.json<any>()
  console.log('Validation against known good data:')
  console.table(validation)

  // Step 5: Estimate runtime for full backfill
  console.log('\n⏱️  Step 5: Runtime Estimation')
  console.log('-'.repeat(100))

  // Get table sizes
  const sizesResult = await clickhouse.query({
    query: `
      SELECT
        (SELECT COUNT(*) FROM trades_raw WHERE condition_id IS NULL OR condition_id = '') as missing_trades,
        (SELECT COUNT(*) FROM erc1155_transfers) as erc1155_rows
    `,
    format: 'JSONEachRow'
  })
  const sizes = await sizesResult.json<any>()

  console.log('Table sizes:')
  console.table(sizes)

  const missing = parseInt(sizes[0].missing_trades)
  const erc1155 = parseInt(sizes[0].erc1155_rows)

  // Estimate: 77M trades × 291K erc1155 = large join
  // Using hash join on indexed tx_hash should be fast
  // Estimate: 500K rows/sec processing = ~155 seconds = ~2.6 minutes
  const estimatedSeconds = Math.ceil(missing / 500000)
  const estimatedMinutes = Math.ceil(estimatedSeconds / 60)

  console.log(`\nEstimated runtime for UPDATE: ${estimatedMinutes} minutes (${estimatedSeconds} seconds)`)
  console.log('Assumptions: 500K rows/sec processing speed, indexed tx_hash join')

  // Step 6: Provide the UPDATE query
  console.log('\n📝 Step 6: Proposed UPDATE Query')
  console.log('-'.repeat(100))
  console.log(`
  -- OPTION 1: Direct UPDATE (ClickHouse doesn't support UPDATE well on large tables)
  -- NOT RECOMMENDED for 77M rows - too slow

  -- OPTION 2: CREATE new table + RENAME (RECOMMENDED - Atomic Rebuild pattern)
  CREATE TABLE trades_raw_with_condition_id ENGINE = MergeTree
  PARTITION BY toYYYYMM(timestamp)
  ORDER BY (wallet_address, timestamp, trade_id)
  AS
  SELECT
    t.*,
    COALESCE(
      t.condition_id,
      lower(substring(e.token_id, 43, 64))
    ) as condition_id_recovered
  FROM trades_raw t
  LEFT JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash) AND length(e.token_id) = 66
  ;

  -- Then swap tables:
  RENAME TABLE trades_raw TO trades_raw_old,
               trades_raw_with_condition_id TO trades_raw;

  -- Verify and drop old:
  DROP TABLE trades_raw_old;
  `)

  console.log('\n' + '='.repeat(100))
  console.log('✅ Feasibility Test Complete')
  console.log('='.repeat(100))
}

finalTest().catch(console.error)
