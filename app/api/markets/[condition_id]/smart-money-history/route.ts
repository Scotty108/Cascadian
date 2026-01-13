/**
 * Smart Money History API
 *
 * GET /api/markets/[condition_id]/smart-money-history?days=30
 *
 * Returns historical smart money odds for charting alongside market price.
 * Data points are hourly snapshots showing:
 * - Smart money odds (what credible traders are betting)
 * - Crowd odds (market price)
 * - Divergence (smart - crowd)
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SmartMoneyDataPoint {
  timestamp: number  // Unix ms for chart compatibility
  crowd_odds: number
  smart_money_odds: number
  divergence: number
  smart_wallet_count: number
  smart_holdings_usd: number
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ condition_id: string }> }
) {
  const startTime = Date.now()

  try {
    const { condition_id } = await params
    const marketId = condition_id.toLowerCase()

    // Validate condition_id format
    if (!/^[a-f0-9]{64}$/i.test(marketId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid condition_id format' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const days = Math.min(parseInt(searchParams.get('days') || '30'), 90)

    // Query historical smart money data
    const query = `
      SELECT
        toUnixTimestamp(ts) * 1000 as timestamp,
        crowd_odds,
        smart_money_odds,
        smart_vs_crowd_delta as divergence,
        smart_wallet_count,
        smart_holdings_usd
      FROM wio_smart_money_history
      WHERE market_id = '${marketId}'
        AND ts >= now() - INTERVAL ${days} DAY
      ORDER BY ts ASC
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })
    const rows = await result.json() as any[]

    const dataPoints: SmartMoneyDataPoint[] = rows.map(row => ({
      timestamp: Number(row.timestamp),
      crowd_odds: round(row.crowd_odds * 100, 1),
      smart_money_odds: round(row.smart_money_odds * 100, 1),
      divergence: round(row.divergence * 100, 1),
      smart_wallet_count: Number(row.smart_wallet_count),
      smart_holdings_usd: round(row.smart_holdings_usd, 0),
    }))

    // Get current snapshot for latest values
    const currentResult = await clickhouse.query({
      query: `
        SELECT
          crowd_odds,
          smart_money_odds,
          smart_vs_crowd_delta,
          smart_wallet_count,
          smart_holdings_usd,
          as_of_ts
        FROM wio_market_snapshots_v1
        WHERE market_id = '${marketId}'
        ORDER BY as_of_ts DESC
        LIMIT 1
      `,
      format: 'JSONEachRow',
    })
    const currentRows = await currentResult.json() as any[]
    const current = currentRows[0]

    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      data: {
        market_id: marketId,
        history: dataPoints,
        current: current ? {
          crowd_odds: round(current.crowd_odds * 100, 1),
          smart_money_odds: round(current.smart_money_odds * 100, 1),
          divergence: round(current.smart_vs_crowd_delta * 100, 1),
          smart_wallet_count: Number(current.smart_wallet_count),
          smart_holdings_usd: round(current.smart_holdings_usd, 0),
          as_of: current.as_of_ts,
        } : null,
        stats: {
          data_points: dataPoints.length,
          days_requested: days,
          oldest: dataPoints.length > 0 ? new Date(dataPoints[0].timestamp).toISOString() : null,
          newest: dataPoints.length > 0 ? new Date(dataPoints[dataPoints.length - 1].timestamp).toISOString() : null,
        },
      },
      meta: {
        durationMs,
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })

  } catch (error: any) {
    console.error('[smart-money-history] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch smart money history',
      },
      { status: 500 }
    )
  }
}

function round(value: any, decimals: number): number {
  const num = Number(value)
  if (!isFinite(num)) return 0
  return parseFloat(num.toFixed(decimals))
}
