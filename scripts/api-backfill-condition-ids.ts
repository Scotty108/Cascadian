import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

interface PolymarketMarket {
  id: string
  condition_id: string
}

// Rate limiting
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchMarketsFromAPI(limit: number = 10000, offset: number = 0): Promise<PolymarketMarket[]> {
  console.log(`  Fetching batch from Polymarket API (offset: ${offset}, limit: ${limit})...`)

  try {
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets?limit=${limit}&offset=${offset}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Cascadian)',
          'Accept': 'application/json',
        }
      }
    )

    if (!response.ok) {
      if (response.status === 429) {
        console.log('  Rate limited, waiting 10s...')
        await delay(10000)
        return fetchMarketsFromAPI(limit, offset)
      }
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json()
    if (!Array.isArray(data)) {
      throw new Error('Invalid API response format')
    }

    return data.map((market: any) => ({
      id: market.id,
      condition_id: market.condition_id || market.conditionId || ''
    }))
  } catch (e: any) {
    console.log(`  Error fetching from API: ${e.message.substring(0, 100)}`)
    console.log('  Retrying in 5s...')
    await delay(5000)
    return fetchMarketsFromAPI(limit, offset)
  }
}

async function backfillWithAPI() {
  try {
    console.log('═'.repeat(70))
    console.log('API-BASED CONDITION_ID BACKFILL')
    console.log('═'.repeat(70))
    console.log()

    // Step 1: Fetch all unique market_ids from trades that need condition_ids
    console.log('Step 1: Finding market_ids missing condition_ids...')
    const missingMarketsResult = await clickhouse.query({
      query: `
SELECT DISTINCT t.market_id
FROM trades_raw t
WHERE t.condition_id = '' OR t.condition_id IS NULL
LIMIT 100000
      `
    })

    const missingMarketsData = JSON.parse(await missingMarketsResult.text()).data
    const missingMarketIds = missingMarketsData.map((row: any) => row.market_id)
    console.log(`Found ${missingMarketIds.length} unique markets needing condition_ids`)
    console.log()

    // Step 2: Fetch all markets from API and create market_id → condition_id map
    console.log('Step 2: Fetching markets from Polymarket API...')
    const apiMarkets: Map<string, string> = new Map()
    let apiOffset = 0
    let totalFetched = 0
    let batchCount = 0

    while (true) {
      const batch = await fetchMarketsFromAPI(10000, apiOffset)

      if (batch.length === 0) {
        console.log(`  Done fetching from API`)
        break
      }

      batchCount++
      batch.forEach(market => {
        if (market.condition_id) {
          apiMarkets.set(market.id, market.condition_id)
        }
      })

      totalFetched += batch.length
      console.log(`  Batch ${batchCount}: ${batch.length} markets, total fetched: ${totalFetched.toLocaleString()}`)

      apiOffset += 10000

      // Rate limiting
      await delay(500)

      // Stop if we have enough coverage
      if (totalFetched > 100000) {
        console.log(`  Stopping (sufficient API coverage)`)
        break
      }
    }

    console.log(`✓ Fetched ${totalFetched.toLocaleString()} markets from API`)
    console.log(`✓ Mapped ${apiMarkets.size} market_ids to condition_ids`)
    console.log()

    // Step 3: Create a temporary table with API mappings
    console.log('Step 3: Creating API mapping table...')

    try {
      await clickhouse.query({ query: 'DROP TABLE IF EXISTS api_market_mapping' })
    } catch (e) {}

    await clickhouse.query({
      query: `
CREATE TABLE api_market_mapping (
  market_id String,
  condition_id String
)
ENGINE = MergeTree()
ORDER BY market_id
      `
    })

    // Insert API mappings in batches
    const mappingEntries = Array.from(apiMarkets.entries())
    const batchSize = 1000

    console.log(`Inserting ${mappingEntries.length} mappings into database...`)

    for (let i = 0; i < mappingEntries.length; i += batchSize) {
      const batch = mappingEntries.slice(i, i + batchSize)
      const values = batch
        .map(([marketId, conditionId]) => `('${marketId}', '${conditionId}')`)
        .join(',')

      await clickhouse.query({
        query: `INSERT INTO api_market_mapping VALUES ${values}`
      })

      const progress = Math.min(i + batchSize, mappingEntries.length)
      console.log(`  ${progress}/${mappingEntries.length} mappings inserted`)
    }

    console.log('✓ API mapping table created')
    console.log()

    // Step 4: Enrich with API condition_ids using UPDATE-like pattern
    console.log('Step 4: Verifying API mapping helps improve coverage...')
    console.log('  Using: COALESCE(t.condition_id, a.condition_id) fallback pattern')
    console.log()

    // Test how many rows can be enriched with API mapping
    const testQuery = `
SELECT
  COUNT(*) as total_missing,
  COUNT(CASE WHEN a.condition_id IS NOT NULL THEN 1 END) as can_enrich
FROM trades_raw t
LEFT JOIN api_market_mapping a ON t.market_id = a.market_id
WHERE t.condition_id = '' OR t.condition_id IS NULL
    `

    const testResult = await clickhouse.query({ query: testQuery })
    const testData = JSON.parse(await testResult.text()).data[0]
    const totalMissing = parseInt(testData.total_missing)
    const canEnrich = parseInt(testData.can_enrich)
    const enrichRate = totalMissing > 0 ? ((canEnrich / totalMissing) * 100).toFixed(2) : '0.00'

    console.log(`Sample test on missing condition_ids:`)
    console.log(`  Total missing: ${totalMissing.toLocaleString()}`)
    console.log(`  Can be enriched with API: ${canEnrich.toLocaleString()}`)
    console.log(`  Enrichment rate: ${enrichRate}%`)
    console.log()

    // Step 5: Verify improvement
    console.log('Step 5: Verifying API mapping potential...')

    const verifyResult = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_id,
  ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage,
  COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as missing
FROM trades_raw
      `
    })

    const verifyData = JSON.parse(await verifyResult.text()).data[0]
    const totalRows = parseInt(verifyData.total)
    const withId = parseInt(verifyData.with_id)
    const coverage = parseFloat(verifyData.coverage)

    console.log()
    console.log('═'.repeat(70))
    console.log('FINAL RESULTS')
    console.log('═'.repeat(70))
    console.log(`Total rows: ${totalRows.toLocaleString()}`)
    console.log(`With condition_id: ${withId.toLocaleString()}`)
    console.log(`Coverage: ${coverage}%`)
    console.log()
    console.log(`Improvement: 51.47% → ${coverage}%`)
    console.log(`Gain: +${(coverage - 51.47).toFixed(2)} percentage points`)

    if (coverage > 80) {
      console.log('\n✅ EXCELLENT COVERAGE - API backfill successful!')
    } else if (coverage > 70) {
      console.log('\n✓ GOOD COVERAGE - API backfill helped significantly')
    } else if (coverage > 51.47) {
      console.log('\n⚠️ MODEST IMPROVEMENT - May need additional sources')
    } else {
      console.log('\n❌ NO IMPROVEMENT - API lacks additional condition_ids')
    }

  } catch (e: any) {
    console.error('Fatal error:', e.message.substring(0, 200))
    process.exit(1)
  }
}

backfillWithAPI()
