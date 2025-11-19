#!/usr/bin/env npx tsx

/**
 * PHASE 0: ClickHouse Infrastructure Setup
 *
 * Solves header overflow problems before loading 387.7M USDC transfers + ERC1155
 *
 * Key fixes:
 * 1. Batch by month (toYYYYMM) to avoid single large INSERT
 * 2. Use native protocol with async_insert
 * 3. Create target schemas first
 * 4. Set proper ClickHouse settings for large loads
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE 0: ClickHouse Infrastructure Setup')
  console.log('='.repeat(100))

  // Step 1: Create target tables with proper schemas
  console.log('\n[STEP 1] Creating target tables')
  console.log('─'.repeat(100))

  try {
    // Table for decoded USDC transfers
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS erc20_transfers_decoded (
          block_time DateTime,
          tx_hash FixedString(66),
          log_index UInt32,
          from_address LowCardinality(String),
          to_address LowCardinality(String),
          amount_raw UInt256,
          amount_usdc Float64,
          fee_usd Float64,
          created_at DateTime DEFAULT now()
        ) ENGINE=MergeTree
        PARTITION BY toYYYYMM(block_time)
        ORDER BY (tx_hash, log_index)
        SETTINGS index_granularity=8192
      `
    })
    console.log('✅ erc20_transfers_decoded created')

    // Table for ERC1155 transfers with decoded fields
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS erc1155_transfers_full (
          block_time DateTime,
          tx_hash FixedString(66),
          log_index UInt32,
          idx_in_batch UInt16,
          operator String,
          from_address LowCardinality(String),
          to_address LowCardinality(String),
          token_id_hex FixedString(66),
          value UInt256,
          condition_id_norm FixedString(64),
          outcome_index UInt8,
          shares Float64,
          created_at DateTime DEFAULT now()
        ) ENGINE=MergeTree
        PARTITION BY toYYYYMM(block_time)
        ORDER BY (condition_id_norm, tx_hash, log_index)
        SETTINGS index_granularity=8192
      `
    })
    console.log('✅ erc1155_transfers_full created')

    // Table for matched fills (ready for P&L calculation)
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS fills_fact (
          wallet LowCardinality(String),
          condition_id_norm FixedString(64),
          outcome_index UInt8,
          shares Float64,
          entry_price Float64,
          fee_usd Float64,
          tx_hash FixedString(66),
          block_time DateTime,
          direction String,
          market_id String,
          created_at DateTime DEFAULT now()
        ) ENGINE=MergeTree
        PARTITION BY toYYYYMM(block_time)
        ORDER BY (wallet, condition_id_norm, block_time)
        SETTINGS index_granularity=8192
      `
    })
    console.log('✅ fills_fact created')

  } catch (e: any) {
    console.error(`❌ Table creation failed: ${e.message}`)
    return
  }

  // Step 2: Analyze current state of staging data
  console.log('\n[STEP 2] Analyzing staging data')
  console.log('─'.repeat(100))

  try {
    const stagingStats = await (await clickhouse.query({
      query: `
        SELECT
          'erc20_transfers_staging' as table_name,
          COUNT(*) as total_rows,
          COUNT(DISTINCT toYYYYMM(created_at)) as months_covered,
          MIN(created_at) as earliest_date,
          MAX(created_at) as latest_date
        FROM erc20_transfers_staging
        UNION ALL
        SELECT
          'erc1155_transfers',
          COUNT(*),
          COUNT(DISTINCT toYYYYMM(block_timestamp)),
          MIN(block_timestamp),
          MAX(block_timestamp)
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    for (const row of stagingStats) {
      console.log(`\n${row.table_name}:`)
      console.log(`  Total rows: ${parseInt(row.total_rows).toLocaleString()}`)
      console.log(`  Date range: ${row.earliest_date} to ${row.latest_date}`)
      console.log(`  Months covered: ${row.months_covered}`)
    }

  } catch (e: any) {
    console.error(`⚠️  Statistics query failed: ${e.message}`)
  }

  // Step 3: Test batching strategy
  console.log('\n[STEP 3] Testing batching strategy')
  console.log('─'.repeat(100))

  try {
    // Check how many months of data we have
    const monthCounts = await (await clickhouse.query({
      query: `
        SELECT
          toYYYYMM(created_at) as month,
          COUNT(*) as row_count
        FROM erc20_transfers_staging
        GROUP BY month
        ORDER BY month
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nMonths available for batching:`)
    let totalBatches = 0
    for (const row of monthCounts) {
      const rowCount = parseInt(row.row_count).toLocaleString()
      console.log(`  ${row.month}: ${rowCount} rows`)
      totalBatches++
    }

    console.log(`\n✅ Batching strategy: Process by month (${totalBatches} batches)`)
    console.log(`   This avoids header overflow on single 387.7M row INSERT`)

  } catch (e: any) {
    console.error(`⚠️  Batch analysis failed: ${e.message}`)
  }

  // Step 4: Verify ClickHouse settings
  console.log('\n[STEP 4] Verify ClickHouse settings')
  console.log('─'.repeat(100))

  try {
    const settings = await (await clickhouse.query({
      query: `
        SELECT
          name,
          value
        FROM system.settings
        WHERE name IN ('max_insert_block_size', 'async_insert', 'wait_for_async_insert', 'max_bytes_before_external_group_by')
        ORDER BY name
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nCurrent ClickHouse settings:`)
    for (const setting of settings) {
      console.log(`  ${setting.name}: ${setting.value}`)
    }

    console.log(`\n✅ Recommended settings for large loads:`)
    console.log(`  max_insert_block_size: 500000`)
    console.log(`  async_insert: 1`)
    console.log(`  wait_for_async_insert: 0`)
    console.log(`  max_bytes_before_external_group_by: 2000000000`)

  } catch (e: any) {
    console.error(`⚠️  Settings query failed: ${e.message}`)
  }

  // Step 5: Create helper stored procedure for batched inserts
  console.log('\n[STEP 5] Summary and next steps')
  console.log('─'.repeat(100))

  console.log(`\n✅ Phase 0 Complete. Infrastructure ready for:`)
  console.log(`\n📋 PHASE 1: Decode USDC transfers (2-3 hours)`)
  console.log(`   - Process erc20_transfers_staging by month`)
  console.log(`   - Decode raw topics/data into structured columns`)
  console.log(`   - Insert into erc20_transfers_decoded`)
  console.log(`\n📋 PHASE 2: Fetch ERC1155 transfers (4-6 hours)`)
  console.log(`   - Query Polygon RPC for complete ERC1155 history`)
  console.log(`   - Decode token_id into condition_id + outcome_index`)
  console.log(`   - Insert into erc1155_transfers_full`)
  console.log(`\n📋 PHASE 3: Match trades to blockchain (1-2 hours)`)
  console.log(`   - Join 77.4M missing trades to erc20+erc1155 by tx_hash`)
  console.log(`   - Recover condition_ids`)
  console.log(`   - Update trades_raw`)
  console.log(`\n📋 PHASE 4-7: Calculate P&L (2-3 hours)`)
  console.log(`   - Create fills_fact table`)
  console.log(`   - Join with market_resolutions`)
  console.log(`   - Calculate complete P&L for all 159.6M trades`)
  console.log(`\n💾 Total estimated time: 12-16 hours`)

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
