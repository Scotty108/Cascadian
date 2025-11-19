#!/usr/bin/env npx tsx
/**
 * Investigation: Can we populate 77.4M missing condition_ids from metadata?
 *
 * Goal: Avoid blockchain scanning by using market metadata joins
 * Target: < 9 hours execution time
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function investigate() {
  console.log('🔍 INVESTIGATION: Condition ID Backfill Feasibility\n')
  console.log('=' .repeat(80))

  // Step 1: List all available tables
  console.log('\n📊 Step 1: Available Tables')
  console.log('-'.repeat(80))
  const tablesResult = await clickhouse.query({
    query: `
      SELECT name, engine, total_rows, formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database = currentDatabase()
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  })
  const tables = await tablesResult.json<any>()
  console.table(tables)

  // Step 2: Examine trades_raw schema
  console.log('\n📋 Step 2: trades_raw Schema')
  console.log('-'.repeat(80))
  const tradesSchemaResult = await clickhouse.query({
    query: `DESCRIBE TABLE trades_raw`,
    format: 'JSONEachRow'
  })
  const tradesSchema = await tradesSchemaResult.json<any>()
  console.log('Columns in trades_raw:')
  tradesSchema.forEach((col: any) => {
    console.log(`  - ${col.name}: ${col.type}`)
  })

  // Step 3: Check for market reference columns in trades_raw
  console.log('\n🔗 Step 3: Market Reference Columns in trades_raw')
  console.log('-'.repeat(80))
  const marketRefColumns = tradesSchema
    .filter((col: any) =>
      col.name.includes('market') ||
      col.name.includes('slug') ||
      col.name.includes('token') ||
      col.name.includes('asset')
    )
    .map((col: any) => col.name)

  console.log('Potential join columns:', marketRefColumns.join(', '))

  // Step 4: Sample trades_raw data (with missing condition_id)
  console.log('\n📝 Step 4: Sample trades_raw rows (missing condition_id)')
  console.log('-'.repeat(80))
  const sampleResult = await clickhouse.query({
    query: `
      SELECT market_id, wallet_address, timestamp, condition_id, transaction_hash
      FROM trades_raw
      WHERE condition_id IS NULL OR condition_id = ''
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const sampleRows = await sampleResult.json<any>()
  console.table(sampleRows)

  // Step 5: Count missing condition_ids
  console.log('\n📊 Step 5: Missing Condition ID Statistics')
  console.log('-'.repeat(80))
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        countIf(condition_id IS NULL OR condition_id = '') as missing_condition_id,
        countIf(condition_id IS NOT NULL AND condition_id != '') as has_condition_id,
        round(countIf(condition_id IS NULL OR condition_id = '') / COUNT(*) * 100, 2) as pct_missing
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })
  const stats = await statsResult.json<any>()
  console.table(stats)

  // Step 6: Check market_resolutions_final schema
  console.log('\n📋 Step 6: market_resolutions_final Schema')
  console.log('-'.repeat(80))
  const marketResSchemaResult = await clickhouse.query({
    query: `DESCRIBE TABLE market_resolutions_final`,
    format: 'JSONEachRow'
  })
  const marketResSchema = await marketResSchemaResult.json<any>()
  console.log('Columns in market_resolutions_final:')
  marketResSchema.forEach((col: any) => {
    console.log(`  - ${col.name}: ${col.type}`)
  })

  // Step 7: Check for other market metadata tables
  console.log('\n🔍 Step 7: Searching for Market Metadata Tables')
  console.log('-'.repeat(80))
  const marketTablesResult = await clickhouse.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE '%market%' OR name LIKE '%token%' OR name LIKE '%metadata%')
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  })
  const marketTables = await marketTablesResult.json<any>()
  console.table(marketTables)

  // Step 8: Check if we have asset_id in trades_raw (common join key)
  console.log('\n🔑 Step 8: Checking for asset_id column')
  console.log('-'.repeat(80))
  const hasAssetId = tradesSchema.some((col: any) => col.name === 'asset_id')
  console.log(`asset_id column exists: ${hasAssetId}`)

  if (hasAssetId) {
    const assetIdStatsResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          countIf(asset_id IS NOT NULL AND asset_id != '') as has_asset_id,
          countIf(condition_id IS NULL OR condition_id = '') as missing_condition_id,
          countIf((condition_id IS NULL OR condition_id = '') AND (asset_id IS NOT NULL AND asset_id != '')) as can_recover_via_asset_id
        FROM trades_raw
      `,
      format: 'JSONEachRow'
    })
    const assetIdStats = await assetIdStatsResult.json<any>()
    console.table(assetIdStats)
  }

  // Step 9: Sample market_resolutions_final data
  console.log('\n📝 Step 9: Sample market_resolutions_final rows')
  console.log('-'.repeat(80))
  const marketSampleResult = await clickhouse.query({
    query: `
      SELECT market_slug, condition_id, question
      FROM market_resolutions_final
      WHERE condition_id IS NOT NULL AND condition_id != ''
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const marketSample = await marketSampleResult.json<any>()
  console.table(marketSample)

  console.log('\n' + '='.repeat(80))
  console.log('✅ Investigation Complete - Analyzing join possibilities...')
}

investigate().catch(console.error)
