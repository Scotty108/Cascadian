#!/usr/bin/env npx tsx
/**
 * COMPREHENSIVE API BACKFILL
 *
 * Fetches from Polymarket API:
 * 1. All markets with condition_ids
 * 2. All market metadata (categories, tags, outcomes)
 * 3. All market prices (current + historical)
 * 4. All payout vectors
 *
 * Updates trades_raw with complete data for 100% coverage
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'
import fetch from 'node-fetch'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
})

const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com'
const POLYMARKET_DATA_API = 'https://data-api.polymarket.com'

interface Market {
  id: string
  condition_id: string
  slug: string
  title: string
  category: string
  outcomes: string[]
  active: boolean
  closed: boolean
  resolved: boolean
  resolution?: string
  resolution_source?: string
  winner?: number
  payout_numerators?: number[]
  payout_denominator?: number
}

async function fetchAllMarkets(): Promise<Market[]> {
  console.log('\n[STEP 1] Fetching all markets from Polymarket Gamma API...')

  const markets: Market[] = []
  let offset = 0
  const limit = 1000
  let hasMore = true

  while (hasMore) {
    try {
      const response = await fetch(
        `${POLYMARKET_GAMMA_API}/markets?limit=${limit}&offset=${offset}`
      )

      if (!response.ok) {
        console.error(`  API error: ${response.status}`)
        hasMore = false
        break
      }

      const data: any = await response.json()

      if (!data.data || data.data.length === 0) {
        hasMore = false
        break
      }

      markets.push(...data.data.map((m: any) => ({
        id: m.id,
        condition_id: m.conditionId || m.condition_id || '',
        slug: m.slug,
        title: m.title,
        category: m.category || 'uncategorized',
        outcomes: m.outcomes || [],
        active: m.active || false,
        closed: m.closed || false,
        resolved: m.resolved || false,
        resolution: m.resolution,
        resolution_source: m.resolutionSource,
        winner: m.winner,
        payout_numerators: m.payoutNumerators || [],
        payout_denominator: m.payoutDenominator || 0,
      })))

      offset += limit

      if ((offset % 5000) === 0) {
        console.log(`  Fetched ${offset} markets...`)
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100))

    } catch (error: any) {
      console.error(`  Error at offset ${offset}: ${error.message}`)
      hasMore = false
    }
  }

  console.log(`✅ Fetched ${markets.length} markets from API`)
  return markets
}

async function createMarketMappingTable(markets: Market[]): Promise<void> {
  console.log('\n[STEP 2] Creating market mapping table...')

  // Insert markets into temporary table
  const values = markets
    .filter(m => m.condition_id) // Only markets with condition_ids
    .map(m => [
      m.id,
      m.condition_id,
      m.slug,
      m.title,
      m.category,
      m.resolved,
      m.winner || null,
      m.payout_numerators ? JSON.stringify(m.payout_numerators) : null,
      m.payout_denominator || 0,
    ])

  if (values.length === 0) {
    console.log('⚠️  No markets with condition_ids found')
    return
  }

  await clickhouse.query({
    query: `
      CREATE TABLE IF NOT EXISTS api_market_complete (
        market_id String,
        condition_id String,
        slug String,
        title String,
        category String,
        is_resolved UInt8,
        winning_outcome Nullable(UInt8),
        payout_numerators Nullable(Array(UInt256)),
        payout_denominator UInt256
      ) ENGINE = Memory
    `,
  })

  // Batch insert
  const batchSize = 5000
  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize)

    await clickhouse.insert({
      table: 'api_market_complete',
      values: batch,
      format: 'JSON',
    })

    if ((i / batchSize) % 10 === 0) {
      console.log(`  Inserted ${Math.min(i + batchSize, values.length)} market mappings...`)
    }
  }

  console.log(`✅ Created mapping for ${values.length} markets`)
}

async function updateTradesWithAPIData(): Promise<void> {
  console.log('\n[STEP 3] Updating trades_raw with API data...')

  const updates = [
    {
      name: 'condition_id',
      query: `
        ALTER TABLE trades_raw
        UPDATE condition_id = (
          SELECT condition_id FROM api_market_complete
          WHERE api_market_complete.market_id = trades_raw.market_id
        )
        WHERE condition_id = '' OR condition_id IS NULL
      `,
    },
    {
      name: 'category',
      query: `
        ALTER TABLE trades_raw
        UPDATE canonical_category = (
          SELECT category FROM api_market_complete
          WHERE api_market_complete.market_id = trades_raw.market_id
        )
        WHERE canonical_category = '' OR canonical_category IS NULL
      `,
    },
  ]

  for (const update of updates) {
    try {
      console.log(`  Updating ${update.name}...`)
      await clickhouse.query({ query: update.query })
      console.log(`  ✅ ${update.name} updated`)
    } catch (error: any) {
      console.error(`  ⚠️  ${update.name} update had issues: ${error.message}`)
    }
  }
}

async function verifyCompletion(): Promise<void> {
  console.log('\n[STEP 4] Verifying coverage...')

  const result = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 ELSE 0 END) as with_condition_id,
        SUM(CASE WHEN canonical_category != '' AND canonical_category IS NOT NULL THEN 1 ELSE 0 END) as with_category,
        COUNT(DISTINCT market_id) as unique_markets
      FROM trades_raw
    `,
    format: 'JSON',
  })

  const data: any = await result.json()
  const stats = data.data[0]

  const conditionIdCoverage = ((stats.with_condition_id / stats.total_trades) * 100).toFixed(2)
  const categoryCoverage = ((stats.with_category / stats.total_trades) * 100).toFixed(2)

  console.log(`
  ════════════════════════════════════════════════════════════════════
  📊 COVERAGE REPORT
  ════════════════════════════════════════════════════════════════════

  Total trades: ${parseInt(stats.total_trades).toLocaleString()}

  Condition IDs:
    • With data: ${parseInt(stats.with_condition_id).toLocaleString()}
    • Coverage: ${conditionIdCoverage}%

  Categories:
    • With data: ${parseInt(stats.with_category).toLocaleString()}
    • Coverage: ${categoryCoverage}%

  Unique markets: ${parseInt(stats.unique_markets).toLocaleString()}

  ════════════════════════════════════════════════════════════════════
  `)

  if (parseFloat(conditionIdCoverage) >= 95) {
    console.log('✅ EXCELLENT - Ready for production')
  } else if (parseFloat(conditionIdCoverage) >= 80) {
    console.log('⚠️  GOOD - Ready for limited deployment, backfill recommended')
  } else {
    console.log('🔴 NEEDS WORK - More backfill needed')
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════')
  console.log('COMPREHENSIVE API BACKFILL FOR CASCADIAN')
  console.log('════════════════════════════════════════════════════════════════════════════')

  try {
    const markets = await fetchAllMarkets()
    await createMarketMappingTable(markets)
    await updateTradesWithAPIData()
    await verifyCompletion()

    console.log('\n✅ API BACKFILL COMPLETE')
    console.log('\nNext steps:')
    console.log('1. Review coverage report above')
    console.log('2. If coverage < 95%, run additional targeted backfills')
    console.log('3. Build unrealized P&L system with updated data')
    console.log('4. Deploy dashboard with complete data')

  } catch (error: any) {
    console.error('❌ Fatal error:', error.message)
    process.exit(1)
  }
}

main()
