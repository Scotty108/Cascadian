/**
 * Polymarket Event Detail API Endpoint
 *
 * Fetches a single event by slug from Polymarket Gamma API
 * Returns full event data including all nested markets
 *
 * GET /api/polymarket/events/[slug]
 */

import { NextRequest, NextResponse } from 'next/server'
import { extractCategoryFromTags } from '@/lib/polymarket/utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  try {
    // Fetch single event from Polymarket Gamma API
    const url = `https://gamma-api.polymarket.com/events/${slug}`

    console.log(`[Event Detail API] Fetching: ${url}`)

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          {
            success: false,
            error: 'Event not found',
          },
          { status: 404 }
        )
      }

      throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`)
    }

    const event = await response.json()

    // Enrich with category and multi-outcome detection
    const category = extractCategoryFromTags(event.tags || [])
    const isMultiOutcome = event.negRisk === true && event.markets?.length > 2
    const marketCount = event.markets?.length || 0

    const enrichedEvent = {
      ...event,
      category,
      isMultiOutcome,
      marketCount,
    }

    console.log(`[Event Detail API] Found event: ${event.title} (${marketCount} markets, category: ${category})`)

    return NextResponse.json({
      success: true,
      data: enrichedEvent,
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Event Detail API] Error for slug ${slug}:`, message)

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
