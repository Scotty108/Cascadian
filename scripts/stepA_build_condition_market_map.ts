#!/usr/bin/env tsx
/**
 * Phase 0 Task 0.2: Rebuild condition→market map
 *
 * Reads expanded_resolution_map.json and builds a mapping from condition_id to market_id
 * in the ClickHouse condition_market_map table.
 *
 * This ensures all trades can be enriched with proper market_id references.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

interface ResolutionEntry {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO'
  payout_yes: 0 | 1
  payout_no: 0 | 1
  resolved_at: string | null
}

interface ResolutionMapFile {
  total_conditions: number
  resolved_conditions: number
  last_updated: string
  resolutions: ResolutionEntry[]
}

async function main() {
  console.log('📍 Phase 0 Task 0.2: Rebuild condition→market map\n')

  // Load expanded_resolution_map.json
  const resolutionMapPath = resolve(process.cwd(), 'data/expanded_resolution_map.json')

  if (!fs.existsSync(resolutionMapPath)) {
    throw new Error(`Resolution map not found at ${resolutionMapPath}`)
  }

  console.log('📂 Loading resolution map...')
  const resolutionMapContent = fs.readFileSync(resolutionMapPath, 'utf-8')
  const resolutionMap: ResolutionMapFile = JSON.parse(resolutionMapContent)

  console.log(`   ✅ Loaded ${resolutionMap.resolutions.length} resolutions`)
  console.log(`   ✅ Resolved conditions: ${resolutionMap.resolved_conditions}`)
  console.log(`   ✅ Last updated: ${resolutionMap.last_updated}\n`)

  // Validate minimum threshold
  const MIN_RESOLUTION_THRESHOLD = 3000
  if (resolutionMap.resolved_conditions < MIN_RESOLUTION_THRESHOLD) {
    console.warn(`⚠️  Warning: Resolution count (${resolutionMap.resolved_conditions}) is below expected threshold (${MIN_RESOLUTION_THRESHOLD})`)
  }

  // Check if condition_market_map table exists
  console.log('🔍 Checking if condition_market_map table exists...')
  const tableCheckQuery = `
    SELECT count() as cnt
    FROM system.tables
    WHERE database = currentDatabase()
      AND name = 'condition_market_map'
  `
  const tableCheckResult = await clickhouse.query({
    query: tableCheckQuery,
    format: 'JSONEachRow',
    request_timeout: 30000
  })
  const tableCheck = await tableCheckResult.json<{ cnt: string }>()

  if (parseInt(tableCheck[0].cnt) === 0) {
    console.log('   Creating condition_market_map table...')
    await clickhouse.command({
      query: `
        CREATE TABLE condition_market_map (
          condition_id String,
          market_id String,
          ingested_at DateTime DEFAULT now()
        ) ENGINE = ReplacingMergeTree()
        ORDER BY (condition_id)
      `,
      request_timeout: 30000
    })
    console.log('   ✅ Table created')
  } else {
    console.log('   ✅ Table exists')
  }

  // Build mapping entries
  console.log('\n📥 Building condition→market mappings...')
  const mappings = resolutionMap.resolutions
    .filter(res => res.condition_id && res.market_id)
    .map(res => ({
      condition_id: res.condition_id,
      market_id: res.market_id,
      ingested_at: Math.floor(Date.now() / 1000)
    }))

  console.log(`   ✅ Built ${mappings.length} mappings`)

  // Insert in batches
  console.log('\n📤 Inserting into condition_market_map...')
  const batchSize = 1000
  let inserted = 0
  let failed = 0

  for (let i = 0; i < mappings.length; i += batchSize) {
    const batch = mappings.slice(i, i + batchSize)

    try {
      await clickhouse.insert({
        table: 'condition_market_map',
        values: batch,
        format: 'JSONEachRow',
      })
      inserted += batch.length

      if ((i + batchSize) % 10000 === 0) {
        console.log(`   Progress: ${inserted.toLocaleString()} / ${mappings.length.toLocaleString()}`)
      }
    } catch (error) {
      console.warn(`   ⚠️  Failed to insert batch at offset ${i}:`, error instanceof Error ? error.message : error)
      failed += batch.length
    }
  }

  console.log(`   ✅ Inserted ${inserted.toLocaleString()} mappings`)
  if (failed > 0) {
    console.log(`   ⚠️  Failed: ${failed} mappings`)
  }

  // Verify
  console.log('\n📊 Verifying condition_market_map...')
  const countResult = await clickhouse.query({
    query: 'SELECT count() as total FROM condition_market_map',
    format: 'JSONEachRow',
    request_timeout: 30000
  })
  const count = await countResult.json<{ total: string }>()
  console.log(`   Total mappings in table: ${parseInt(count[0].total).toLocaleString()}`)

  // Check for any failed lookups
  const failedLookupsQuery = `
    SELECT count() as failed
    FROM trades_raw t
    LEFT JOIN condition_market_map m ON t.condition_id = m.condition_id
    WHERE t.condition_id != '' AND m.condition_id IS NULL
  `
  const failedResult = await clickhouse.query({
    query: failedLookupsQuery,
    format: 'JSONEachRow',
    request_timeout: 300000
  })
  const failedLookups = await failedResult.json<{ failed: string }>()
  console.log(`   Trades with unmapped conditions: ${parseInt(failedLookups[0].failed).toLocaleString()}`)

  if (parseInt(failedLookups[0].failed) > 0) {
    console.log(`   ⚠️  Some conditions could not be mapped (this is OK if they're in unresolved markets)`)
  }

  console.log('\n✅ Task 0.2 complete!')

  process.exit(0)
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
