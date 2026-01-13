import { NextRequest, NextResponse } from 'next/server'
import { refreshMarketSII, getStrongestSignals } from '@/lib/metrics/market-sii'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/markets/[condition_id]/sii
 *
 * Returns Smart Investor Index (SII) for a market
 * Shows which side (YES/NO) has higher Omega scores
 *
 * Query params:
 * - fresh: If 'true', recalculates SII instead of using cached value
 * - ttl: Cache TTL in seconds (default: 3600 = 1 hour)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ condition_id: string }> }
) {
  try {
    const { condition_id } = await params
    const searchParams = request.nextUrl.searchParams
    const fresh = searchParams.get('fresh') === 'true'

    if (!condition_id) {
      return NextResponse.json({ error: 'Market ID required' }, { status: 400 })
    }

    // Handle special case: "strongest" returns top signals
    if (condition_id === 'strongest') {
      const limit = parseInt(searchParams.get('limit') || '20')
      const signals = await getStrongestSignals(limit)

      return NextResponse.json({
        signals,
        count: signals.length,
      })
    }

    // Calculate or get cached SII
    const sii = await refreshMarketSII(condition_id, undefined, fresh)

    if (!sii) {
      return NextResponse.json(
        {
          error: 'Could not calculate SII for this market',
          market_id: condition_id,
          reason: 'No positions found or insufficient data',
        },
        { status: 404 }
      )
    }

    // Calculate cache age
    const cacheAge = Date.now() - new Date(sii.calculated_at).getTime()
    const cacheAgeSec = Math.floor(cacheAge / 1000)

    return NextResponse.json({
      ...sii,
      cached: !fresh,
      cache_age_seconds: cacheAgeSec,
    })
  } catch (error) {
    console.error('[API] Error calculating market SII:', error)
    return NextResponse.json(
      {
        error: 'Failed to calculate market SII',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
