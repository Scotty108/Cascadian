#!/usr/bin/env tsx
/**
 * Phase 0 Task 0.4: Denormalize categories/tags to trades_raw
 *
 * Populates canonical_category and raw_tags columns in trades_raw table
 * by joining with markets_dim and events_dim.
 *
 * This enables category-level filtering and analysis without complex joins.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('📍 Phase 0 Task 0.4: Denormalize categories/tags to trades\n')

  // First, check if trades_raw table exists and has the necessary columns
  console.log('🔍 Checking trades_raw table structure...')
  const tableCheckQuery = `
    SELECT name, type
    FROM system.columns
    WHERE database = currentDatabase()
      AND table = 'trades_raw'
      AND name IN ('canonical_category', 'raw_tags')
  `
  const tableCheckResult = await clickhouse.query({
    query: tableCheckQuery,
    format: 'JSONEachRow',
    request_timeout: 30000
  })
  const columns = await tableCheckResult.json<{ name: string, type: string }>()

  console.log(`   Found ${columns.length} category columns in trades_raw`)

  const hasCanonicalCategory = columns.some(c => c.name === 'canonical_category')
  const hasRawTags = columns.some(c => c.name === 'raw_tags')

  // Add missing columns if needed
  if (!hasCanonicalCategory) {
    console.log('   Adding canonical_category column...')
    await clickhouse.command({
      query: `
        ALTER TABLE trades_raw
        ADD COLUMN IF NOT EXISTS canonical_category String DEFAULT 'Uncategorized'
      `,
      request_timeout: 30000
    })
    console.log('   ✅ Added canonical_category column')
  }

  if (!hasRawTags) {
    console.log('   Adding raw_tags column...')
    await clickhouse.command({
      query: `
        ALTER TABLE trades_raw
        ADD COLUMN IF NOT EXISTS raw_tags Array(String) DEFAULT []
      `,
      request_timeout: 30000
    })
    console.log('   ✅ Added raw_tags column')
  }

  // Get count of trades
  console.log('\n📊 Checking trades_raw status...')
  const countResult = await clickhouse.query({
    query: 'SELECT count() as total FROM trades_raw',
    format: 'JSONEachRow',
    request_timeout: 30000
  })
  const countData = await countResult.json<{ total: string }>()
  const totalTrades = parseInt(countData[0].total)

  console.log(`   Total trades in trades_raw: ${totalTrades.toLocaleString()}`)

  // Check how many trades already have categories
  const categorizedResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM trades_raw WHERE canonical_category != 'Uncategorized'`,
    format: 'JSONEachRow',
    request_timeout: 30000
  })
  const categorizedData = await categorizedResult.json<{ cnt: string }>()
  const categorized = parseInt(categorizedData[0].cnt)

  console.log(`   Trades with categories: ${categorized.toLocaleString()} (${(categorized/totalTrades*100).toFixed(2)}%)`)

  // Update categories by creating a dictionary for fast lookups
  console.log('\n📝 Creating category dictionary...')

  // First, create a temp table for the dictionary source
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS market_category_source (
        market_id String,
        canonical_category String,
        raw_tags Array(String)
      ) ENGINE = MergeTree()
      ORDER BY market_id
    `,
    request_timeout: 30000
  })

  // Truncate if exists
  await clickhouse.command({
    query: 'TRUNCATE TABLE IF EXISTS market_category_source',
    request_timeout: 30000
  })

  // Populate the source
  console.log('   Populating category source from dimensions...')
  await clickhouse.command({
    query: `
      INSERT INTO market_category_source
      SELECT
        m.market_id,
        if(e.canonical_category != '', e.canonical_category, 'Uncategorized') as canonical_category,
        e.raw_tags
      FROM markets_dim m
      INNER JOIN events_dim e ON m.event_id = e.event_id
      WHERE e.event_id != ''
    `,
    request_timeout: 60000
  })
  console.log('   ✅ Category source created')

  // Create dictionary
  console.log('   Creating dictionary...')
  await clickhouse.command({
    query: `DROP DICTIONARY IF EXISTS market_category_dict`,
    request_timeout: 30000
  })

  await clickhouse.command({
    query: `
      CREATE DICTIONARY market_category_dict (
        market_id String,
        canonical_category String,
        raw_tags Array(String)
      )
      PRIMARY KEY market_id
      SOURCE(CLICKHOUSE(TABLE 'market_category_source'))
      LAYOUT(HASHED())
      LIFETIME(0)
    `,
    request_timeout: 60000
  })
  console.log('   ✅ Dictionary created')

  // Now update trades_raw using the dictionary
  console.log('\n📝 Updating trades_raw categories using dictionary...')
  console.log('   This may take several minutes for large datasets...\n')

  const updateQuery = `
    ALTER TABLE trades_raw
    UPDATE
      canonical_category = dictGetOrDefault('market_category_dict', 'canonical_category', market_id, 'Uncategorized'),
      raw_tags = dictGetOrDefault('market_category_dict', 'raw_tags', market_id, [])
    WHERE dictHas('market_category_dict', market_id)
  `

  try {
    await clickhouse.command({
      query: updateQuery,
      request_timeout: 600000 // 10 minutes
    })
    console.log('   ✅ UPDATE mutation issued')
  } catch (error) {
    console.error('   ❌ Failed to issue UPDATE:', error instanceof Error ? error.message : error)
    // Clean up
    await clickhouse.command({ query: 'DROP DICTIONARY IF EXISTS market_category_dict' }).catch(() => {})
    await clickhouse.command({ query: 'DROP TABLE IF EXISTS market_category_source' }).catch(() => {})
    throw error
  }

  // Wait for mutations to complete
  console.log('\n⏳ Waiting for mutations to complete...')
  let mutationsPending = true
  let waitSeconds = 0

  while (mutationsPending && waitSeconds < 600) {
    const mutationsResult = await clickhouse.query({
      query: `
        SELECT count() as pending
        FROM system.mutations
        WHERE table = 'trades_raw' AND is_done = 0
      `,
      format: 'JSONEachRow',
      request_timeout: 30000
    })
    const mutationsData = await mutationsResult.json<{ pending: string }>()
    const pending = parseInt(mutationsData[0].pending)

    if (pending === 0) {
      mutationsPending = false
      console.log('   ✅ All mutations complete')
    } else {
      console.log(`   Still ${pending} mutations pending... (${waitSeconds}s elapsed)`)
      await new Promise(resolve => setTimeout(resolve, 5000))
      waitSeconds += 5
    }
  }

  if (mutationsPending) {
    console.warn('   ⚠️  Timeout waiting for mutations (may still be in progress)')
  }

  // Verify results
  console.log('\n📊 Verifying categorization coverage...')
  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(canonical_category != 'Uncategorized') as categorized,
        countIf(length(raw_tags) > 0) as with_tags
      FROM trades_raw
    `,
    format: 'JSONEachRow',
    request_timeout: 30000
  })
  const verifyData = await verifyResult.json<{ total: string, categorized: string, with_tags: string }>()

  const total = parseInt(verifyData[0].total)
  const categorizedAfter = parseInt(verifyData[0].categorized)
  const withTags = parseInt(verifyData[0].with_tags)

  console.log(`   Total trades: ${total.toLocaleString()}`)
  console.log(`   Categorized: ${categorizedAfter.toLocaleString()} (${(categorizedAfter/total*100).toFixed(2)}%)`)
  console.log(`   With tags: ${withTags.toLocaleString()} (${(withTags/total*100).toFixed(2)}%)`)

  // Clean up temporary objects
  console.log('\n🧹 Cleaning up temporary objects...')
  await clickhouse.command({ query: 'DROP DICTIONARY IF EXISTS market_category_dict' }).catch(() => {})
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS market_category_source' }).catch(() => {})
  console.log('   ✅ Cleanup complete')

  console.log('\n✅ Task 0.4 complete!')

  process.exit(0)
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
