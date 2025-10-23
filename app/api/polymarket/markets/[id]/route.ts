/**
 * Polymarket Market Detail API Route
 *
 * Fetches a single market's details from Polymarket Gamma API
 * GET /api/polymarket/markets/[id]
 */

import { NextRequest, NextResponse } from 'next/server'
import { extractCategoryFromTags } from '@/lib/polymarket/utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Fetch single market from Polymarket Gamma API
    const url = `https://gamma-api.polymarket.com/markets/${id}`
    console.log(`[Market Detail API] Fetching: ${url}`)

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

    // Enrich market data
    const enrichedMarket = {
      ...market,
      category,
      outcomes,
      outcomePrices,
      clobTokenIds,
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
