/**
 * Polymarket Related Events API Route
 *
 * Fetches related events based on tags/category
 * GET /api/polymarket/events/related?tags=crypto,bitcoin&limit=6
 */

import { NextRequest, NextResponse } from 'next/server'
import { extractCategoryFromTags } from '@/lib/polymarket/utils'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tags = searchParams.get('tags')?.split(',') || []
  const category = searchParams.get('category') || ''
  const excludeId = searchParams.get('excludeId') || ''
  const limit = parseInt(searchParams.get('limit') || '6')

  try {
    // Fetch all active events
    const url = `https://gamma-api.polymarket.com/events?closed=false&limit=100`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`)
    }

    const allEvents = await response.json()

    // Filter for related events based on tags or category
    const relatedEvents = allEvents
      .filter((event: any) => {
        // Exclude the current market
        if (event.id === excludeId) return false

        // Check if event has matching tags
        const eventTags = (event.tags || []).map((t: any) => t.slug.toLowerCase())
        const hasMatchingTag = tags.some(tag =>
          eventTags.some((eventTag: string) => eventTag.includes(tag.toLowerCase()))
        )

        // Check if event has matching category
        const eventCategory = extractCategoryFromTags(event.tags || [])
        const hasMatchingCategory = category && eventCategory === category

        return hasMatchingTag || hasMatchingCategory
      })
      .slice(0, limit)
      .map((event: any) => ({
        ...event,
        category: extractCategoryFromTags(event.tags || []),
        marketCount: event.markets?.length || 0,
      }))

    return NextResponse.json({
      success: true,
      data: relatedEvents,
      count: relatedEvents.length,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Related Events API] Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
