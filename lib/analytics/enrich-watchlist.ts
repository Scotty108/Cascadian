/**
 * Watchlist Enrichment Helper
 *
 * Adds canonical category, tags, and wallet context to watchlist entries
 */

import { resolve } from 'path'
import * as fs from 'fs'
import { getCanonicalCategoryForEvent } from '@/lib/category/canonical-category'

interface MarketDim {
  condition_id: string
  market_id: string
  event_id: string | null
  question: string
}

interface EventDim {
  event_id: string
  category: string | null
  tags: Array<{ label: string }>
}

// Cache for dimension data
let marketsCache: Map<string, MarketDim> | null = null
let eventsCache: Map<string, EventDim> | null = null

function loadDimensionData() {
  if (marketsCache && eventsCache) {
    return { marketsCache, eventsCache }
  }

  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')

  // Load markets
  if (fs.existsSync(marketsPath)) {
    const markets: MarketDim[] = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
    marketsCache = new Map()
    for (const market of markets) {
      marketsCache.set(market.market_id, market)
    }
  } else {
    marketsCache = new Map()
  }

  // Load events
  if (fs.existsSync(eventsPath)) {
    const events: EventDim[] = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))
    eventsCache = new Map()
    for (const event of events) {
      eventsCache.set(event.event_id, event)
    }
  } else {
    eventsCache = new Map()
  }

  return { marketsCache, eventsCache }
}

export interface EnrichedWatchlistItem {
  id: string
  workflow_id: string
  market_id: string
  added_at: string
  reason: string
  metadata: any
  // Enriched fields
  question: string | null
  canonical_category: string
  raw_tags: string[]
  triggering_wallet_address: string | null
  triggering_wallet_rank: number | null
  triggering_wallet_coverage_pct: number | null
}

/**
 * Enrich watchlist items with canonical categories and wallet context
 */
export function enrichWatchlistItems(items: any[]): EnrichedWatchlistItem[] {
  const { marketsCache, eventsCache } = loadDimensionData()

  return items.map(item => {
    const market = marketsCache.get(item.market_id)
    let question: string | null = null
    let canonical_category = 'Uncategorized'
    let raw_tags: string[] = []

    // Try to get enrichment from dimension data
    if (market && market.event_id) {
      question = market.question
      const event = eventsCache.get(market.event_id)
      if (event) {
        const result = getCanonicalCategoryForEvent({
          category: event.category,
          tags: event.tags || []
        })
        canonical_category = result.canonical_category
        raw_tags = result.raw_tags
      }
    }

    // Extract wallet context from metadata if available
    const triggering_wallet_address = item.metadata?.triggered_by_wallet ||
                                     item.metadata?.triggering_wallet_address ||
                                     null
    const triggering_wallet_rank = item.metadata?.wallet_rank ||
                                   item.metadata?.triggering_wallet_rank ||
                                   null
    const triggering_wallet_coverage_pct = item.metadata?.wallet_coverage_pct ||
                                          item.metadata?.triggering_wallet_coverage_pct ||
                                          null

    // If we have stored canonical_category in metadata, prefer that
    if (item.metadata?.canonical_category) {
      canonical_category = item.metadata.canonical_category
    }
    if (item.metadata?.raw_tags && Array.isArray(item.metadata.raw_tags)) {
      raw_tags = item.metadata.raw_tags
    }

    return {
      id: item.id,
      workflow_id: item.workflow_id,
      market_id: item.market_id,
      added_at: item.added_at,
      reason: item.reason,
      metadata: item.metadata,
      // Enriched fields
      question,
      canonical_category,
      raw_tags,
      triggering_wallet_address,
      triggering_wallet_rank,
      triggering_wallet_coverage_pct
    }
  })
}
