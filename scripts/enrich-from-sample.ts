#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('🔧 Using condition_market_map_sample.jsonl to enrich ClickHouse\n')

  // Load the sample JSONL with real Polymarket data
  const samplePath = resolve(process.cwd(), 'data/condition_market_map_sample.jsonl')
  const lines = fs.readFileSync(samplePath, 'utf-8').split('\n').filter(l => l.trim())
  const sampleEntries = lines.map(line => JSON.parse(line))

  console.log(`Loaded ${sampleEntries.length} enriched condition mappings from sample\n`)

  // Show first 5
  console.log('=== Sample 5 enriched entries ===\n')
  for (let i = 0; i < Math.min(5, sampleEntries.length); i++) {
    const entry = sampleEntries[i]
    console.log(`${entry.condition_id}:`)
    console.log(`  market_id: ${entry.market_id}`)
    console.log(`  event_id: ${entry.event_id}`)
    console.log(`  canonical_category: ${entry.canonical_category}`)
    console.log(`  question: ${entry.question}`)
    console.log('')
  }

  // Apply to ClickHouse in batches
  console.log('🔄 Applying enrichment to ClickHouse condition_market_map...\n')

  let updatedCount = 0
  const batchSize = 50

  for (let i = 0; i < sampleEntries.length; i += batchSize) {
    const batch = sampleEntries.slice(i, i + batchSize)

    const eventIdCases: string[] = []
    const categoryCases: string[] = []
    const tagsCases: string[] = []

    for (const entry of batch) {
      if (entry.event_id) {
        eventIdCases.push(`WHEN condition_id = '${entry.condition_id}' THEN '${entry.event_id}'`)
      }

      const category = entry.canonical_category || 'Uncategorized'
      categoryCases.push(`WHEN condition_id = '${entry.condition_id}' THEN '${category.replace(/'/g, "''")}'`)

      const rawTags = entry.raw_tags || []
      const tagsArray = rawTags.map((t: string) => `'${t.replace(/'/g, "''")}'`).join(', ')
      tagsCases.push(`WHEN condition_id = '${entry.condition_id}' THEN [${tagsArray}]`)
    }

    const conditionIdList = batch.map(e => `'${e.condition_id}'`).join(', ')

    const updateQuery = `
      ALTER TABLE condition_market_map
      UPDATE
        event_id = CASE
          ${eventIdCases.join('\n          ')}
          ELSE event_id
        END,
        canonical_category = CASE
          ${categoryCases.join('\n          ')}
          ELSE canonical_category
        END,
        raw_tags = CASE
          ${tagsCases.join('\n          ')}
          ELSE raw_tags
        END
      WHERE condition_id IN (${conditionIdList})
    `

    try {
      await clickhouse.command({ query: updateQuery })
      updatedCount += batch.length
      process.stdout.write(`   Updated ${updatedCount} / ${sampleEntries.length} conditions\r`)
    } catch (error: any) {
      console.error(`\n   Error updating batch:`, error.message)
    }
  }

  console.log(`\n   ✅ Enrichment applied to ${updatedCount} conditions\n`)

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
          AND table = 'condition_market_map'
          AND database = currentDatabase()
      `,
      format: 'JSONEachRow'
    })

    const mutationsData = (await mutationsResult.json()) as Array<{
      pending_mutations: string
    }>
    const pendingMutations = parseInt(mutationsData[0].pending_mutations)

    if (pendingMutations === 0) {
      mutationsComplete = true
      console.log('   ✅ All mutations completed!\n')
    } else {
      process.stdout.write(`   ⏳ Waiting... (${pendingMutations} mutations pending)\r`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      retries++
    }
  }

  // Verify enrichment
  console.log('=== Verification: Sample enriched rows from ClickHouse ===\n')

  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        market_id,
        event_id,
        canonical_category,
        raw_tags
      FROM condition_market_map
      WHERE event_id != '' AND event_id != '4690'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })

  const verifyRows = await verifyResult.json() as any[]
  console.log(JSON.stringify(verifyRows, null, 2))
}

main()
