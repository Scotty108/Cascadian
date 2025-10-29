#!/usr/bin/env tsx
/**
 * Phase 0 Task 0.3: Build dimensions for missing 821 markets
 *
 * Reads runtime/missing_market_ids.jsonl and fetches metadata for each market
 * from Polymarket API, then updates markets_dim_seed.json and events_dim_seed.json
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'

const API_DELAY_MS = 1200
const FOCUS_FILE = process.env.FOCUS_FILE || resolve(process.cwd(), 'runtime/missing_market_ids.jsonl')

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

async function fetchMarketMetadata(marketId: string): Promise<Partial<MarketDim> | null> {
  try {
    const response = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`)
    if (!response.ok) return null

    const data = await response.json()

    // Get condition_id
    const condition_id = data.conditionId || ''

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
      condition_id,
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

async function main() {
  console.log('📍 Phase 0 Task 0.3: Build dimensions for missing markets\n')

  // Load missing market IDs
  if (!fs.existsSync(FOCUS_FILE)) {
    throw new Error(`Focus file not found: ${FOCUS_FILE}`)
  }

  console.log(`📂 Loading missing market IDs from ${FOCUS_FILE}...`)
  const lines = fs.readFileSync(FOCUS_FILE, 'utf-8').split('\n').filter(Boolean)
  const missingMarkets = lines.map(line => {
    const obj = JSON.parse(line)
    return obj.market_id
  })

  console.log(`   ✅ Found ${missingMarkets.length} missing markets\n`)

  // Load existing dimension files
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')

  let existingMarkets: MarketDim[] = []
  let existingEvents: EventDim[] = []

  if (fs.existsSync(marketsPath)) {
    existingMarkets = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
    console.log(`📂 Loaded ${existingMarkets.length} existing markets`)
  }

  if (fs.existsSync(eventsPath)) {
    existingEvents = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))
    console.log(`📂 Loaded ${existingEvents.length} existing events\n`)
  }

  // Track new data
  const newMarkets: MarketDim[] = []
  const newEvents = new Map<string, EventDim>()
  const existingEventIds = new Set(existingEvents.map(e => e.event_id))

  // Fetch metadata for each missing market
  console.log('🌐 Fetching market metadata from Polymarket API...\n')
  let fetched = 0
  let failed = 0

  for (let i = 0; i < missingMarkets.length; i++) {
    const marketId = missingMarkets[i]

    const metadata = await fetchMarketMetadata(marketId)

    if (metadata && metadata.condition_id) {
      const market: MarketDim = {
        condition_id: metadata.condition_id,
        market_id: marketId,
        event_id: metadata.event_id || null,
        question: metadata.question || null,
        resolved_outcome: metadata.resolved_outcome || null,
        payout_yes: metadata.payout_yes || null,
        payout_no: metadata.payout_no || null,
        resolved_at: metadata.resolved_at || null
      }

      newMarkets.push(market)
      fetched++

      // Fetch event metadata if we have an event_id and haven't fetched it yet
      if (market.event_id && !existingEventIds.has(market.event_id) && !newEvents.has(market.event_id)) {
        const eventMetadata = await fetchEventMetadata(market.event_id)
        if (eventMetadata) {
          newEvents.set(market.event_id, eventMetadata)
        }
        await new Promise(resolve => setTimeout(resolve, API_DELAY_MS))
      }
    } else {
      failed++
    }

    if ((i + 1) % 50 === 0) {
      console.log(`   Progress: ${i + 1}/${missingMarkets.length} (${fetched} fetched, ${failed} failed)`)
    }

    await new Promise(resolve => setTimeout(resolve, API_DELAY_MS))
  }

  console.log(`\n✅ Fetched ${fetched} new markets`)
  console.log(`✅ Fetched ${newEvents.size} new events`)
  if (failed > 0) {
    console.log(`⚠️  Failed to fetch ${failed} markets\n`)
  }

  // Merge with existing data
  console.log('\n📝 Merging with existing dimension files...')
  const allMarkets = [...existingMarkets, ...newMarkets]
  const allEvents = [...existingEvents, ...Array.from(newEvents.values())]

  console.log(`   Markets: ${existingMarkets.length} existing + ${newMarkets.length} new = ${allMarkets.length} total`)
  console.log(`   Events: ${existingEvents.length} existing + ${newEvents.size} new = ${allEvents.length} total\n`)

  // Write updated files
  console.log('💾 Writing updated dimension files...')
  fs.writeFileSync(marketsPath, JSON.stringify(allMarkets, null, 2))
  console.log(`   ✅ Updated ${marketsPath}`)

  fs.writeFileSync(eventsPath, JSON.stringify(allEvents, null, 2))
  console.log(`   ✅ Updated ${eventsPath}\n`)

  console.log('✅ Task 0.3 partial complete!')
  console.log('   Next step: Run scripts/publish-dimensions-to-clickhouse.ts')

  process.exit(0)
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
