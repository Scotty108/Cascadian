#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'
import { getCanonicalCategoryForEvent } from '@/lib/category/canonical-category'

async function main() {
  console.log('🔧 Building enrichment mapping from local seed files\n')

  // Load markets_dim_seed.json
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const markets = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
  console.log(`Loaded ${markets.length} markets from markets_dim_seed.json`)

  // Build condition_id → { market_id, event_id }
  const conditionToMarket = new Map()
  for (const market of markets) {
    if (market.condition_id && market.market_id) {
      conditionToMarket.set(market.condition_id, {
        market_id: market.market_id,
        event_id: market.event_id || ''
      })
    }
  }
  console.log(`Built map: ${conditionToMarket.size} condition_id → market/event\n`)

  // Load events_dim_seed.json
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))
  console.log(`Loaded ${events.length} events from events_dim_seed.json`)

  // Build event_id → { canonical_category, raw_tags }
  const eventToCategory = new Map()
  for (const event of events) {
    if (event.event_id) {
      // Get canonical category using our mapper
      const canonicalResult = getCanonicalCategoryForEvent({
        category: event.category,
        tags: event.tags || []
      })

      eventToCategory.set(event.event_id, {
        canonical_category: canonicalResult.canonical_category,
        raw_tags: canonicalResult.raw_tags
      })
    }
  }
  console.log(`Built map: ${eventToCategory.size} event_id → category/tags\n`)

  // Merge to produce condition_id → full enrichment
  const enrichmentMap = new Map()
  for (const [conditionId, marketData] of conditionToMarket.entries()) {
    const eventId = marketData.event_id

    let canonical_category = 'Uncategorized'
    let raw_tags: string[] = []

    if (eventId && eventToCategory.has(eventId)) {
      const eventData = eventToCategory.get(eventId)
      canonical_category = eventData.canonical_category
      raw_tags = eventData.raw_tags
    }

    enrichmentMap.set(conditionId, {
      market_id: marketData.market_id,
      event_id: eventId,
      canonical_category,
      raw_tags
    })
  }

  console.log(`Merged mapping: ${enrichmentMap.size} condition_ids with full enrichment\n`)

  // Show first 5 entries where canonical_category is NOT "Uncategorized"
  console.log('=== Sample 5 enriched entries (NOT Uncategorized) ===\n')
  let count = 0
  for (const [conditionId, enrichment] of enrichmentMap.entries()) {
    if (enrichment.canonical_category !== 'Uncategorized' && count < 5) {
      console.log(`${conditionId}:`)
      console.log(`  market_id: ${enrichment.market_id}`)
      console.log(`  event_id: ${enrichment.event_id}`)
      console.log(`  canonical_category: ${enrichment.canonical_category}`)
      console.log(`  raw_tags: [${enrichment.raw_tags.join(', ')}]`)
      console.log('')
      count++
    }
  }

  // Now apply to ClickHouse
  console.log('\n🔄 Applying enrichment to ClickHouse condition_market_map...\n')

  let updatedCount = 0
  let batchSize = 100
  const conditionIds = Array.from(enrichmentMap.keys())

  for (let i = 0; i < conditionIds.length; i += batchSize) {
    const batch = conditionIds.slice(i, i + batchSize)

    const caseStatements: string[] = []
    const eventIdCases: string[] = []
    const categoryCases: string[] = []
    const tagsCases: string[] = []

    for (const conditionId of batch) {
      const enrichment = enrichmentMap.get(conditionId)!

      if (enrichment.event_id) {
        eventIdCases.push(`WHEN condition_id = '${conditionId}' THEN '${enrichment.event_id}'`)
      }

      categoryCases.push(`WHEN condition_id = '${conditionId}' THEN '${enrichment.canonical_category.replace(/'/g, "''")}'`)

      const tagsArray = enrichment.raw_tags.map(t => `'${t.replace(/'/g, "''")}'`).join(', ')
      tagsCases.push(`WHEN condition_id = '${conditionId}' THEN [${tagsArray}]`)
    }

    const conditionIdList = batch.map(c => `'${c}'`).join(', ')

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
        AND (event_id = '' OR canonical_category = '')
    `

    try {
      await clickhouse.command({ query: updateQuery })
      updatedCount += batch.length
      process.stdout.write(`   Updated ${updatedCount} / ${conditionIds.length} conditions\r`)
    } catch (error: any) {
      console.error(`   Error updating batch ${i}-${i + batchSize}:`, error.message)
    }
  }

  console.log(`\n   ✅ Enrichment applied to ${updatedCount} conditions\n`)

  // Wait for mutations
  console.log('⏳ Waiting for ClickHouse mutations to complete...\n')

  let mutationsComplete = false
  let retries = 0
  const maxRetries = 60

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
      WHERE event_id != ''
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })

  const verifyRows = await verifyResult.json() as any[]
  console.log(JSON.stringify(verifyRows, null, 2))
}

main()
