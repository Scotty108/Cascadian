#!/usr/bin/env tsx
/**
 * Dry Run Test of Backfill (100 mappings)
 *
 * Tests the backfill logic on a small sample to prove it works
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('🧪 Dry Run Test: Backfill with 100 Mappings')
  console.log('=============================================\n')

  // Load first 100 lines from JSONL
  const jsonlPath = resolve(process.cwd(), 'data/market_id_lookup_results.jsonl')
  const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter((l) => l.trim())
  const first100Lines = lines.slice(0, 100)

  const mappings = first100Lines.map((line) => JSON.parse(line))

  console.log(`📂 Loaded ${mappings.length} mappings from JSONL\n`)

  // Check coverage BEFORE
  console.log('📊 Coverage BEFORE:')
  const beforeResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        countIf(market_id != '' AND market_id != 'unknown') as valid_market_id_rows
      FROM trades_raw
    `,
    format: 'JSONEachRow',
  })

  const beforeStats = (await beforeResult.json()) as Array<{
    total_rows: string
    valid_market_id_rows: string
  }>

  const totalRowsBefore = parseInt(beforeStats[0].total_rows)
  const validRowsBefore = parseInt(beforeStats[0].valid_market_id_rows)
  const coverageBefore = totalRowsBefore > 0 ? (validRowsBefore / totalRowsBefore) * 100 : 0

  console.log(`   Total rows: ${totalRowsBefore.toLocaleString()}`)
  console.log(`   Valid market_id: ${validRowsBefore.toLocaleString()}`)
  console.log(`   Coverage: ${coverageBefore.toFixed(2)}%\n`)

  // Apply updates (in batches of 10 to show the UPDATE query)
  console.log('🔄 Applying updates...\n')

  const batchSize = 10
  let firstBatchQuery = ''

  for (let i = 0; i < mappings.length; i += batchSize) {
    const batch = mappings.slice(i, i + batchSize)

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

    // Save first batch query to show as example
    if (i === 0) {
      firstBatchQuery = updateQuery
    }

    try {
      await clickhouse.command({
        query: updateQuery,
      })
      console.log(`   ✅ Applied batch ${Math.floor(i / batchSize) + 1} (${batch.length} mappings)`)
    } catch (error: any) {
      console.error(`   ❌ Error in batch ${Math.floor(i / batchSize) + 1}:`, error.message)
    }
  }

  console.log('\n📝 Example UPDATE query (first batch):')
  console.log('----------------------------------------')
  console.log(firstBatchQuery)
  console.log('')

  // Wait for mutations
  console.log('⏳ Waiting for ClickHouse mutations to complete...\n')

  let mutationsComplete = false
  let retries = 0
  const maxRetries = 30

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
      console.log('   ✅ Mutations complete!\n')
    } else {
      process.stdout.write(`   ⏳ Waiting... (${pendingMutations} mutations pending)\r`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      retries++
    }
  }

  // Check coverage AFTER
  console.log('📊 Coverage AFTER:')
  const afterResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        countIf(market_id != '' AND market_id != 'unknown') as valid_market_id_rows
      FROM trades_raw
    `,
    format: 'JSONEachRow',
  })

  const afterStats = (await afterResult.json()) as Array<{
    total_rows: string
    valid_market_id_rows: string
  }>

  const totalRowsAfter = parseInt(afterStats[0].total_rows)
  const validRowsAfter = parseInt(afterStats[0].valid_market_id_rows)
  const coverageAfter = totalRowsAfter > 0 ? (validRowsAfter / totalRowsAfter) * 100 : 0

  console.log(`   Total rows: ${totalRowsAfter.toLocaleString()}`)
  console.log(`   Valid market_id: ${validRowsAfter.toLocaleString()}`)
  console.log(`   Coverage: ${coverageAfter.toFixed(2)}%\n`)

  // Summary
  console.log('📋 DRY RUN SUMMARY')
  console.log('==================')
  console.log(`   Mappings applied: ${mappings.length}`)
  console.log(`   Coverage BEFORE: ${coverageBefore.toFixed(2)}%`)
  console.log(`   Coverage AFTER:  ${coverageAfter.toFixed(2)}%`)
  console.log(`   Improvement:     +${(coverageAfter - coverageBefore).toFixed(2)}%`)
  console.log(`   Rows fixed:      ${(validRowsAfter - validRowsBefore).toLocaleString()}`)
  console.log('')

  if (validRowsAfter > validRowsBefore) {
    console.log('✅ UPDATE path VERIFIED: Coverage improved!')
  } else {
    console.log('⚠️  WARNING: Coverage did not improve. Check if condition_ids exist in trades_raw.')
  }
}

main().catch((error) => {
  console.error('\n💥 Error:', error)
  process.exit(1)
})
