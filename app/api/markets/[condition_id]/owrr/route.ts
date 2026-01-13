/**
 * API Endpoint: /api/markets/[condition_id]/owrr
 *
 * Returns the OWRR (Omega-Weighted Risk Ratio) smart money signal for a market
 *
 * GET /api/markets/[marketId]/owrr
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "owrr": 0.68,
 *     "slider": 68,
 *     "yes_score": 4250.5,
 *     "no_score": 2010.2,
 *     "yes_qualified": 16,
 *     "no_qualified": 14,
 *     "yes_avg_omega": 2.1,
 *     "no_avg_omega": 1.4,
 *     "category": "Politics",
 *     "confidence": "high"
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { calculateOWRR } from '@/lib/metrics/owrr'

// Cache for 5 minutes
const CACHE_TTL = 5 * 60 * 1000
const cache = new Map<string, { data: any, timestamp: number }>()

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ condition_id: string }> }
) {
  try {
    const { condition_id: marketId } = await params

    // Parse query params
    const searchParams = request.nextUrl.searchParams
    const includeBreakdown = searchParams.get('breakdown') === 'true'

    // Check cache
    const cacheKey = `${marketId}:${includeBreakdown}`
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({
        success: true,
        data: cached.data,
        cached: true
      })
    }

    // Get market info (need category)
    // TODO: Replace with actual market lookup
    const market = await getMarket(marketId)

    if (!market) {
      return NextResponse.json({
        success: false,
        error: 'Market not found'
      }, { status: 404 })
    }

    // Calculate OWRR
    const result = await calculateOWRR(marketId, market.category)

    // Filter breakdown if not requested
    const response = includeBreakdown
      ? result
      : {
          ...result,
          breakdown: undefined
        }

    // Cache result
    cache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    })

    return NextResponse.json({
      success: true,
      data: response
    })

  } catch (error) {
    console.error('Error calculating OWRR:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

/**
 * Get market information including category
 */
async function getMarket(marketId: string): Promise<{ category: string } | null> {
  const { clickhouse } = await import('@/lib/clickhouse/client')

  const query = `
    SELECT e.canonical_category as category
    FROM markets_dim m
    JOIN events_dim e ON m.event_id = e.event_id
    WHERE m.market_id = {marketId:String}
    LIMIT 1
  `

  try {
    const result = await clickhouse.query({
      query,
      query_params: { marketId },
      format: 'JSONEachRow'
    })

    const rows = (await result.json()) as { category: string }[]

    if (rows.length === 0) {
      return null
    }

    return {
      category: rows[0].category
    }
  } catch (error) {
    console.error('Error fetching market:', error)
    return null
  }
}

// Periodic cache cleanup (every 10 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL * 2) {
      cache.delete(key)
    }
  }
}, 10 * 60 * 1000)
