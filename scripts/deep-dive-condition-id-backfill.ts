#!/usr/bin/env npx tsx
/**
 * DEEP DIVE: Condition ID Backfill via Metadata Joins
 *
 * Objective: Find the join path to populate 77.4M missing condition_ids
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function deepDive() {
  console.log('=' .repeat(100))
  console.log('DEEP DIVE: Finding the Join Path for Condition ID Recovery')
  console.log('='.repeat(100))

  // Critical finding: market_id in trades_raw is all zeros!
  console.log('\n🚨 CRITICAL: market_id in trades_raw appears to be all zeros!')
  console.log('This means we need a different join key...\n')

  // Check condition_market_map schema
  console.log('\n📋 Step 1: Examine condition_market_map schema (151,843 rows)')
  console.log('-'.repeat(100))
  const condMapResult = await clickhouse.query({
    query: `DESCRIBE TABLE condition_market_map`,
    format: 'JSONEachRow'
  })
  const condMapSchema = await condMapResult.json<any>()
  console.log('condition_market_map columns:')
  condMapSchema.forEach((col: any) => console.log(`  - ${col.name}: ${col.type}`))

  // Sample condition_market_map
  console.log('\n📝 Sample condition_market_map data:')
  const condMapSampleResult = await clickhouse.query({
    query: `SELECT * FROM condition_market_map LIMIT 5`,
    format: 'JSONEachRow'
  })
  const condMapSample = await condMapSampleResult.json<any>()
  console.table(condMapSample)

  // Check market_key_map schema
  console.log('\n📋 Step 2: Examine market_key_map schema (156,952 rows)')
  console.log('-'.repeat(100))
  const keyMapResult = await clickhouse.query({
    query: `DESCRIBE TABLE market_key_map`,
    format: 'JSONEachRow'
  })
  const keyMapSchema = await keyMapResult.json<any>()
  console.log('market_key_map columns:')
  keyMapSchema.forEach((col: any) => console.log(`  - ${col.name}: ${col.type}`))

  // Sample market_key_map
  console.log('\n📝 Sample market_key_map data:')
  const keyMapSampleResult = await clickhouse.query({
    query: `SELECT * FROM market_key_map LIMIT 5`,
    format: 'JSONEachRow'
  })
  const keyMapSample = await keyMapSampleResult.json<any>()
  console.table(keyMapSample)

  // Check api_ctf_bridge schema (likely has token_id to condition_id mapping)
  console.log('\n📋 Step 3: Examine api_ctf_bridge schema (156,952 rows)')
  console.log('-'.repeat(100))
  const bridgeResult = await clickhouse.query({
    query: `DESCRIBE TABLE api_ctf_bridge`,
    format: 'JSONEachRow'
  })
  const bridgeSchema = await bridgeResult.json<any>()
  console.log('api_ctf_bridge columns:')
  bridgeSchema.forEach((col: any) => console.log(`  - ${col.name}: ${col.type}`))

  // Sample api_ctf_bridge
  console.log('\n📝 Sample api_ctf_bridge data:')
  const bridgeSampleResult = await clickhouse.query({
    query: `SELECT * FROM api_ctf_bridge LIMIT 5`,
    format: 'JSONEachRow'
  })
  const bridgeSample = await bridgeSampleResult.json<any>()
  console.table(bridgeSample)

  // Check ctf_token_map schema
  console.log('\n📋 Step 4: Examine ctf_token_map schema (41,130 rows)')
  console.log('-'.repeat(100))
  const tokenMapResult = await clickhouse.query({
    query: `DESCRIBE TABLE ctf_token_map`,
    format: 'JSONEachRow'
  })
  const tokenMapSchema = await tokenMapResult.json<any>()
  console.log('ctf_token_map columns:')
  tokenMapSchema.forEach((col: any) => console.log(`  - ${col.name}: ${col.type}`))

  // Sample ctf_token_map
  console.log('\n📝 Sample ctf_token_map data:')
  const tokenMapSampleResult = await clickhouse.query({
    query: `SELECT * FROM ctf_token_map LIMIT 5`,
    format: 'JSONEachRow'
  })
  const tokenMapSample = await tokenMapSampleResult.json<any>()
  console.table(tokenMapSample)

  // Check what columns trades_raw HAS that could be join keys
  console.log('\n🔑 Step 5: What keys does trades_raw have for joining?')
  console.log('-'.repeat(100))
  const tradesNonEmptyResult = await clickhouse.query({
    query: `
      SELECT
        countIf(market_id != '0x0000000000000000000000000000000000000000000000000000000000000000') as market_id_populated,
        countIf(transaction_hash != '') as has_tx_hash,
        COUNT(*) as total
      FROM trades_raw
      WHERE condition_id IS NULL OR condition_id = ''
      LIMIT 1
    `,
    format: 'JSONEachRow'
  })
  const keyStats = await tradesNonEmptyResult.json<any>()
  console.table(keyStats)

  // Sample a trade with NON-EMPTY condition_id to see the pattern
  console.log('\n📝 Step 6: Sample trades WITH condition_id (to see join pattern)')
  console.log('-'.repeat(100))
  const goodTradesResult = await clickhouse.query({
    query: `
      SELECT market_id, condition_id, transaction_hash, timestamp
      FROM trades_raw
      WHERE condition_id != '' AND condition_id IS NOT NULL
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const goodTrades = await goodTradesResult.json<any>()
  console.table(goodTrades)

  // Check if transaction_hash can be used to join to ERC1155 transfers
  console.log('\n🔗 Step 7: Can we join trades → erc1155_transfers via tx_hash?')
  console.log('-'.repeat(100))
  const erc1155Result = await clickhouse.query({
    query: `DESCRIBE TABLE erc1155_transfers`,
    format: 'JSONEachRow'
  })
  const erc1155Schema = await erc1155Result.json<any>()
  console.log('erc1155_transfers columns:')
  erc1155Schema.forEach((col: any) => console.log(`  - ${col.name}: ${col.type}`))

  // Sample erc1155_transfers
  console.log('\n📝 Sample erc1155_transfers data:')
  const erc1155SampleResult = await clickhouse.query({
    query: `SELECT * FROM erc1155_transfers LIMIT 5`,
    format: 'JSONEachRow'
  })
  const erc1155Sample = await erc1155SampleResult.json<any>()
  console.table(erc1155Sample)

  // Test JOIN feasibility
  console.log('\n🧪 Step 8: TEST JOIN - Can we match trades to condition_id via tx_hash?')
  console.log('-'.repeat(100))
  const testJoinResult = await clickhouse.query({
    query: `
      SELECT
        t.transaction_hash,
        t.market_id as trade_market_id,
        t.condition_id as trade_condition_id,
        e.token_id as erc1155_token_id,
        e.value as transfer_amount
      FROM trades_raw t
      INNER JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.transaction_hash)
      WHERE (t.condition_id IS NULL OR t.condition_id = '')
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })
  const testJoin = await testJoinResult.json<any>()
  console.log('Sample join result (trades → erc1155 via tx_hash):')
  console.table(testJoin)

  // Count how many we could recover via this path
  console.log('\n📊 Step 9: Coverage Analysis - How many can we recover?')
  console.log('-'.repeat(100))
  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT t.transaction_hash) as missing_trades_with_tx,
        COUNT(DISTINCT e.transaction_hash) as erc1155_txs,
        COUNT(DISTINCT t.transaction_hash) as matchable_trades
      FROM (
        SELECT transaction_hash
        FROM trades_raw
        WHERE (condition_id IS NULL OR condition_id = '')
        LIMIT 10000
      ) t
      LEFT JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.transaction_hash)
    `,
    format: 'JSONEachRow'
  })
  const coverage = await coverageResult.json<any>()
  console.table(coverage)

  console.log('\n' + '='.repeat(100))
  console.log('✅ Deep Dive Complete')
}

deepDive().catch(console.error)
