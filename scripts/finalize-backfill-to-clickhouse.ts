#!/usr/bin/env tsx
/**
 * Finalize Backfill to ClickHouse
 *
 * Reads the completed market_id_lookup_results.json (from batch resolver)
 * and applies the resolved market_ids to ClickHouse:
 *
 * 1. Upserts condition→market mappings into condition_market_map cache
 * 2. Updates trades_raw rows with resolved market_ids
 * 3. Reports coverage improvement (target: ≥95%)
 *
 * IDEMPOTENT: Safe to run multiple times
 * READ-ONLY P&L: Does not touch realized_pnl_usd calculations
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

interface BackfillResult {
  condition_id: string
  market_id: string | null
  event_id?: string | null
  canonical_category?: string
  raw_tags?: string[]
  success: boolean
}

async function main() {
  console.log('🚀 Finalize Backfill to ClickHouse')
  console.log('===================================\n')

  // ============================================================================
  // 1. Load backfill results
  // ============================================================================

  const backfillPath = resolve(process.cwd(), 'data/market_id_lookup_results.jsonl')

  if (!fs.existsSync(backfillPath)) {
    console.error('❌ Error: data/market_id_lookup_results.jsonl not found')
    console.error('   Run the batch market_id resolver first to generate this file.')
    process.exit(1)
  }

  console.log('📂 Reading backfill results (JSONL format)...')
  const lines = fs.readFileSync(backfillPath, 'utf-8').split('\n').filter((l) => l.trim())
  const backfillResults: BackfillResult[] = lines.map((line) => {
    const parsed = JSON.parse(line)
    return {
      condition_id: parsed.condition_id,
      market_id: parsed.market_id,
      event_id: parsed.event_id || null,
      canonical_category: parsed.canonical_category || 'Uncategorized',
      raw_tags: parsed.raw_tags || [],
      success: !!parsed.market_id,
    }
  })

  const successfulMappings = backfillResults.filter((r) => r.success && r.market_id)
  const failedMappings = backfillResults.filter((r) => !r.success || !r.market_id)

  console.log(`   ✅ Loaded ${backfillResults.length} results`)
  console.log(`   ✅ Successful: ${successfulMappings.length}`)
  console.log(`   ⚠️  Failed: ${failedMappings.length}\n`)

  if (successfulMappings.length === 0) {
    console.log('⚠️  No successful mappings to apply. Exiting.')
    return
  }

  // ============================================================================
  // 2. Check BEFORE coverage
  // ============================================================================

  console.log('📊 Calculating BEFORE coverage...')

  const beforeResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        countIf(market_id != '' AND market_id != 'unknown') as valid_market_id_rows,
        countIf(market_id = '' OR market_id = 'unknown') as missing_market_id_rows
      FROM trades_raw
    `,
    format: 'JSONEachRow',
  })

  const beforeStats = (await beforeResult.json()) as Array<{
    total_rows: string
    valid_market_id_rows: string
    missing_market_id_rows: string
  }>

  const totalRowsBefore = parseInt(beforeStats[0].total_rows)
  const validRowsBefore = parseInt(beforeStats[0].valid_market_id_rows)
  const missingRowsBefore = parseInt(beforeStats[0].missing_market_id_rows)
  const coverageBefore = totalRowsBefore > 0 ? (validRowsBefore / totalRowsBefore) * 100 : 0

  console.log(`   Total rows: ${totalRowsBefore.toLocaleString()}`)
  console.log(`   Valid market_id: ${validRowsBefore.toLocaleString()}`)
  console.log(`   Missing market_id: ${missingRowsBefore.toLocaleString()}`)
  console.log(`   Coverage: ${coverageBefore.toFixed(2)}%\n`)

  // ============================================================================
  // 3. Upsert into condition_market_map
  // ============================================================================

  console.log('📥 Upserting into condition_market_map...')

  const cacheInsertValues = successfulMappings.map((r) => ({
    condition_id: r.condition_id,
    market_id: r.market_id!,
    event_id: r.event_id || '',
    canonical_category: r.canonical_category || 'Uncategorized',
    raw_tags: r.raw_tags || [],
    ingested_at: Math.floor(Date.now() / 1000),
  }))

  // Insert in batches of 1000
  const batchSize = 1000
  for (let i = 0; i < cacheInsertValues.length; i += batchSize) {
    const batch = cacheInsertValues.slice(i, i + batchSize)
    await clickhouse.insert({
      table: 'condition_market_map',
      values: batch,
      format: 'JSONEachRow',
    })

    if ((i + batchSize) % 10000 === 0) {
      console.log(`   ✅ Inserted ${Math.min(i + batchSize, cacheInsertValues.length).toLocaleString()} / ${cacheInsertValues.length.toLocaleString()}`)
    }
  }

  console.log(`   ✅ Upserted ${successfulMappings.length.toLocaleString()} mappings into cache\n`)

  // ============================================================================
  // 4. Update trades_raw with resolved market_ids
  // ============================================================================

  console.log('🔄 Updating trades_raw with resolved market_ids...')
  console.log('   ⚠️  This may take several minutes for large datasets...\n')

  // Apply updates in batches
  let updatedCount = 0
  const updateBatchSize = 500

  for (let i = 0; i < successfulMappings.length; i += updateBatchSize) {
    const batch = successfulMappings.slice(i, i + updateBatchSize)

    // Build a CASE statement for this batch
    const caseStatements = batch
      .map((r) => `WHEN condition_id = '${r.condition_id}' THEN '${r.market_id}'`)
      .join('\n        ')

    const conditionIds = batch.map((r) => `'${r.condition_id}'`).join(', ')

    const updateQuery = `
      ALTER TABLE trades_raw
      UPDATE market_id = CASE
        ${caseStatements}
        ELSE market_id
      END
      WHERE condition_id IN (${conditionIds})
        AND (market_id = '' OR market_id = 'unknown')
    `

    try {
      await clickhouse.command({
        query: updateQuery,
      })

      updatedCount += batch.length

      if ((i + updateBatchSize) % 5000 === 0) {
        console.log(`   ✅ Processed ${Math.min(i + updateBatchSize, successfulMappings.length).toLocaleString()} / ${successfulMappings.length.toLocaleString()}`)
      }
    } catch (error: any) {
      console.error(`   ⚠️  Error updating batch ${i}-${i + updateBatchSize}:`, error.message)
      // Continue with next batch
    }
  }

  console.log(`   ✅ Update commands issued for ${updatedCount.toLocaleString()} condition_ids\n`)

  // ============================================================================
  // 5. Wait for mutations to complete
  // ============================================================================

  console.log('⏳ Waiting for ClickHouse mutations to complete...')
  console.log('   (This ensures UPDATE operations finish before checking coverage)\n')

  let mutationsComplete = false
  let retries = 0
  const maxRetries = 60 // 5 minutes max

  while (!mutationsComplete && retries < maxRetries) {
    const mutationsResult = await clickhouse.query({
      query: `
        SELECT count() as pending_mutations
        FROM system.mutations
        WHERE is_done = 0
          AND table = 'trades_raw'
          AND database = currentDatabase()
      `,
      format: 'JSONEachRow',
    })

    const mutationsData = (await mutationsResult.json()) as Array<{
      pending_mutations: string
    }>
    const pendingMutations = parseInt(mutationsData[0].pending_mutations)

    if (pendingMutations === 0) {
      mutationsComplete = true
      console.log('   ✅ All mutations completed!')
    } else {
      process.stdout.write(`   ⏳ Waiting... (${pendingMutations} mutations pending)\r`)
      await new Promise((resolve) => setTimeout(resolve, 5000))
      retries++
    }
  }

  if (!mutationsComplete) {
    console.log('\n   ⚠️  Mutations still pending after 5 minutes. Coverage report may not reflect final state.')
  }

  console.log('')

  // ============================================================================
  // 6. Check AFTER coverage
  // ============================================================================

  console.log('📊 Calculating AFTER coverage...')

  const afterResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        countIf(market_id != '' AND market_id != 'unknown') as valid_market_id_rows,
        countIf(market_id = '' OR market_id = 'unknown') as missing_market_id_rows
      FROM trades_raw
    `,
    format: 'JSONEachRow',
  })

  const afterStats = (await afterResult.json()) as Array<{
    total_rows: string
    valid_market_id_rows: string
    missing_market_id_rows: string
  }>

  const totalRowsAfter = parseInt(afterStats[0].total_rows)
  const validRowsAfter = parseInt(afterStats[0].valid_market_id_rows)
  const missingRowsAfter = parseInt(afterStats[0].missing_market_id_rows)
  const coverageAfter = totalRowsAfter > 0 ? (validRowsAfter / totalRowsAfter) * 100 : 0

  console.log(`   Total rows: ${totalRowsAfter.toLocaleString()}`)
  console.log(`   Valid market_id: ${validRowsAfter.toLocaleString()}`)
  console.log(`   Missing market_id: ${missingRowsAfter.toLocaleString()}`)
  console.log(`   Coverage: ${coverageAfter.toFixed(2)}%\n`)

  // ============================================================================
  // 7. Summary
  // ============================================================================

  console.log('📋 BACKFILL SUMMARY')
  console.log('===================')
  console.log(`   Coverage BEFORE: ${coverageBefore.toFixed(2)}%`)
  console.log(`   Coverage AFTER:  ${coverageAfter.toFixed(2)}%`)
  console.log(`   Improvement:     +${(coverageAfter - coverageBefore).toFixed(2)}%`)
  console.log(`   Rows fixed:      ${(validRowsAfter - validRowsBefore).toLocaleString()}`)
  console.log('')

  if (coverageAfter >= 95) {
    console.log('✅ SUCCESS: Coverage target (≥95%) achieved!')
  } else {
    console.log(`⚠️  WARNING: Coverage target not yet reached (target: ≥95%, actual: ${coverageAfter.toFixed(2)}%)`)
    console.log(`   Remaining gap: ${missingRowsAfter.toLocaleString()} rows`)
  }

  console.log('\n✨ Backfill finalized successfully!')
}

main()
  .catch((error) => {
    console.error('\n💥 Fatal error:', error)
    process.exit(1)
  })
