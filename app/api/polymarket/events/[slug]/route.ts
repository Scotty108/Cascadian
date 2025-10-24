/**
 * Polymarket Event Detail API Endpoint
 *
 * Fetches a single event by slug - tries database first, then falls back to Polymarket by ID
 * Returns full event data including all nested markets
 *
 * GET /api/polymarket/events/[slug]
 */

import { NextRequest, NextResponse } from 'next/server'
import { extractCategoryFromTags } from '@/lib/polymarket/utils'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  try {
    // Step 1: Query our database to find event_id from slug
    console.log(`[Event Detail API] Looking up event_id for slug: ${slug}`)

    const { data: markets, error: dbError } = await supabase
      .from('markets')
      .select('event_id, event_title, event_slug')
      .eq('event_slug', slug)
      .not('event_id', 'is', null)
      .limit(1)
      .single()

    if (dbError || !markets?.event_id) {
      console.log(`[Event Detail API] Event not found in database: ${slug}`)
      return NextResponse.json(
        {
          success: false,
          error: 'This event is no longer available. It may have closed, been archived, or the link may be incorrect. Please visit the Events page to browse active prediction events.',
        },
        { status: 404 }
      )
    }

    const eventId = markets.event_id

    // Step 2: Fetch event details from Polymarket using event_id (not slug!)
    const url = `https://gamma-api.polymarket.com/events/${eventId}`

    console.log(`[Event Detail API] Fetching from Polymarket: ${url}`)

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 404 || response.status === 422) {
        // Event doesn't exist or is archived/closed
        return NextResponse.json(
          {
            success: false,
            error: 'This event is no longer available. It may have closed, been archived, or the link may be incorrect. Please visit the Events page to browse active prediction events.',
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
