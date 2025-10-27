#!/usr/bin/env npx tsx
/**
 * DIMENSION TABLE BUILDER
 *
 * Builds markets_dim and events_dim for category-level P&L analysis
 *
 * Inputs:
 *  - audited_wallet_pnl_extended.json (qualified wallets)
 *  - trades_raw (ClickHouse - for condition_ids)
 *  - Polymarket API (for market/event metadata)
 *
 * Outputs:
 *  - markets_dim_seed.json
 *  - events_dim_seed.json
 *  - markets_dim.sql
 *  - events_dim.sql
 *  - dimension_coverage_report.json
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const API_DELAY_MS = 1200

interface MarketDim {
  condition_id: string
  market_id: string
  event_id: string | null
  question: string | null
  resolved_outcome: 'YES' | 'NO' | null
  payout_yes: number | null
  payout_no: number | null
  resolved_at: string | null
}

interface EventDim {
  event_id: string
  title: string | null
  category: string | null
  tags: string[]
  status: string | null
  ends_at: string | null
}

/**
 * Fetch market metadata from Polymarket API
 */
async function fetchMarketMetadata(marketId: string): Promise<Partial<MarketDim> | null> {
  try {
    const response = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`)
    if (!response.ok) return null

    const data = await response.json()

    // Parse resolution
    let resolved_outcome: 'YES' | 'NO' | null = null
    let payout_yes: number | null = null
    let payout_no: number | null = null
    let resolved_at: string | null = null

    if (data.closed === true && data.outcomePrices) {
      const prices = typeof data.outcomePrices === 'string'
        ? JSON.parse(data.outcomePrices)
        : data.outcomePrices

      if (Array.isArray(prices) && prices.length === 2) {
        const price0 = Number(prices[0])
        const price1 = Number(prices[1])

        if (!isNaN(price0) && !isNaN(price1)) {
          if (price0 === 1 && price1 === 0) {
            resolved_outcome = 'YES'
            payout_yes = 1
            payout_no = 0
          } else if (price0 === 0 && price1 === 1) {
            resolved_outcome = 'NO'
            payout_yes = 0
            payout_no = 1
          }
        }
      }

      if (resolved_outcome && data.endDate) {
        resolved_at = new Date(data.endDate).toISOString()
      }
    }

    return {
      market_id: marketId,
      event_id: data.events?.[0]?.slug || null,
      question: data.question || null,
      resolved_outcome,
      payout_yes,
      payout_no,
      resolved_at
    }
  } catch {
    return null
  }
}

/**
 * Fetch event metadata from Polymarket API
 */
async function fetchEventMetadata(eventSlug: string): Promise<EventDim | null> {
  try {
    const response = await fetch(`https://gamma-api.polymarket.com/events/${eventSlug}`)
    if (!response.ok) return null

    const data = await response.json()

    return {
      event_id: eventSlug,
      title: data.title || null,
      category: data.category || null,
      tags: Array.isArray(data.tags) ? data.tags : [],
      status: data.active !== undefined ? (data.active ? 'active' : 'closed') : null,
      ends_at: data.endDate ? new Date(data.endDate).toISOString() : null
    }
  } catch {
    return null
  }
}

/**
 * Fetch ALL events from Polymarket with pagination
 * This builds a complete conditionId → event mapping
 */
async function fetchAllEvents(): Promise<{
  conditionToEvent: Map<string, { event_id: string, category: string | null, title: string | null }>,
  events: EventDim[]
}> {
  console.log('📊 Fetching ALL events from Polymarket API...\n')

  const conditionToEvent = new Map<string, { event_id: string, category: string | null, title: string | null }>()
  const events: EventDim[] = []

  let offset = 0
  const limit = 100
  let hasMore = true
  let totalFetched = 0

  while (hasMore) {
    try {
      const url = `https://gamma-api.polymarket.com/events?limit=${limit}&offset=${offset}`
      const response = await fetch(url)

      if (!response.ok) {
        console.log(`   ⚠️  Failed to fetch events at offset ${offset}`)
        break
      }

      const data = await response.json()

      if (!Array.isArray(data) || data.length === 0) {
        hasMore = false
        break
      }

      // Process each event and its markets
      for (const event of data) {
        const eventSlug = event.slug || event.ticker || String(event.id)
        const category = event.category || null
        const title = event.title || null

        // Store the event
        events.push({
          event_id: eventSlug,
          title,
          category,
          tags: Array.isArray(event.tags) ? event.tags : [],
          status: event.active !== undefined ? (event.active ? 'active' : 'closed') : null,
          ends_at: event.endDate ? new Date(event.endDate).toISOString() : null
        })

        // Map all markets in this event to the event
        if (Array.isArray(event.markets)) {
          for (const market of event.markets) {
            if (market.conditionId) {
              conditionToEvent.set(market.conditionId.toLowerCase(), {
                event_id: eventSlug,
                category,
                title
              })
            }
          }
        }
      }

      totalFetched += data.length
      console.log(`   Fetched ${totalFetched} events, ${conditionToEvent.size} condition mappings...`)

      offset += limit
      await new Promise(resolve => setTimeout(resolve, 500)) // Gentler rate limiting

      // Safety: stop after 50,000 events (should cover all historical events)
      if (offset > 50000) {
        console.log(`   ⚠️  Reached safety limit of 50,000 events`)
        hasMore = false
      }
    } catch (error) {
      console.log(`   ⚠️  Error fetching events: ${error}`)
      hasMore = false
    }
  }

  console.log(`\n✅ Fetched ${totalFetched} total events`)
  console.log(`✅ Built mapping for ${conditionToEvent.size} conditions\n`)

  return { conditionToEvent, events }
}

async function main() {
  console.log('🏗️  DIMENSION TABLE BUILDER\n')
  console.log('================================================\n')

  // Step 1: Load qualified wallets
  console.log('📊 Step 1: Loading qualified wallets...\n')

  const dataDir = resolve(process.cwd(), 'data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  const walletPnLPath = resolve(dataDir, 'audited_wallet_pnl_extended.json')
  if (!fs.existsSync(walletPnLPath)) {
    throw new Error('data/audited_wallet_pnl_extended.json not found - run batch calculation first')
  }

  const walletPnLs = JSON.parse(fs.readFileSync(walletPnLPath, 'utf-8'))
  const walletAddresses = walletPnLs.map((w: any) => w.wallet_address)

  console.log(`✅ Loaded ${walletAddresses.length} qualified wallets\n`)

  // Step 2: Get all conditions traded by qualified wallets
  console.log('📊 Step 2: Fetching all conditions from qualified wallets...\n')

  const walletsStr = walletAddresses.map((w: string) => `'${w}'`).join(', ')
  const conditionsQuery = `
    SELECT DISTINCT condition_id, market_id
    FROM trades_raw
    WHERE wallet_address IN (${walletsStr})
      AND market_id != ''
      AND market_id != 'unknown'
    ORDER BY condition_id
  `

  const result = await clickhouse.query({ query: conditionsQuery, format: 'JSONEachRow' })
  const conditions = await result.json<{ condition_id: string; market_id: string }>()

  console.log(`✅ Found ${conditions.length} unique conditions\n`)

  // Also get conditions without market_id for coverage report
  const allConditionsQuery = `
    SELECT DISTINCT condition_id
    FROM trades_raw
    WHERE wallet_address IN (${walletsStr})
  `
  const allResult = await clickhouse.query({ query: allConditionsQuery, format: 'JSONEachRow' })
  const allConditions = await allResult.json<{ condition_id: string }>()

  console.log(`   (${allConditions.length} total conditions including those without market_id)\n`)

  // Step 2.5: Fetch ALL events to build condition → event mapping
  const { conditionToEvent, events: eventsDim } = await fetchAllEvents()

  // Step 3: Build markets_dim (enriched with event data from mapping)
  const NUM_WORKERS = 5
  console.log('📊 Step 3: Building markets_dim from Polymarket API...\n')
  console.log(`   Using ${NUM_WORKERS} parallel workers (AGGRESSIVE MODE)`)
  console.log(`   (This will take ~${Math.ceil(conditions.length * API_DELAY_MS / 60000 / NUM_WORKERS)} minutes)\n`)

  const marketsDim: MarketDim[] = []
  const progressLock = { value: 0 }

  // Split conditions into chunks for workers
  const chunkSize = Math.ceil(conditions.length / NUM_WORKERS)
  const chunks = []
  for (let i = 0; i < NUM_WORKERS; i++) {
    chunks.push(conditions.slice(i * chunkSize, (i + 1) * chunkSize))
  }

  // Worker function
  async function worker(conditionChunk: typeof conditions) {
    for (const { condition_id, market_id } of conditionChunk) {
      progressLock.value++
      const currentFetched = progressLock.value

      if (currentFetched % 50 === 0) {
        const currentEnriched = marketsDim.filter(m => m.event_id !== null).length
        console.log(`   Progress: ${currentFetched}/${conditions.length} (${currentEnriched} enriched)`)
      }

      const metadata = await fetchMarketMetadata(market_id)

      // Look up event from the condition → event mapping (built from /events API)
      const eventData = conditionToEvent.get(condition_id.toLowerCase())

      const market: MarketDim = {
        condition_id,
        market_id,
        event_id: eventData?.event_id || null,
        question: metadata?.question || null,
        resolved_outcome: metadata?.resolved_outcome || null,
        payout_yes: metadata?.payout_yes || null,
        payout_no: metadata?.payout_no || null,
        resolved_at: metadata?.resolved_at || null
      }

      marketsDim.push(market)

      await new Promise(resolve => setTimeout(resolve, API_DELAY_MS))
    }
  }

  // Run workers in parallel
  await Promise.all(chunks.map(chunk => worker(chunk)))

  const enriched = marketsDim.filter(m => m.event_id !== null).length
  console.log(`\n✅ Built markets_dim: ${marketsDim.length} markets`)
  console.log(`   ${enriched} have event_id (${((enriched / marketsDim.length) * 100).toFixed(1)}%)\n`)

  // Step 4: Events already built in Step 2.5
  console.log('📊 Step 4: Events summary...\n')
  const eventsEnriched = eventsDim.filter(e => e.category !== null).length
  console.log(`✅ Built events_dim: ${eventsDim.length} events`)
  console.log(`   ${eventsEnriched} have category (${((eventsEnriched / eventsDim.length) * 100).toFixed(1)}%)\n`)

  // Step 5: Write seed files
  console.log('📊 Step 5: Writing seed files...\n')

  // dataDir already defined at top of function
  const marketsSeedPath = resolve(dataDir, 'markets_dim_seed.json')
  fs.writeFileSync(marketsSeedPath, JSON.stringify(marketsDim, null, 2))
  console.log(`✅ Wrote ${marketsSeedPath}`)

  const eventsSeedPath = resolve(dataDir, 'events_dim_seed.json')
  fs.writeFileSync(eventsSeedPath, JSON.stringify(eventsDim, null, 2))
  console.log(`✅ Wrote ${eventsSeedPath}\n`)

  // Step 6: Write SQL DDL
  console.log('📊 Step 6: Writing SQL DDL...\n')

  const marketsDDL = `-- markets_dim: Market dimension table for P&L attribution
CREATE TABLE IF NOT EXISTS markets_dim (
  condition_id String,
  market_id String,
  event_id Nullable(String),
  question Nullable(String),
  resolved_outcome Nullable(String),
  payout_yes Nullable(Float64),
  payout_no Nullable(Float64),
  resolved_at Nullable(DateTime)
) ENGINE = MergeTree()
ORDER BY (condition_id);
`

  const eventsDDL = `-- events_dim: Event dimension table for category-level analysis
CREATE TABLE IF NOT EXISTS events_dim (
  event_id String,
  title Nullable(String),
  category Nullable(String),
  tags Array(String),
  status Nullable(String),
  ends_at Nullable(DateTime)
) ENGINE = MergeTree()
ORDER BY (event_id);
`

  fs.writeFileSync(resolve(dataDir, 'markets_dim.sql'), marketsDDL)
  console.log(`✅ Wrote data/markets_dim.sql`)

  fs.writeFileSync(resolve(dataDir, 'events_dim.sql'), eventsDDL)
  console.log(`✅ Wrote data/events_dim.sql\n`)

  // Step 7: Coverage report
  console.log('📊 Step 7: Generating coverage report...\n')

  const marketsWithEventId = marketsDim.filter(m => m.event_id !== null).length
  const eventsWithCategory = eventsDim.filter(e => e.category !== null).length

  const coverageReport = {
    total_conditions_across_qualified_wallets: allConditions.length,
    conditions_with_valid_market_id: conditions.length,
    conditions_in_markets_dim: marketsDim.length,
    markets_with_event_id: marketsWithEventId,
    unique_events_in_events_dim: eventsDim.length,
    events_with_category: eventsWithCategory,
    coverage_rates: {
      market_id_coverage: `${((conditions.length / allConditions.length) * 100).toFixed(2)}%`,
      event_id_coverage: `${((marketsWithEventId / marketsDim.length) * 100).toFixed(2)}%`,
      category_coverage: `${((eventsWithCategory / eventsDim.length) * 100).toFixed(2)}%`
    }
  }

  const reportPath = resolve(dataDir, 'dimension_coverage_report.json')
  fs.writeFileSync(reportPath, JSON.stringify(coverageReport, null, 2))
  console.log(`✅ Wrote ${reportPath}\n`)

  // Step 8: Summary
  console.log('================================================')
  console.log('📊 COVERAGE SUMMARY')
  console.log('================================================\n')

  console.log(`Total conditions (all qualified wallets): ${allConditions.length.toLocaleString()}`)
  console.log(`  ├─ With valid market_id: ${conditions.length.toLocaleString()} (${coverageReport.coverage_rates.market_id_coverage})`)
  console.log(`  └─ In markets_dim: ${marketsDim.length.toLocaleString()}\n`)

  console.log(`Markets in markets_dim: ${marketsDim.length.toLocaleString()}`)
  console.log(`  ├─ With event_id: ${marketsWithEventId.toLocaleString()} (${coverageReport.coverage_rates.event_id_coverage})`)
  console.log(`  └─ Without event_id: ${(marketsDim.length - marketsWithEventId).toLocaleString()}\n`)

  console.log(`Events in events_dim: ${eventsDim.length.toLocaleString()}`)
  console.log(`  ├─ With category: ${eventsWithCategory.toLocaleString()} (${coverageReport.coverage_rates.category_coverage})`)
  console.log(`  └─ Without category: ${(eventsDim.length - eventsWithCategory).toLocaleString()}\n`)

  console.log('================================================')
  console.log('✅ DIMENSION TABLES COMPLETE')
  console.log('================================================\n')

  console.log('Artifacts generated:')
  console.log('  - markets_dim_seed.json')
  console.log('  - events_dim_seed.json')
  console.log('  - markets_dim.sql')
  console.log('  - events_dim.sql')
  console.log('  - dimension_coverage_report.json\n')

  process.exit(0)
}

main().catch((error) => {
  console.error('\n❌ Error:', error)
  process.exit(1)
})
