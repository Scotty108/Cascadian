/**
 * Polymarket Market Detail API Route
 *
 * Fetches a single market's details - tries database first (includes event data), then Polymarket
 * GET /api/polymarket/markets/[id]
 */

import { NextRequest, NextResponse } from 'next/server'
import { extractCategoryFromTags } from '@/lib/polymarket/utils'
import { fetchPolymarketAPI, sanitizeErrorMessage } from '@/lib/polymarket/api-utils'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { clickhouse } from '@/lib/clickhouse/client'

// Stock ticker symbols that are miscategorized as "Sports" in the database
const STOCK_TICKER_PATTERNS = [
  /\b(NFLX|AAPL|GOOGL|GOOG|MSFT|AMZN|META|NVDA|TSLA|AMD|INTC|COIN|SPY|QQQ|BTC|ETH)\b/i,
];

// Correct miscategorized markets (e.g., stock tickers labeled as "Sports")
function correctCategory(category: string, question: string): string {
  const isStockMarket = STOCK_TICKER_PATTERNS.some(pattern => pattern.test(question));
  const isUpDownMarket = /up.or.down/i.test(question);

  if (isStockMarket || isUpDownMarket) {
    return 'Finance';
  }
  return category || 'Other';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Step 1: Try to fetch from our database first (includes event data)
    // Support both market_id and condition_id lookups
    console.log(`[Market Detail API] Checking database for market: ${id}`)

    // First try by market_id
    let { data: dbMarket, error: dbError } = await supabase
      .from('markets')
      .select('*')
      .eq('market_id', id)
      .single()

    // If not found by market_id, try by condition_id (64-char hex)
    if (dbError || !dbMarket) {
      const conditionResult = await supabase
        .from('markets')
        .select('*')
        .eq('condition_id', id.toLowerCase())
        .single()

      if (!conditionResult.error && conditionResult.data) {
        dbMarket = conditionResult.data
        dbError = null
        console.log(`[Market Detail API] Found market by condition_id: ${id}`)
      }
    }

    // Step 1b: If not in Supabase, check ClickHouse pm_market_metadata
    let clickhouseMarket: any = null
    if (dbError || !dbMarket) {
      try {
        // Try by condition_id first (64-char hex), then by market_id
        const query = id.length === 64 && /^[a-f0-9]+$/i.test(id)
          ? `SELECT * FROM pm_market_metadata WHERE condition_id = '${id.toLowerCase()}' LIMIT 1`
          : `SELECT * FROM pm_market_metadata WHERE market_id = '${id}' LIMIT 1`

        const result = await clickhouse.query({ query, format: 'JSONEachRow' })
        const rows = await result.json() as any[]

        if (rows.length > 0) {
          clickhouseMarket = rows[0]
          console.log(`[Market Detail API] Found market in ClickHouse: ${clickhouseMarket.question}`)
        }
      } catch (chError) {
        console.error(`[Market Detail API] ClickHouse lookup failed:`, chError)
      }
    }

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
          category: correctCategory(dbMarket.category, dbMarket.title || ''),
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

    // Step 1c: If we found data in ClickHouse but not Supabase, return it
    if (clickhouseMarket) {
      console.log(`[Market Detail API] Returning ClickHouse data for ${id}`)

      // Parse arrays - outcome_prices may have ClickHouse quirks (outer literal quotes)
      const outcomes = clickhouseMarket.outcomes || ['Yes', 'No']
      let outcomePrices = ['0.5', '0.5']
      if (clickhouseMarket.outcome_prices) {
        try {
          let value: any = clickhouseMarket.outcome_prices

          // ClickHouse wraps the value in literal outer quotes like: "["0.0035", "0.9965"]"
          // Strip outer quotes if present (but not valid JSON escaping)
          if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"') && value.length > 2) {
            if (value.charAt(1) === '[') {
              value = value.slice(1, -1)
            }
          }

          // Keep parsing while it's still a string
          let attempts = 0
          while (typeof value === 'string' && attempts < 5) {
            try {
              value = JSON.parse(value)
              attempts++
            } catch {
              break
            }
          }
          if (Array.isArray(value)) {
            outcomePrices = value.map((p: any) => String(p))
          }
        } catch (e) {
          console.error('[Market Detail API] Failed to parse outcome_prices:', e)
        }
      }
      const clobTokenIds = clickhouseMarket.token_ids || []

      return NextResponse.json({
        success: true,
        data: {
          id: clickhouseMarket.market_id,
          question: clickhouseMarket.question,
          conditionId: clickhouseMarket.condition_id,
          slug: clickhouseMarket.slug,
          description: clickhouseMarket.description || '',
          category: correctCategory(clickhouseMarket.category, clickhouseMarket.question || ''),
          image: clickhouseMarket.image_url || null,
          outcomes,
          outcomePrices,
          volume: String(clickhouseMarket.volume_usdc || 0),
          volume24hr: String(clickhouseMarket.volume_24hr || 0),
          liquidity: String(clickhouseMarket.liquidity_usdc || 0),
          clobTokenIds,
          active: clickhouseMarket.is_active === 1,
          closed: clickhouseMarket.is_closed === 1,
          endDate: clickhouseMarket.end_date || null,
          startDate: clickhouseMarket.start_date || null,
          createdAt: clickhouseMarket.created_at || null,
          tags: (clickhouseMarket.tags || []).map((t: string) => ({ label: t, slug: t.toLowerCase().replace(/\s+/g, '-') })),
          // Event data from ClickHouse
          event_id: clickhouseMarket.event_id || null,
          event_slug: clickhouseMarket.group_slug || null,
          event_title: null,
        },
      })
    }

    // Step 2: If not in cache or stale, fetch from Polymarket
    // Polymarket API only accepts market_id, not condition_id
    // If we have dbMarket, use its market_id; otherwise use the provided id
    const marketIdForApi = dbMarket?.market_id || id
    const url = `https://gamma-api.polymarket.com/markets/${marketIdForApi}`
    console.log(`[Market Detail API] Fetching fresh data from Polymarket: ${url}`)

    // Use robust API fetch with Cloudflare detection
    const { data: market, error: apiError, isCloudflareBlocked } = await fetchPolymarketAPI<any>(url)

    // If Cloudflare blocked or API error, try to use cached/stale data
    if (isCloudflareBlocked || apiError || !market) {
      if (dbMarket) {
        console.log(`[Market Detail API] API unavailable (${isCloudflareBlocked ? 'Cloudflare blocked' : apiError}), using cached data for ${id}`)
        const outcomes = typeof dbMarket.outcomes === 'string'
          ? JSON.parse(dbMarket.outcomes)
          : dbMarket.outcomes || []
        const outcomePrices = dbMarket.raw_polymarket_data?.outcomePrices || []
        const clobTokenIds = dbMarket.raw_polymarket_data?.clobTokenIds || []
        return NextResponse.json({
          success: true,
          data: {
            ...(dbMarket.raw_polymarket_data || {}),
            id: dbMarket.market_id,
            question: dbMarket.title,
            conditionId: dbMarket.condition_id,
            slug: dbMarket.slug,
            description: dbMarket.description,
            category: correctCategory(dbMarket.category, dbMarket.title || ''),
            outcomes,
            outcomePrices,
            volume: String(dbMarket.volume_total || 0),
            volume24hr: String(dbMarket.volume_24h || 0),
            liquidity: String(dbMarket.liquidity || 0),
            clobTokenIds,
            active: dbMarket.active,
            closed: dbMarket.closed,
            endDate: dbMarket.end_date,
            event_id: dbMarket.event_id,
            event_slug: dbMarket.event_slug,
            event_title: dbMarket.event_title,
          },
          _apiWarning: isCloudflareBlocked ? 'API rate limited, using cached data' : undefined,
        })
      }

      // No cached data available
      if (apiError?.includes('404') || apiError?.includes('Not found')) {
        return NextResponse.json(
          { success: false, error: 'Market not found' },
          { status: 404 }
        )
      }

      return NextResponse.json(
        { success: false, error: sanitizeErrorMessage(apiError) },
        { status: isCloudflareBlocked ? 503 : 500 }
      )
    }

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
    // Also correct any miscategorized markets (e.g., stock tickers)
    const correctedCategory = correctCategory(category, market.question || '');

    const enrichedMarket = {
      ...market,
      category: correctedCategory,
      outcomes,
      outcomePrices,
      clobTokenIds,
      // Include event data from database if we found it earlier
      event_id: dbMarket?.event_id || null,
      event_slug: dbMarket?.event_slug || null,
      event_title: dbMarket?.event_title || null,
    }

    console.log(`[Market Detail API] Found market: ${market.question} (category: ${correctedCategory})`)

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
