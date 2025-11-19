import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'
import crypto from 'crypto'

/**
 * CLOB API WORKER
 *
 * Fetches complete market metadata and condition IDs from Polymarket CLOB API
 * Expected coverage: 85-90% of missing markets
 * Time to complete: ~2-3 hours
 */

// CLOB API credentials from .env
const CLOB_API_KEY = process.env.CLOB_API_KEY || ''
const CLOB_API_SECRET = process.env.CLOB_API_SECRET || ''
const CLOB_API_PASSPHRASE = process.env.CLOB_API_PASSPHRASE || ''

// Helper to create CLOB API signature
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
      throw new Error(`CLOB API error: ${response.status}`)
    }

    return await response.json()
  } catch (e) {
    throw new Error(`CLOB fetch failed: ${(e as any).message}`)
  }
}

async function runClobWorker() {
  try {
    console.log('═'.repeat(70))
    console.log('🔄 CLOB API WORKER - Starting Data Pull')
    console.log('═'.repeat(70))
    console.log()

    // Step 1: Create intermediate mapping table
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

    // Step 2: Fetch all markets from CLOB API
    console.log('Step 2: Fetching markets from CLOB API...')
    console.log('  Note: CLOB API has 100 req/s limit, pagination by offset')
    console.log()

    let offset = 0
    let totalFetched = 0
    let batchCount = 0
    const pageSize = 100
    const maxFetches = 2000 // ~200K markets should cover most cases
    let hasMore = true
    let mappingsToInsert: Array<[string, string, string, boolean, string]> = []
    const batchInsertSize = 1000

    while (hasMore && batchCount < maxFetches) {
      const path = `/markets?offset=${offset}&limit=${pageSize}`

      process.stdout.write(`  Batch ${batchCount + 1}: offset ${offset}...`)

      try {
        const data = await fetchFromClobAPI(path)
        const markets = Array.isArray(data) ? data : data.data || []

        if (markets.length === 0) {
          console.log(' Done (no more markets)')
          hasMore = false
          break
        }

        // Extract market_id and condition_id pairs
        for (const market of markets) {
          if (market.conditionId && market.id) {
            // Normalize condition_id: strip 0x prefix, lowercase
            const conditionId = market.conditionId.startsWith('0x')
              ? market.conditionId.substring(2)
              : market.conditionId

            mappingsToInsert.push([
              market.id,
              conditionId.toLowerCase(),
              market.slug || '',
              market.active !== false,
              market.question || ''
            ])

            // Batch insert when we have enough
            if (mappingsToInsert.length >= batchInsertSize) {
              const values = mappingsToInsert
                .map(([mid, cid, slug, active, q]) =>
                  `('${mid}', '${cid}', '${slug}', ${active ? 1 : 0}, '${q.replace(/'/g, "''")}')`
                )
                .join(',')

              await clickhouse.query({
                query: `INSERT INTO clob_market_mapping (market_id, condition_id, market_slug, active, question) VALUES ${values}`
              })

              mappingsToInsert = []
            }
          }
        }

        totalFetched += markets.length
        console.log(` ✓ (${markets.length} markets, total: ${totalFetched})`)

        offset += pageSize
        batchCount++
      } catch (e: any) {
        console.log(` ✗`)
        const msg = (e as any).message
        if (msg.includes('429') || msg.includes('rate')) {
          console.log('    Rate limited, waiting 5s...')
          await new Promise(r => setTimeout(r, 5000))
          // Don't increment batchCount on rate limit, retry same batch
        } else {
          console.log(`    Error: ${msg.substring(0, 80)}`)
          offset += pageSize // Skip to next batch
          batchCount++
        }
      }
    }

    // Insert remaining mappings
    if (mappingsToInsert.length > 0) {
      const values = mappingsToInsert
        .map(([mid, cid, slug, active, q]) =>
          `('${mid}', '${cid}', '${slug}', ${active ? 1 : 0}, '${q.replace(/'/g, "''")}')`
        )
        .join(',')

      await clickhouse.query({
        query: `INSERT INTO clob_market_mapping (market_id, condition_id, market_slug, active, question) VALUES ${values}`
      })
    }

    console.log()
    console.log('═'.repeat(70))
    console.log('Step 3: Verification')
    console.log('═'.repeat(70))

    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(DISTINCT market_id) as cnt FROM clob_market_mapping'
    })

    const count = parseInt(JSON.parse(await countResult.text()).data[0].cnt)

    console.log(`Total unique markets from CLOB: ${count.toLocaleString()}`)
    console.log()

    // Step 4: Test coverage on missing trades
    console.log('Step 4: Testing enrichment potential...')

    const testResult = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total_missing,
  COUNT(CASE WHEN c.condition_id IS NOT NULL THEN 1 END) as can_enrich
FROM (
  SELECT DISTINCT market_id FROM trades_raw
  WHERE condition_id = '' OR condition_id IS NULL
  LIMIT 100000
) t
LEFT JOIN clob_market_mapping c ON t.market_id = c.market_id
      `
    })

    const testData = JSON.parse(await testResult.text()).data[0]
    const testMissing = parseInt(testData.total_missing)
    const testEnrichable = parseInt(testData.can_enrich)
    const enrichRate = testMissing > 0 ? ((testEnrichable / testMissing) * 100).toFixed(1) : '0'

    console.log(`  Sample test: ${testMissing} markets tested`)
    console.log(`  Can be enriched: ${testEnrichable} (${enrichRate}%)`)
    console.log()

    console.log('═'.repeat(70))
    console.log('✅ CLOB WORKER COMPLETE')
    console.log('═'.repeat(70))
    console.log(`Result: ${count} markets with condition_ids`)
    console.log(`Estimated coverage improvement: +${enrichRate}%`)
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
runClobWorker().then(result => {
  console.log('\nWorker Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
