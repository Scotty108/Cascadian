import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'
import crypto from 'crypto'

/**
 * CLOB API WORKER - ULTRA-FAST VERSION
 *
 * Fetches and inserts immediately in small batches (100 rows at a time)
 * to avoid timeout and memory issues
 */

const CLOB_API_KEY = process.env.CLOB_API_KEY || ''
const CLOB_API_SECRET = process.env.CLOB_API_SECRET || ''
const CLOB_API_PASSPHRASE = process.env.CLOB_API_PASSPHRASE || ''

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
        await new Promise(r => setTimeout(r, 500))
        return fetchFromClobAPI(path, method)
      }
      throw new Error(`CLOB API error: ${response.status}`)
    }

    return await response.json()
  } catch (e) {
    throw new Error(`CLOB fetch failed: ${(e as any).message}`)
  }
}

async function insertBatch(rows: Array<[string, string, string, boolean, string]>) {
  if (rows.length === 0) return

  const values = rows
    .map(([mid, cid, slug, active, q]) =>
      `('${mid}', '${cid}', '${slug.replace(/'/g, "''")}', ${active ? 1 : 0}, '${q.replace(/'/g, "''")}')`
    )
    .join(',')

  await clickhouse.query({
    query: `INSERT INTO clob_market_mapping (market_id, condition_id, market_slug, active, question) VALUES ${values}`
  })
}

async function runClobWorkerUltraFast() {
  try {
    console.log('═'.repeat(70))
    console.log('⚡ CLOB API WORKER - ULTRA-FAST VERSION')
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

    // Step 2: Fetch and insert immediately
    console.log('Step 2: Fetching and inserting markets (streaming mode)...')
    console.log(`  Strategy: Insert 100 rows at a time immediately after fetch`)
    console.log()

    let offset = 0
    let totalFetched = 0
    let totalInserted = 0
    let hasMore = true
    let batchNum = 0
    const insertBatchSize = 100

    while (hasMore && batchNum < 500) {
      const path = `/markets?offset=${offset}&limit=1000`

      process.stdout.write(`  Batch ${batchNum + 1} (offset ${offset}): `)

      try {
        const response = await fetchFromClobAPI(path)
        const markets = response.data || []

        if (!markets || markets.length === 0) {
          console.log('Done (no more markets)')
          hasMore = false
          break
        }

        // Process markets and insert in small chunks
        const rowsToInsert: Array<[string, string, string, boolean, string]> = []

        for (const market of markets) {
          if (market.fpmm && market.condition_id) {
            rowsToInsert.push([
              market.fpmm,
              market.condition_id.toLowerCase(),
              market.market_slug || '',
              market.active !== false,
              market.question || ''
            ])

            // Insert immediately when batch size reached
            if (rowsToInsert.length >= insertBatchSize) {
              await insertBatch(rowsToInsert)
              totalInserted += rowsToInsert.length
              rowsToInsert.length = 0
            }
          }
        }

        // Insert any remaining rows
        if (rowsToInsert.length > 0) {
          await insertBatch(rowsToInsert)
          totalInserted += rowsToInsert.length
        }

        totalFetched += markets.length
        console.log(`✓ ${markets.length} markets fetched & inserted (total: ${totalFetched}, inserted: ${totalInserted})`)

        // Check for next page
        if (response.next_cursor) {
          offset += markets.length
          batchNum++
        } else {
          hasMore = false
        }

      } catch (e: any) {
        console.log(`⚠️  Error: ${(e as any).message.substring(0, 60)}`)
        hasMore = false
      }
    }

    console.log()
    console.log(`✓ Total fetched: ${totalFetched.toLocaleString()}`)
    console.log(`✓ Total inserted: ${totalInserted.toLocaleString()}`)
    console.log()

    // Step 3: Verify
    console.log('Step 3: Verification')

    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(DISTINCT market_id) as cnt FROM clob_market_mapping'
    })

    const count = parseInt(JSON.parse(await countResult.text()).data[0].cnt)

    console.log(`✓ Unique market_id mappings: ${count.toLocaleString()}`)
    console.log()

    // Step 4: Test enrichment
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
    console.log(`Estimated enrichment: +${enrichRate}%`)
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
runClobWorkerUltraFast().then(result => {
  console.log('\nWorker Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
