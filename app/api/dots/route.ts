/**
 * WIO Dot Events Feed API
 *
 * GET /api/dots?since=2026-01-13&type=SUPERFORECASTER&limit=50
 *
 * Returns recent smart money moves (dot events):
 * - Wallet, market, side, size, confidence
 * - Market context (crowd odds, entry price)
 * - Filterable by type, market, wallet
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DotEvent {
  dot_id: string
  timestamp: string
  wallet_id: string
  market_id: string
  bundle_id: string
  action: string
  side: string
  size_usd: number
  dot_type: string
  confidence: number
  reason_metrics: string[]
  credibility_score: number
  bot_likelihood: number
  crowd_odds: number
  entry_price: number
  market_title?: string
}

export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const since = searchParams.get('since') // ISO date string
    const dotType = searchParams.get('type') // SUPERFORECASTER, SMART_MONEY
    const marketId = searchParams.get('market') // condition_id filter
    const walletId = searchParams.get('wallet') // wallet filter
    const minConfidence = parseFloat(searchParams.get('min_confidence') || '0')
    const minSize = parseFloat(searchParams.get('min_size') || '0')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500)

    // Build WHERE clauses
    const conditions: string[] = []

    if (since) {
      conditions.push(`ts >= toDateTime('${since}')`)
    } else {
      // Default to last 7 days
      conditions.push(`ts >= now() - INTERVAL 7 DAY`)
    }

    if (dotType) {
      conditions.push(`dot_type = '${dotType}'`)
    }

    if (marketId) {
      conditions.push(`market_id = '${marketId.toLowerCase()}'`)
    }

    if (walletId) {
      conditions.push(`wallet_id = '${walletId.toLowerCase()}'`)
    }

    if (minConfidence > 0) {
      conditions.push(`confidence >= ${minConfidence}`)
    }

    if (minSize > 0) {
      conditions.push(`size_usd >= ${minSize}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Query dot events with market metadata
    const query = `
      SELECT
        d.dot_id,
        d.ts as timestamp,
        d.wallet_id,
        d.market_id,
        d.bundle_id,
        d.action,
        d.side,
        d.size_usd,
        d.dot_type,
        d.confidence,
        d.reason_metrics,
        d.credibility_score,
        d.bot_likelihood,
        d.crowd_odds,
        d.entry_price,
        m.question as market_title
      FROM wio_dot_events_v1 d
      LEFT JOIN pm_market_metadata m ON d.market_id = m.condition_id
      ${whereClause}
      ORDER BY d.ts DESC, d.confidence DESC
      LIMIT ${limit}
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })
    const rows = await result.json() as any[]

    // Transform results
    const events: DotEvent[] = rows.map(row => ({
      dot_id: row.dot_id,
      timestamp: row.timestamp,
      wallet_id: row.wallet_id,
      market_id: row.market_id,
      bundle_id: row.bundle_id,
      action: row.action,
      side: row.side,
      size_usd: round(row.size_usd, 2),
      dot_type: row.dot_type,
      confidence: round(row.confidence, 4),
      reason_metrics: row.reason_metrics || [],
      credibility_score: round(row.credibility_score, 4),
      bot_likelihood: round(row.bot_likelihood, 4),
      crowd_odds: round(row.crowd_odds * 100, 1), // Convert to percentage
      entry_price: round(row.entry_price * 100, 1), // Convert to percentage
      market_title: row.market_title || undefined,
    }))

    // Get summary stats
    const summaryQuery = `
      SELECT
        count() as total_dots,
        countIf(dot_type = 'SUPERFORECASTER') as superforecaster_dots,
        countIf(dot_type = 'SMART_MONEY') as smart_money_dots,
        uniqExact(wallet_id) as unique_wallets,
        uniqExact(market_id) as unique_markets,
        round(sum(size_usd), 0) as total_size_usd
      FROM wio_dot_events_v1
      ${whereClause}
    `
    const summaryResult = await clickhouse.query({
      query: summaryQuery,
      format: 'JSONEachRow',
    })
    const summary = (await summaryResult.json() as any[])[0]

    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      data: {
        events,
        summary: {
          total_dots: Number(summary?.total_dots || 0),
          superforecaster_dots: Number(summary?.superforecaster_dots || 0),
          smart_money_dots: Number(summary?.smart_money_dots || 0),
          unique_wallets: Number(summary?.unique_wallets || 0),
          unique_markets: Number(summary?.unique_markets || 0),
          total_size_usd: Number(summary?.total_size_usd || 0),
        },
      },
      meta: {
        durationMs,
        filters: {
          since: since || 'last 7 days',
          type: dotType || 'all',
          market: marketId || 'all',
          wallet: walletId || 'all',
          min_confidence: minConfidence,
          min_size: minSize,
          limit,
        },
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    })

  } catch (error: any) {
    console.error('[dots] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch dot events',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}

// Helper to round numbers safely
function round(value: any, decimals: number): number {
  const num = Number(value)
  if (!isFinite(num)) return 0
  return parseFloat(num.toFixed(decimals))
}
