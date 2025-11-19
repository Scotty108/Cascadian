import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * THEGRAPH SUBGRAPH WORKER - Archived Markets
 *
 * Queries The Graph's Polymarket subgraph to get ALL markets ever created
 * (including resolved, archived, and delisted ones)
 * This complements CLOB data to achieve 95%+ coverage
 *
 * Expected coverage: 10-15% additional markets (historical/archived)
 * Time to complete: ~30-45 minutes
 */

const THEGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/protofire/polymarket'

interface Market {
  id: string
  conditionId: string
  question?: string
}

async function querySubgraph(skip: number = 0, first: number = 1000): Promise<Market[]> {
  const query = `
    query {
      markets(skip: ${skip}, first: ${first}, orderBy: id) {
        id
        conditionId
        question
      }
    }
  `

  try {
    const response = await fetch(THEGRAPH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    })

    if (!response.ok) {
      throw new Error(`Subgraph error: ${response.status}`)
    }

    const data = await response.json()

    if (data.errors) {
      throw new Error(`GraphQL error: ${data.errors[0].message}`)
    }

    return data.data.markets || []
  } catch (e) {
    throw new Error(`Subgraph query failed: ${(e as any).message}`)
  }
}

async function insertBatch(rows: Array<[string, string, string]>) {
  if (rows.length === 0) return

  const values = rows
    .map(([mid, cid, q]) =>
      `('${mid}', '${cid}', '${q.replace(/'/g, "''")}')`
    )
    .join(',')

  await clickhouse.query({
    query: `INSERT INTO thegraph_market_mapping (market_id, condition_id, question) VALUES ${values}`
  })
}

async function runTheGraphWorker() {
  try {
    console.log('═'.repeat(70))
    console.log('🌐 THEGRAPH SUBGRAPH WORKER - Historical Markets')
    console.log('═'.repeat(70))
    console.log()

    // Step 1: Create table
    console.log('Step 1: Creating TheGraph market mapping table...')

    try {
      await clickhouse.query({ query: 'DROP TABLE IF EXISTS thegraph_market_mapping' })
    } catch (e) {}

    await clickhouse.query({
      query: `
CREATE TABLE thegraph_market_mapping (
  market_id String,
  condition_id String,
  question String,
  source_timestamp DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY market_id
      `
    })

    console.log('✓ Table created')
    console.log()

    // Step 2: Query subgraph with pagination
    console.log('Step 2: Fetching all markets from TheGraph subgraph...')
    console.log(`  URL: ${THEGRAPH_URL}`)
    console.log(`  Strategy: Paginate by 1000, insert immediately`)
    console.log()

    let skip = 0
    let totalFetched = 0
    let totalInserted = 0
    let batchNum = 0
    const insertBatchSize = 500
    let hasMore = true

    while (hasMore) {
      process.stdout.write(`  Batch ${batchNum + 1} (skip ${skip}): `)

      try {
        const markets = await querySubgraph(skip, 1000)

        if (!markets || markets.length === 0) {
          console.log('Done (no more markets)')
          hasMore = false
          break
        }

        const rowsToInsert: Array<[string, string, string]> = []

        for (const market of markets) {
          if (market.id && market.conditionId) {
            rowsToInsert.push([
              market.id,                                    // market_id (FPMM address)
              market.conditionId.toLowerCase(),             // condition_id (normalized)
              market.question || ''                         // question text
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
        console.log(`✓ ${markets.length} markets (total: ${totalFetched}, inserted: ${totalInserted})`)

        skip += 1000
        batchNum++

        // Safety: stop after 500 batches (500K markets) to avoid infinite loops
        if (batchNum >= 500) {
          console.log('Reached batch limit (500), stopping')
          hasMore = false
        }

      } catch (e: any) {
        console.log(`⚠️  Error: ${(e as any).message.substring(0, 60)}`)
        hasMore = false
      }

      // Rate limiting: be nice to The Graph
      if (hasMore) {
        await new Promise(r => setTimeout(r, 100))
      }
    }

    console.log()
    console.log(`✓ Total fetched: ${totalFetched.toLocaleString()}`)
    console.log(`✓ Total inserted: ${totalInserted.toLocaleString()}`)
    console.log()

    // Step 3: Verify
    console.log('Step 3: Verification')

    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(DISTINCT market_id) as cnt FROM thegraph_market_mapping'
    })

    const count = parseInt(JSON.parse(await countResult.text()).data[0].cnt)

    console.log(`✓ Unique market_id mappings: ${count.toLocaleString()}`)
    console.log()

    // Step 4: Test coverage
    console.log('Step 4: Testing enrichment potential (on missing trades)...')

    const testResult = await clickhouse.query({
      query: `
SELECT
  COUNT(DISTINCT market_id) as unique_markets,
  COUNT(CASE WHEN t.condition_id IS NOT NULL THEN 1 END) as can_enrich_rows
FROM (
  SELECT DISTINCT market_id FROM trades_raw
  WHERE condition_id = '' OR condition_id IS NULL
  LIMIT 1000000
) tr
LEFT JOIN thegraph_market_mapping t ON tr.market_id = t.market_id
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
    console.log('✅ THEGRAPH WORKER COMPLETE')
    console.log('═'.repeat(70))
    console.log(`Result: ${count.toLocaleString()} markets with condition_ids`)
    console.log(`Estimated additional enrichment: +${enrichRate}%`)
    console.log()

    return {
      success: true,
      marketsFound: count,
      estimatedCoverage: enrichRate,
      timestamp: new Date().toISOString()
    }

  } catch (e: any) {
    console.error('❌ THEGRAPH WORKER ERROR:', e.message.substring(0, 200))
    return {
      success: false,
      error: e.message,
      timestamp: new Date().toISOString()
    }
  }
}

// Run worker
runTheGraphWorker().then(result => {
  console.log('\nWorker Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
