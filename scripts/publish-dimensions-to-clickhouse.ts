#!/usr/bin/env tsx
/**
 * Publish Dimensions to ClickHouse
 *
 * Reads data/markets_dim_seed.json and data/events_dim_seed.json
 * (which include canonical category mappings from Polymarket tags)
 * and publishes them to ClickHouse dimension tables.
 *
 * This moves dimension data into ClickHouse so analytics queries
 * don't depend on local JSON files.
 *
 * IDEMPOTENT: Safe to run multiple times (upserts via ReplacingMergeTree)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'
import { getCanonicalCategoryForEvent } from '@/lib/category/canonical-category'

interface MarketDimSource {
  condition_id: string
  market_id: string
  event_id: string | null
  question: string
}

interface EventDimSource {
  event_id: string
  category: string | null
  tags: Array<{ label: string }>
  title: string
}

async function main() {
  console.log('🚀 Publish Dimensions to ClickHouse')
  console.log('====================================\n')

  // ============================================================================
  // 1. Load dimension files
  // ============================================================================

  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')

  if (!fs.existsSync(marketsPath)) {
    console.error('❌ Error: data/markets_dim_seed.json not found')
    console.error('   Run scripts/build-dimension-tables.ts first.')
    process.exit(1)
  }

  if (!fs.existsSync(eventsPath)) {
    console.error('❌ Error: data/events_dim_seed.json not found')
    console.error('   Run scripts/build-dimension-tables.ts first.')
    process.exit(1)
  }

  console.log('📂 Loading dimension files...')
  const markets: MarketDimSource[] = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
  const events: EventDimSource[] = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))

  console.log(`   ✅ Loaded ${markets.length.toLocaleString()} markets`)
  console.log(`   ✅ Loaded ${events.length.toLocaleString()} events\n`)

  // ============================================================================
  // 2. Transform and insert events_dim
  // ============================================================================

  console.log('📥 Inserting into events_dim...')

  const eventsInsertValues = events.map((event) => {
    // Apply canonical category mapping
    const canonicalResult = getCanonicalCategoryForEvent({
      category: event.category,
      tags: event.tags || [],
    })

    return {
      event_id: event.event_id,
      canonical_category: canonicalResult.canonical_category,
      raw_tags: canonicalResult.raw_tags,
      title: event.title || '',
      ingested_at: Math.floor(Date.now() / 1000),
    }
  })

  // Insert in batches
  const batchSize = 1000
  for (let i = 0; i < eventsInsertValues.length; i += batchSize) {
    const batch = eventsInsertValues.slice(i, i + batchSize)
    await clickhouse.insert({
      table: 'events_dim',
      values: batch,
      format: 'JSONEachRow',
    })

    if ((i + batchSize) % 10000 === 0) {
      console.log(
        `   ✅ Inserted ${Math.min(i + batchSize, eventsInsertValues.length).toLocaleString()} / ${eventsInsertValues.length.toLocaleString()}`
      )
    }
  }

  console.log(`   ✅ Inserted ${eventsInsertValues.length.toLocaleString()} events\n`)

  // ============================================================================
  // 3. Transform and insert markets_dim
  // ============================================================================

  console.log('📥 Inserting into markets_dim...')

  const marketsInsertValues = markets.map((market) => ({
    market_id: market.market_id,
    question: market.question || '',
    event_id: market.event_id || '',
    ingested_at: Math.floor(Date.now() / 1000),
  }))

  for (let i = 0; i < marketsInsertValues.length; i += batchSize) {
    const batch = marketsInsertValues.slice(i, i + batchSize)
    await clickhouse.insert({
      table: 'markets_dim',
      values: batch,
      format: 'JSONEachRow',
    })

    if ((i + batchSize) % 10000 === 0) {
      console.log(
        `   ✅ Inserted ${Math.min(i + batchSize, marketsInsertValues.length).toLocaleString()} / ${marketsInsertValues.length.toLocaleString()}`
      )
    }
  }

  console.log(`   ✅ Inserted ${marketsInsertValues.length.toLocaleString()} markets\n`)

  // ============================================================================
  // 4. Verify and report stats
  // ============================================================================

  console.log('📊 Verifying dimension tables...')

  // Check events_dim
  const eventsCountResult = await clickhouse.query({
    query: 'SELECT count() as total FROM events_dim',
    format: 'JSONEachRow',
  })
  const eventsCount = (await eventsCountResult.json()) as Array<{ total: string }>

  // Check unique categories
  const categoriesResult = await clickhouse.query({
    query: `
      SELECT DISTINCT canonical_category
      FROM events_dim
      ORDER BY canonical_category
    `,
    format: 'JSONEachRow',
  })
  const categories = (await categoriesResult.json()) as Array<{
    canonical_category: string
  }>

  // Check markets_dim
  const marketsCountResult = await clickhouse.query({
    query: 'SELECT count() as total FROM markets_dim',
    format: 'JSONEachRow',
  })
  const marketsCount = (await marketsCountResult.json()) as Array<{ total: string }>

  console.log(`   Events in events_dim: ${parseInt(eventsCount[0].total).toLocaleString()}`)
  console.log(`   Markets in markets_dim: ${parseInt(marketsCount[0].total).toLocaleString()}`)
  console.log(`   Unique canonical categories: ${categories.length}`)
  console.log('')
  console.log('   Categories:')
  categories.forEach((cat) => {
    console.log(`     - ${cat.canonical_category}`)
  })

  // ============================================================================
  // 5. Summary
  // ============================================================================

  console.log('\n📋 DIMENSION PUBLISH SUMMARY')
  console.log('============================')
  console.log(`   ✅ events_dim: ${parseInt(eventsCount[0].total).toLocaleString()} rows`)
  console.log(`   ✅ markets_dim: ${parseInt(marketsCount[0].total).toLocaleString()} rows`)
  console.log(`   ✅ Canonical categories: ${categories.length}`)
  console.log('')
  console.log('✨ Dimensions published successfully!')
  console.log('   Analytics queries can now join directly to ClickHouse dimension tables.')
}

main()
  .catch((error) => {
    console.error('\n💥 Fatal error:', error)
    process.exit(1)
  })
