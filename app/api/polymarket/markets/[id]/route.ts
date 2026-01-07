/**
 * Polymarket Market Detail API Route
 *
 * Fetches a single market's details - tries database first (includes event data), then Polymarket
 * GET /api/polymarket/markets/[id]
 */

import { NextRequest, NextResponse } from 'next/server'
import { extractCategoryFromTags } from '@/lib/polymarket/utils'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Step 1: Try to fetch from our database first (includes event data)
    console.log(`[Market Detail API] Checking database for market: ${id}`)

    const { data: dbMarket, error: dbError } = await supabase
      .from('markets')
      .select('*')
      .eq('market_id', id)
      .single()

    // If found in database and recently updated (within 5 minutes), use cached data
    if (dbMarket && !dbError) {
      const lastUpdate = new Date(dbMarket.updated_at)
      const age = Date.now() - lastUpdate.getTime()
      const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

      if (age < CACHE_TTL) {
        console.log(`[Market Detail API] Using cached data for ${id} (${Math.floor(age / 1000)}s old)`)

        // Parse outcomes and outcomePrices from database
        const outcomes = typeof dbMarket.outcomes === 'string'
          ? JSON.parse(dbMarket.outcomes)
          : dbMarket.outcomes || []

        const outcomePrices = dbMarket.raw_polymarket_data?.outcomePrices
          ? (typeof dbMarket.raw_polymarket_data.outcomePrices === 'string'
              ? JSON.parse(dbMarket.raw_polymarket_data.outcomePrices)
              : dbMarket.raw_polymarket_data.outcomePrices)
          : []

        const clobTokenIds = dbMarket.raw_polymarket_data?.clobTokenIds
          ? (typeof dbMarket.raw_polymarket_data.clobTokenIds === 'string'
              ? JSON.parse(dbMarket.raw_polymarket_data.clobTokenIds)
              : dbMarket.raw_polymarket_data.clobTokenIds)
          : []

        // Transform database format to API format - spread raw_polymarket_data FIRST, then override
        const enrichedMarket = {
          // Start with all raw Polymarket data
          ...(dbMarket.raw_polymarket_data || {}),
          // Override with our database fields and parsed values
          id: dbMarket.market_id,
          question: dbMarket.title,
          conditionId: dbMarket.condition_id,
          slug: dbMarket.slug,
          description: dbMarket.description,
          category: dbMarket.category,
          outcomes,
          outcomePrices,
          volume: String(dbMarket.volume_total || 0),
          volume24hr: String(dbMarket.volume_24h || 0),
          liquidity: String(dbMarket.liquidity || 0),
          clobTokenIds,
          active: dbMarket.active,
          closed: dbMarket.closed,
          endDate: dbMarket.end_date,
          // EVENT DATA - this is what we need!
          event_id: dbMarket.event_id,
          event_slug: dbMarket.event_slug,
          event_title: dbMarket.event_title,
        }

        return NextResponse.json({
          success: true,
          data: enrichedMarket,
        })
      }
    }

    // Step 2: If not in cache or stale, fetch from Polymarket
    const url = `https://gamma-api.polymarket.com/markets/${id}`
    console.log(`[Market Detail API] Fetching fresh data from Polymarket: ${url}`)

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    })

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { success: false, error: 'Market not found' },
          { status: 404 }
        )
      }
      throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`)
    }

    const market = await response.json()

    // Extract category from tags
    const category = extractCategoryFromTags(market.tags || [])

    // Parse JSON string fields if needed
    const outcomes = typeof market.outcomes === 'string'
      ? JSON.parse(market.outcomes)
      : market.outcomes || []

    const outcomePrices = typeof market.outcomePrices === 'string'
      ? JSON.parse(market.outcomePrices)
      : market.outcomePrices || []

    const clobTokenIds = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds)
      : market.clobTokenIds || []

    // Enrich market data with event fields from database if available
    const enrichedMarket = {
      ...market,
      category,
      outcomes,
      outcomePrices,
      clobTokenIds,
      // Include event data from database if we found it earlier
      event_id: dbMarket?.event_id || null,
      event_slug: dbMarket?.event_slug || null,
      event_title: dbMarket?.event_title || null,
    }

    console.log(`[Market Detail API] Found market: ${market.question} (category: ${category})`)

    return NextResponse.json({
      success: true,
      data: enrichedMarket,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Market Detail API] Error for market ${id}:`, message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
