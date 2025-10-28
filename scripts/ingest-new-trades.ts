#!/usr/bin/env tsx
/**
 * Ingest New Trades (Incremental Sync)
 *
 * Forward pipeline that pulls new trades since the latest timestamp in ClickHouse
 * and enriches them with market_id, event_id, and canonical categories.
 *
 * GOLDEN RULE: NEVER write market_id='' or 'unknown' to ClickHouse
 *
 * Strategy:
 * 1. Find latest tx_timestamp in trades_raw
 * 2. Fetch new trades from upstream source
 * 3. For each trade with missing/unknown market_id:
 *    - Check condition_market_map cache first
 *    - If cache miss, resolve via external API
 *    - Cache the result for future runs
 * 4. Insert only trades with valid market_ids
 *
 * Run this on a cron (e.g., every 5 minutes) for continuous ingestion.
 *
 * READ-ONLY: Does not trigger alerts, update watchlists, or execute trades
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import { getCanonicalCategoryForEvent } from '@/lib/category/canonical-category'

// ============================================================================
// Types
// ============================================================================

interface RawTrade {
  trade_id: string
  wallet_address: string
  condition_id: string
  market_id?: string | null
  timestamp: Date
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  usd_value: number
  transaction_hash: string
  realized_pnl_usd?: number
  is_resolved?: number
}

interface MarketResolution {
  market_id: string
  event_id: string | null
  canonical_category: string
  raw_tags: string[]
}

// ============================================================================
// Cache for condition → market lookups
// ============================================================================

const conditionMarketCache = new Map<string, MarketResolution>()

async function loadCacheFromClickHouse() {
  console.log('📂 Loading condition_market_map cache from ClickHouse...')

  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        market_id,
        event_id,
        canonical_category,
        raw_tags
      FROM condition_market_map
      ORDER BY ingested_at DESC
      LIMIT 100000 BY condition_id
    `,
    format: 'JSONEachRow',
  })

  const rows = (await result.json()) as Array<{
    condition_id: string
    market_id: string
    event_id: string
    canonical_category: string
    raw_tags: string[]
  }>

  for (const row of rows) {
    conditionMarketCache.set(row.condition_id, {
      market_id: row.market_id,
      event_id: row.event_id || null,
      canonical_category: row.canonical_category,
      raw_tags: row.raw_tags || [],
    })
  }

  console.log(`   ✅ Loaded ${conditionMarketCache.size.toLocaleString()} cached mappings\n`)
}

// ============================================================================
// External API resolver (condition_id → market_id)
// ============================================================================

async function resolveConditionToMarket(
  conditionId: string
): Promise<MarketResolution | null> {
  // Check cache first
  if (conditionMarketCache.has(conditionId)) {
    return conditionMarketCache.get(conditionId)!
  }

  try {
    // Call Polymarket Gamma API to resolve condition → market
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`
    )

    if (!response.ok) {
      console.warn(`   ⚠️  API error for condition ${conditionId}: ${response.status}`)
      return null
    }

    const markets = await response.json()

    if (!markets || markets.length === 0) {
      console.warn(`   ⚠️  No market found for condition ${conditionId}`)
      return null
    }

    const market = markets[0]
    const marketId = market.id || market.market_id

    // Get event data for canonical category
    let eventId = null
    let canonicalCategory = 'Uncategorized'
    let rawTags: string[] = []

    if (market.events && market.events.length > 0) {
      const event = market.events[0]
      eventId = event.id || event.event_id

      const categoryResult = getCanonicalCategoryForEvent({
        category: event.category || null,
        tags: event.tags || [],
      })

      canonicalCategory = categoryResult.canonical_category
      rawTags = categoryResult.raw_tags
    }

    const resolution: MarketResolution = {
      market_id: marketId,
      event_id: eventId,
      canonical_category: canonicalCategory,
      raw_tags: rawTags,
    }

    // Cache the result
    conditionMarketCache.set(conditionId, resolution)

    return resolution
  } catch (error: any) {
    console.error(`   ❌ Error resolving condition ${conditionId}:`, error.message)
    return null
  }
}

// ============================================================================
// Stub: Fetch recent trades from upstream source
// ============================================================================

/**
 * STUB: Replace with actual upstream trade fetcher
 *
 * This should query your trade ingestion source (Goldsky, Polymarket API, etc.)
 * for trades after the given timestamp.
 *
 * For now, returns empty array.
 */
async function fetchRecentTrades(sinceTimestamp: Date): Promise<RawTrade[]> {
  console.log(`📡 Fetching trades since ${sinceTimestamp.toISOString()}...`)

  // TODO: Replace with actual implementation
  // Example:
  // - Query Goldsky OrderFilled events
  // - Query Polymarket trades API
  // - Read from message queue

  console.log('   ⚠️  STUB: No upstream trade source configured yet')
  console.log('   ⚠️  Return empty array for now\n')

  return []
}

// ============================================================================
// Main ingestion loop
// ============================================================================

async function main() {
  console.log('🚀 Ingest New Trades (Incremental Sync)')
  console.log('========================================\n')

  // ============================================================================
  // 1. Load condition_market_map cache
  // ============================================================================

  await loadCacheFromClickHouse()

  // ============================================================================
  // 2. Find latest tx_timestamp in trades_raw
  // ============================================================================

  console.log('🔍 Finding latest timestamp in trades_raw...')

  const latestResult = await clickhouse.query({
    query: `
      SELECT MAX(tx_timestamp) as latest_timestamp
      FROM trades_raw
    `,
    format: 'JSONEachRow',
  })

  const latestData = (await latestResult.json()) as Array<{
    latest_timestamp: string | null
  }>

  let sinceTimestamp: Date

  if (!latestData[0].latest_timestamp) {
    // No trades yet, start from 30 days ago
    sinceTimestamp = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    console.log(`   ⚠️  No trades found. Starting from 30 days ago: ${sinceTimestamp.toISOString()}\n`)
  } else {
    sinceTimestamp = new Date(latestData[0].latest_timestamp)
    console.log(`   ✅ Latest timestamp: ${sinceTimestamp.toISOString()}\n`)
  }

  // ============================================================================
  // 3. Fetch new trades
  // ============================================================================

  const newTrades = await fetchRecentTrades(sinceTimestamp)

  if (newTrades.length === 0) {
    console.log('✅ No new trades to ingest. Exiting.')
    return
  }

  console.log(`📦 Processing ${newTrades.length} new trades...\n`)

  // ============================================================================
  // 4. Enrich trades with market_id resolution
  // ============================================================================

  const enrichedTrades: RawTrade[] = []
  const newMappings: Array<{
    condition_id: string
    resolution: MarketResolution
  }> = []

  let needsEnrichment = 0
  let enrichmentSuccess = 0
  let enrichmentFailure = 0

  for (const trade of newTrades) {
    // Check if market_id is missing or unknown
    const needsResolution =
      !trade.market_id || trade.market_id === '' || trade.market_id === 'unknown'

    if (needsResolution) {
      needsEnrichment++
      const resolution = await resolveConditionToMarket(trade.condition_id)

      if (resolution) {
        // Successfully resolved
        trade.market_id = resolution.market_id
        enrichmentSuccess++

        // Track new mappings to upsert into cache
        newMappings.push({
          condition_id: trade.condition_id,
          resolution,
        })
      } else {
        // Failed to resolve - skip this trade
        enrichmentFailure++
        console.warn(
          `   ⚠️  Skipping trade ${trade.trade_id}: could not resolve market_id for condition ${trade.condition_id}`
        )
        continue
      }
    }

    // Only add trades with valid market_ids
    if (trade.market_id && trade.market_id !== '' && trade.market_id !== 'unknown') {
      enrichedTrades.push(trade)
    }
  }

  console.log(`\n   📊 Enrichment stats:`)
  console.log(`      Needed enrichment: ${needsEnrichment}`)
  console.log(`      Success: ${enrichmentSuccess}`)
  console.log(`      Failure: ${enrichmentFailure}`)
  console.log(`      Ready to insert: ${enrichedTrades.length}\n`)

  // ============================================================================
  // 5. Insert enriched trades into ClickHouse
  // ============================================================================

  if (enrichedTrades.length > 0) {
    console.log(`📥 Inserting ${enrichedTrades.length} trades into trades_raw...`)

    const insertValues = enrichedTrades.map((t) => ({
      trade_id: t.trade_id,
      wallet_address: t.wallet_address,
      condition_id: t.condition_id,
      market_id: t.market_id!,
      tx_timestamp: Math.floor(t.timestamp.getTime() / 1000),
      timestamp: Math.floor(t.timestamp.getTime() / 1000),
      side: t.side,
      entry_price: t.entry_price,
      exit_price: null,
      shares: t.shares,
      usd_value: t.usd_value,
      pnl: null,
      is_closed: false,
      transaction_hash: t.transaction_hash,
      realized_pnl_usd: t.realized_pnl_usd || 0.0,
      is_resolved: t.is_resolved || 0,
      created_at: Math.floor(Date.now() / 1000),
    }))

    await clickhouse.insert({
      table: 'trades_raw',
      values: insertValues,
      format: 'JSONEachRow',
    })

    console.log(`   ✅ Inserted ${enrichedTrades.length} trades\n`)
  }

  // ============================================================================
  // 6. Upsert new mappings into condition_market_map
  // ============================================================================

  if (newMappings.length > 0) {
    console.log(`📥 Upserting ${newMappings.length} new mappings into condition_market_map...`)

    const cacheInsertValues = newMappings.map((m) => ({
      condition_id: m.condition_id,
      market_id: m.resolution.market_id,
      event_id: m.resolution.event_id || '',
      canonical_category: m.resolution.canonical_category,
      raw_tags: m.resolution.raw_tags,
      ingested_at: Math.floor(Date.now() / 1000),
    }))

    await clickhouse.insert({
      table: 'condition_market_map',
      values: cacheInsertValues,
      format: 'JSONEachRow',
    })

    console.log(`   ✅ Cached ${newMappings.length} new mappings\n`)
  }

  // ============================================================================
  // 7. Summary
  // ============================================================================

  console.log('📋 INGESTION SUMMARY')
  console.log('====================')
  console.log(`   Trades fetched: ${newTrades.length}`)
  console.log(`   Trades inserted: ${enrichedTrades.length}`)
  console.log(`   Trades skipped (no market_id): ${enrichmentFailure}`)
  console.log(`   New cache entries: ${newMappings.length}`)
  console.log('')
  console.log('✅ GOLDEN RULE ENFORCED: Zero unknown market_ids written')
  console.log('✨ Ingestion complete!')
}

main()
  .catch((error) => {
    console.error('\n💥 Fatal error:', error)
    process.exit(1)
  })
