import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'
import crypto from 'crypto'

/**
 * OPTIMIZED CLOB API WORKER - Fast Parallel Version
 *
 * Fetches complete market metadata and condition IDs from Polymarket CLOB API
 * Uses concurrent requests to dramatically speed up data pulling
 * Expected coverage: 85-90% of missing markets
 * Time to complete: ~10-15 minutes (vs 2-3 hours sequential)
 */

const CLOB_API_KEY = process.env.CLOB_API_KEY || ''
const CLOB_API_SECRET = process.env.CLOB_API_SECRET || ''
const CLOB_API_PASSPHRASE = process.env.CLOB_API_PASSPHRASE || ''

// Concurrency limits
const CONCURRENT_REQUESTS = 10 // Fetch 10 pages in parallel
const PAGE_SIZE = 1000 // 1K markets per request (max allowed by CLOB)
const TOTAL_MARKETS_TO_FETCH = 150000 // Should cover all active markets

function createClobSignature(timestamp: string, method: string, path: string, body: string = ''): string {
  const message = timestamp + method + path + body
  const hmac = crypto.createHmac('sha256', Buffer.from(CLOB_API_SECRET, 'utf-8'))
  return hmac.update(message).digest('base64')
}

async function fetchFromClobAPI(path: string, method: string = 'GET'): Promise<any> {
  const timestamp = new Date().toISOString()
  const signature = createClobSignature(timestamp, method, path)

  try {
    const response = await fetch(`https://clob.polymarket.com${path}`, {
      method,
      headers: {
        'CLOB-API-KEY': CLOB_API_KEY,
        'CLOB-API-PASSPHRASE': CLOB_API_PASSPHRASE,
        'CLOB-API-TIMESTAMP': timestamp,
        'CLOB-API-SIGNATURE': signature,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited, wait a bit
        await new Promise(r => setTimeout(r, 1000))
        return fetchFromClobAPI(path, method)
      }
      throw new Error(`CLOB API error: ${response.status}`)
    }

    return await response.json()
  } catch (e) {
    throw new Error(`CLOB fetch failed: ${(e as any).message}`)
  }
}

async function runClobWorkerFast() {
  try {
    console.log('═'.repeat(70))
    console.log('🚀 CLOB API WORKER - FAST PARALLEL VERSION')
    console.log('═'.repeat(70))
    console.log()

    // Step 1: Create table
    console.log('Step 1: Creating CLOB market mapping table...')

    try {
      await clickhouse.query({ query: 'DROP TABLE IF EXISTS clob_market_mapping' })
    } catch (e) {}

    await clickhouse.query({
      query: `
CREATE TABLE clob_market_mapping (
  market_id String,
  condition_id String,
  market_slug String,
  active Bool,
  question String,
  source_timestamp DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY market_id
      `
    })

    console.log('✓ Table created')
    console.log()

    // Step 2: Fetch markets in parallel
    console.log('Step 2: Fetching markets from CLOB API (parallel)...')
    console.log(`  Strategy: ${CONCURRENT_REQUESTS} concurrent requests`)
    console.log(`  Page size: ${PAGE_SIZE} markets per request`)
    console.log(`  Total pages: ${Math.ceil(TOTAL_MARKETS_TO_FETCH / PAGE_SIZE)}`)
    console.log()

    let totalFetched = 0
    let totalPages = Math.ceil(TOTAL_MARKETS_TO_FETCH / PAGE_SIZE)
    let allMappings: Array<[string, string, string, boolean, string]> = []
    let pageIndex = 0
    let hasMore = true

    while (hasMore && pageIndex < totalPages) {
      // Create batch of concurrent requests
      const batchSize = Math.min(CONCURRENT_REQUESTS, totalPages - pageIndex)
      const promises = []

      process.stdout.write(`  Fetching pages ${pageIndex + 1}-${pageIndex + batchSize}...`)

      for (let i = 0; i < batchSize; i++) {
        const currentPage = pageIndex + i
        const offset = currentPage * PAGE_SIZE
        const path = `/markets?offset=${offset}&limit=${PAGE_SIZE}`

        promises.push(
          fetchFromClobAPI(path)
            .then(data => ({
              page: currentPage,
              data: Array.isArray(data) ? data : data.data || [],
              error: null
            }))
            .catch(err => ({
              page: currentPage,
              data: [],
              error: err.message
            }))
        )
      }

      // Wait for all requests in batch to complete
      const results = await Promise.all(promises)

      let batchCount = 0
      for (const result of results) {
        if (result.data.length === 0 && result.page > 0) {
          hasMore = false
          continue
        }

        for (const market of result.data) {
          if (market.conditionId && market.id) {
            const conditionId = market.conditionId.startsWith('0x')
              ? market.conditionId.substring(2)
              : market.conditionId

            allMappings.push([
              market.id,
              conditionId.toLowerCase(),
              market.slug || '',
              market.active !== false,
              market.question || ''
            ])

            batchCount++
          }
        }
      }

      totalFetched += batchCount
      pageIndex += batchSize

      // Insert batch periodically
      if (allMappings.length > 0 && (allMappings.length >= 10000 || pageIndex >= totalPages)) {
        const values = allMappings
          .map(([mid, cid, slug, active, q]) =>
            `('${mid}', '${cid}', '${slug}', ${active ? 1 : 0}, '${q.replace(/'/g, "''")}')`
          )
          .join(',')

        await clickhouse.query({
          query: `INSERT INTO clob_market_mapping (market_id, condition_id, market_slug, active, question) VALUES ${values}`
        })

        console.log(` ✓ (${allMappings.length} markets, running total: ${totalFetched})`)

        if (pageIndex < totalPages) {
          process.stdout.write(`  Fetching pages ${pageIndex + 1}-${Math.min(pageIndex + batchSize, totalPages)}...`)
        }

        allMappings = []
      }
    }

    console.log()
    console.log(`✓ Total markets fetched: ${totalFetched.toLocaleString()}`)
    console.log()

    // Step 3: Verify results
    console.log('Step 3: Verification')

    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(DISTINCT market_id) as cnt FROM clob_market_mapping'
    })

    const count = parseInt(JSON.parse(await countResult.text()).data[0].cnt)

    console.log(`✓ Unique market_id mappings: ${count.toLocaleString()}`)
    console.log()

    // Step 4: Test coverage
    console.log('Step 4: Testing enrichment potential...')

    const testResult = await clickhouse.query({
      query: `
SELECT
  COUNT(DISTINCT market_id) as unique_markets,
  COUNT(CASE WHEN c.condition_id IS NOT NULL THEN 1 END) as can_enrich_rows
FROM (
  SELECT DISTINCT market_id FROM trades_raw
  WHERE condition_id = '' OR condition_id IS NULL
  LIMIT 1000000
) t
LEFT JOIN clob_market_mapping c ON t.market_id = c.market_id
      `
    })

    const testData = JSON.parse(await testResult.text()).data[0]
    const testMarkets = parseInt(testData.unique_markets)
    const testEnrichable = parseInt(testData.can_enrich_rows)
    const enrichRate = testMarkets > 0 ? ((testEnrichable / testMarkets) * 100).toFixed(1) : '0'

    console.log(`  Markets tested: ${testMarkets}`)
    console.log(`  Can be enriched: ${testEnrichable} (${enrichRate}%)`)
    console.log()

    console.log('═'.repeat(70))
    console.log('✅ CLOB WORKER COMPLETE')
    console.log('═'.repeat(70))
    console.log(`Result: ${count.toLocaleString()} markets with condition_ids`)
    console.log(`Estimated coverage: +${enrichRate}%`)
    console.log()

    return {
      success: true,
      marketsFound: count,
      estimatedCoverage: enrichRate,
      timestamp: new Date().toISOString()
    }

  } catch (e: any) {
    console.error('❌ CLOB WORKER ERROR:', e.message.substring(0, 200))
    return {
      success: false,
      error: e.message,
      timestamp: new Date().toISOString()
    }
  }
}

// Run worker
runClobWorkerFast().then(result => {
  console.log('\nWorker Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
