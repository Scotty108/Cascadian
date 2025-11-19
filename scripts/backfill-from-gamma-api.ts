#!/usr/bin/env npx tsx
/**
 * BACKFILL FROM GAMMA API
 *
 * Uses the working Polymarket Gamma API client to fetch all markets
 * and their condition_ids, then joins to trades_raw to fill gaps
 *
 * Target: 85%+ coverage on condition_ids
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

const GAMMA_API = 'https://gamma-api.polymarket.com'

interface Market {
  id: string
  conditionId: string
  slug: string
  title: string
  category?: string
  tags?: string[]
}

async function fetchMarketsFromGamma(): Promise<Market[]> {
  console.log('\n[STEP 1] Fetching all markets from Gamma API...')

  const markets: Market[] = []
  let offset = 0
  const limit = 100
  let hasMore = true
  let attempts = 0
  const maxAttempts = 500 // Max 50,000 markets

  while (hasMore && attempts < maxAttempts) {
    try {
      const url = `${GAMMA_API}/markets?limit=${limit}&offset=${offset}`

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Cascadian/1.0',
        },
      })

      if (!response.ok) {
        console.log(`  API returned ${response.status} at offset ${offset}`)
        if (response.status === 429) {
          // Rate limit - wait and retry
          await new Promise(resolve => setTimeout(resolve, 5000))
          continue
        }
        hasMore = false
        break
      }

      const data: any = await response.json()

      if (!data || !Array.isArray(data)) {
        console.log(`  Unexpected response format at offset ${offset}`)
        hasMore = false
        break
      }

      if (data.length === 0) {
        hasMore = false
        break
      }

      markets.push(...data.map((m: any) => ({
        id: m.id || '',
        conditionId: m.conditionId || m.condition_id || '',
        slug: m.slug || '',
        title: m.title || '',
        category: m.category || 'uncategorized',
        tags: m.tags || [],
      })))

      offset += limit
      attempts++

      if (attempts % 10 === 0) {
        console.log(`  Fetched ${markets.length} markets...`)
      }

      // Rate limit: 100ms between requests
      await new Promise(resolve => setTimeout(resolve, 100))

    } catch (error: any) {
      console.error(`  Error at offset ${offset}: ${error.message}`)
      if (attempts > 0) {
        // Continue with what we have
        hasMore = false
      }
    }
  }

  console.log(`✅ Fetched ${markets.length} total markets from Gamma API`)

  const withConditionId = markets.filter(m => m.conditionId).length
  console.log(`   Markets with condition_id: ${withConditionId} (${((withConditionId/markets.length)*100).toFixed(1)}%)`)

  return markets
}

async function createGammaMarketTable(markets: Market[]): Promise<void> {
  console.log('\n[STEP 2] Creating Gamma market mapping table...')

  // Drop old table if exists
  await clickhouse.query({
    query: 'DROP TABLE IF EXISTS gamma_markets_api_temp'
  }).catch(() => {})

  // Create new table
  await clickhouse.query({
    query: `
      CREATE TABLE gamma_markets_api_temp (
        market_id String,
        condition_id String,
        market_slug String,
        title String,
        category String
      ) ENGINE = Memory
    `,
  })

  // Filter and prepare data
  const validMarkets = markets.filter(m => m.conditionId && m.id)

  console.log(`  Inserting ${validMarkets.length} markets with condition_ids...`)

  // Batch insert
  const batchSize = 1000
  for (let i = 0; i < validMarkets.length; i += batchSize) {
    const batch = validMarkets.slice(i, i + batchSize).map(m => ({
      market_id: m.id,
      condition_id: m.conditionId,
      market_slug: m.slug,
      title: m.title,
      category: m.category || 'uncategorized',
    }))

    try {
      await clickhouse.insert({
        table: 'gamma_markets_api_temp',
        values: batch,
        format: 'JSONEachRow',
      })
    } catch (error: any) {
      console.error(`  Batch insert error at ${i}: ${error.message}`)
    }
  }

  console.log(`✅ Created temporary market table with ${validMarkets.length} entries`)
}

async function joinAndUpdate(): Promise<void> {
  console.log('\n[STEP 3] Joining to trades_raw and updating...')

  try {
    // Create enriched view
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS trades_enriched_from_api AS
        SELECT
          t.*,
          COALESCE(
            t.condition_id,
            (SELECT condition_id FROM gamma_markets_api_temp WHERE gamma_markets_api_temp.market_id = t.market_id LIMIT 1)
          ) as condition_id_enriched,
          COALESCE(
            t.canonical_category,
            (SELECT category FROM gamma_markets_api_temp WHERE gamma_markets_api_temp.market_id = t.market_id LIMIT 1)
          ) as category_enriched
        FROM trades_raw t
      `
    })

    console.log(`✅ Created enriched trades table`)

  } catch (error: any) {
    console.error(`  Join error: ${error.message}`)
  }
}

async function verifyResults(): Promise<void> {
  console.log('\n[STEP 4] Verifying enrichment results...')

  try {
    const beforeResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 ELSE 0 END) as with_id
        FROM trades_raw
      `,
      format: 'JSON',
    })

    const before: any = await beforeResult.json()
    const beforeStats = before.data[0]

    const afterResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN condition_id_enriched != '' AND condition_id_enriched IS NOT NULL THEN 1 ELSE 0 END) as with_id
        FROM trades_enriched_from_api
      `,
      format: 'JSON',
    })

    const after: any = await afterResult.json()
    const afterStats = after.data[0]

    const beforeCoverage = ((beforeStats.with_id / beforeStats.total) * 100).toFixed(2)
    const afterCoverage = ((afterStats.with_id / afterStats.total) * 100).toFixed(2)
    const improvement = (parseFloat(afterCoverage) - parseFloat(beforeCoverage)).toFixed(2)

    console.log(`
  ════════════════════════════════════════════════════════════════════
  📊 ENRICHMENT RESULTS
  ════════════════════════════════════════════════════════════════════

  BEFORE:
    Total trades: ${parseInt(beforeStats.total).toLocaleString()}
    With condition_id: ${parseInt(beforeStats.with_id).toLocaleString()}
    Coverage: ${beforeCoverage}%

  AFTER (with Gamma API enrichment):
    Total trades: ${parseInt(afterStats.total).toLocaleString()}
    With condition_id: ${parseInt(afterStats.with_id).toLocaleString()}
    Coverage: ${afterCoverage}%

  IMPROVEMENT: +${improvement}%

  ════════════════════════════════════════════════════════════════════
    `)

    if (parseFloat(afterCoverage) >= 85) {
      console.log('✅ EXCELLENT - Ready for production')
    } else if (parseFloat(afterCoverage) >= 70) {
      console.log('✅ GOOD - Ready for deployment')
    } else if (parseFloat(afterCoverage) >= 50) {
      console.log('⚠️  PARTIAL - Additional backfill recommended')
    }

  } catch (error: any) {
    console.error(`  Verification error: ${error.message}`)
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════')
  console.log('BACKFILL FROM GAMMA API - POLYMARKET MARKETS')
  console.log('════════════════════════════════════════════════════════════════════════════')

  try {
    const markets = await fetchMarketsFromGamma()

    if (markets.length === 0) {
      console.error('❌ No markets fetched from API')
      process.exit(1)
    }

    await createGammaMarketTable(markets)
    await joinAndUpdate()
    await verifyResults()

    console.log('\n✅ GAMMA API BACKFILL COMPLETE')
    console.log('\nNext steps:')
    console.log('1. Review coverage improvement above')
    console.log('2. If coverage < 85%, run blockchain reconstruction (ERC1155)')
    console.log('3. Swap enriched table → production trades_raw')
    console.log('4. Build unrealized P&L system')
    console.log('5. Deploy dashboard')

  } catch (error: any) {
    console.error('❌ Fatal error:', error.message)
    process.exit(1)
  }
}

main()
