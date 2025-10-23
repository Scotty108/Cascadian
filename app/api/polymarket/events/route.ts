/**
 * Polymarket Events API Endpoint
 *
 * Fetches events from Polymarket Gamma API and enriches with category data
 * Uses the 3-tier category extraction system from lib/polymarket/utils
 *
 * GET /api/polymarket/events
 * Query params:
 *   - limit: number (default: 100)
 *   - offset: number (default: 0)
 *   - closed: boolean (default: false) - whether to include closed events
 */

import { NextRequest, NextResponse } from 'next/server'
import { extractCategoryFromTags } from '@/lib/polymarket/utils'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '100')
  const offset = parseInt(searchParams.get('offset') || '0')
  const closed = searchParams.get('closed') === 'true'

  try {
    // Fetch from Polymarket Gamma API (events endpoint, NOT markets)
    const url = `https://gamma-api.polymarket.com/events?closed=${closed}&limit=${limit}&offset=${offset}`

    console.log(`[Events API] Fetching from: ${url}`)

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`)
    }

    const events = await response.json()

    // Enrich each event with category from tags (3-tier extraction)
    const eventsWithCategories = events.map((event: any) => {
      const category = extractCategoryFromTags(event.tags || [])

      // Flag multi-outcome markets (negRisk events with > 2 markets)
      const isMultiOutcome = event.negRisk === true && event.markets?.length > 2

      return {
        ...event,
        category,
        isMultiOutcome,
        marketCount: event.markets?.length || 0,
      }
    })

    console.log(`[Events API] Fetched ${eventsWithCategories.length} events`)

    return NextResponse.json({
      success: true,
      data: eventsWithCategories,
      total: eventsWithCategories.length,
      pagination: {
        limit,
        offset,
        closed,
      },
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Events API] Error:', message)

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
