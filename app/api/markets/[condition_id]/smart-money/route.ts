/**
 * WIO Market Smart Money API Endpoint
 *
 * GET /api/markets/[condition_id]/smart-money
 *
 * Returns smart money signals for a specific market:
 * - Current crowd odds vs smart money odds
 * - Smart wallet count and holdings
 * - Dumb money comparison
 * - Recent dot events for this market
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SmartMoneyPosition {
  wallet_id: string
  side: string
  shares: number
  cost_usd: number
  entry_price: number
  unrealized_pnl: number
  credibility: number
  tier: string
}

interface MarketSmartMoney {
  market_id: string
  market_title: string | null
  snapshot_time: string | null

  // Crowd vs Smart comparison
  crowd_odds: number
  smart_money_odds: number
  dumb_money_odds: number
  smart_vs_crowd_delta: number
  smart_vs_dumb_delta: number

  // Smart money stats
  smart_wallet_count: number
  smart_holdings_usd: number
  smart_holdings_shares: number
  smart_unrealized_roi: number

  // Dumb money stats
  dumb_wallet_count: number
  dumb_holdings_usd: number
  dumb_holdings_shares: number
  dumb_unrealized_roi: number

  // Total market
  total_open_interest_usd: number

  // Signal interpretation
  signal: 'STRONG_YES' | 'LEAN_YES' | 'NEUTRAL' | 'LEAN_NO' | 'STRONG_NO'
  signal_strength: number

  // Top smart money positions
  top_smart_positions: SmartMoneyPosition[]

  // Recent dot events
  recent_dots: {
    wallet_id: string
    side: string
    size_usd: number
    confidence: number
    timestamp: string
  }[]
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ condition_id: string }> }
) {
  const startTime = Date.now()

  try {
    const { condition_id } = await params
    const marketId = condition_id.toLowerCase()

    // Validate condition_id format (64 hex chars)
    if (!/^[a-f0-9]{64}$/i.test(marketId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid condition_id format (expected 64 hex chars)' },
        { status: 400 }
      )
    }

    // Get latest market snapshot
    const snapshotResult = await clickhouse.query({
      query: `
        SELECT
          ms.market_id,
          ms.as_of_ts,
          ms.crowd_odds,
          ms.smart_money_odds,
          ms.dumb_money_odds,
          ms.smart_vs_crowd_delta,
          ms.smart_vs_dumb_delta,
          ms.smart_wallet_count,
          ms.smart_holdings_usd,
          ms.smart_holdings_shares,
          ms.smart_unrealized_roi,
          ms.dumb_wallet_count,
          ms.dumb_holdings_usd,
          ms.dumb_holdings_shares,
          ms.dumb_unrealized_roi,
          ms.total_open_interest_usd,
          m.question as market_title
        FROM wio_market_snapshots_v1 ms
        LEFT JOIN pm_market_metadata m ON ms.market_id = m.condition_id
        WHERE ms.market_id = '${marketId}'
        ORDER BY ms.as_of_ts DESC
        LIMIT 1
      `,
      format: 'JSONEachRow',
    })
    const snapshotRows = await snapshotResult.json() as any[]

    // Get top smart money positions
    const positionsResult = await clickhouse.query({
      query: `
        SELECT
          os.wallet_id,
          os.side,
          os.open_shares_net as shares,
          os.open_cost_usd as cost_usd,
          os.avg_entry_price_side as entry_price,
          os.unrealized_pnl_usd as unrealized_pnl,
          s.credibility_score as credibility,
          wc.tier
        FROM wio_open_snapshots_v1 os
        JOIN wio_wallet_scores_v1 s ON os.wallet_id = s.wallet_id AND s.window_id = 2
        LEFT JOIN wio_wallet_classification_v1 wc ON os.wallet_id = wc.wallet_id AND wc.window_id = 2
        WHERE os.market_id = '${marketId}'
          AND s.credibility_score >= 0.3
          AND s.bot_likelihood < 0.5
        ORDER BY os.as_of_ts DESC, s.credibility_score DESC, os.open_cost_usd DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    })
    const positionRows = await positionsResult.json() as any[]

    // Get recent dot events for this market
    const dotsResult = await clickhouse.query({
      query: `
        SELECT
          wallet_id,
          side,
          size_usd,
          confidence,
          ts as timestamp
        FROM wio_dot_events_v1
        WHERE market_id = '${marketId}'
        ORDER BY ts DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const dotRows = await dotsResult.json() as any[]

    // Build response
    const snapshot = snapshotRows[0]

    if (!snapshot) {
      // No snapshot data - try to get at least basic info
      const basicResult = await clickhouse.query({
        query: `
          SELECT
            m.question as market_title,
            mp.mark_price as crowd_odds
          FROM pm_market_metadata m
          LEFT JOIN pm_latest_mark_price_v1 mp ON m.condition_id = mp.condition_id
          WHERE m.condition_id = '${marketId}'
          LIMIT 1
        `,
        format: 'JSONEachRow',
      })
      const basicRows = await basicResult.json() as any[]
      const basic = basicRows[0]

      return NextResponse.json({
        success: true,
        data: {
          market_id: marketId,
          market_title: basic?.market_title || null,
          snapshot_time: null,
          crowd_odds: round((basic?.crowd_odds || 0.5) * 100, 1),
          smart_money_odds: null,
          dumb_money_odds: null,
          smart_vs_crowd_delta: null,
          smart_vs_dumb_delta: null,
          smart_wallet_count: 0,
          smart_holdings_usd: 0,
          smart_holdings_shares: 0,
          smart_unrealized_roi: null,
          dumb_wallet_count: 0,
          dumb_holdings_usd: 0,
          dumb_holdings_shares: 0,
          dumb_unrealized_roi: null,
          total_open_interest_usd: 0,
          signal: 'NEUTRAL' as const,
          signal_strength: 0,
          top_smart_positions: [],
          recent_dots: [],
        },
        meta: {
          durationMs: Date.now() - startTime,
          note: 'No smart money snapshot available for this market',
        },
      })
    }

    // Calculate signal based on smart vs crowd delta
    const delta = snapshot.smart_vs_crowd_delta || 0
    let signal: MarketSmartMoney['signal'] = 'NEUTRAL'
    let signalStrength = Math.abs(delta)

    if (delta >= 0.15) signal = 'STRONG_YES'
    else if (delta >= 0.05) signal = 'LEAN_YES'
    else if (delta <= -0.15) signal = 'STRONG_NO'
    else if (delta <= -0.05) signal = 'LEAN_NO'
    else signal = 'NEUTRAL'

    const topPositions: SmartMoneyPosition[] = positionRows.map(row => ({
      wallet_id: row.wallet_id,
      side: row.side,
      shares: round(row.shares, 2),
      cost_usd: round(row.cost_usd, 2),
      entry_price: round(row.entry_price * 100, 1),
      unrealized_pnl: round(row.unrealized_pnl, 2),
      credibility: round(row.credibility, 4),
      tier: row.tier || 'unknown',
    }))

    const recentDots = dotRows.map(row => ({
      wallet_id: row.wallet_id,
      side: row.side,
      size_usd: round(row.size_usd, 2),
      confidence: round(row.confidence, 4),
      timestamp: row.timestamp,
    }))

    const result: MarketSmartMoney = {
      market_id: marketId,
      market_title: snapshot.market_title || null,
      snapshot_time: snapshot.as_of_ts,
      crowd_odds: round(snapshot.crowd_odds * 100, 1),
      smart_money_odds: round(snapshot.smart_money_odds * 100, 1),
      dumb_money_odds: round(snapshot.dumb_money_odds * 100, 1),
      smart_vs_crowd_delta: round(snapshot.smart_vs_crowd_delta * 100, 1),
      smart_vs_dumb_delta: round(snapshot.smart_vs_dumb_delta * 100, 1),
      smart_wallet_count: Number(snapshot.smart_wallet_count || 0),
      smart_holdings_usd: round(snapshot.smart_holdings_usd, 2),
      smart_holdings_shares: round(snapshot.smart_holdings_shares, 2),
      smart_unrealized_roi: snapshot.smart_unrealized_roi ? round(snapshot.smart_unrealized_roi * 100, 1) : null,
      dumb_wallet_count: Number(snapshot.dumb_wallet_count || 0),
      dumb_holdings_usd: round(snapshot.dumb_holdings_usd, 2),
      dumb_holdings_shares: round(snapshot.dumb_holdings_shares, 2),
      dumb_unrealized_roi: snapshot.dumb_unrealized_roi ? round(snapshot.dumb_unrealized_roi * 100, 1) : null,
      total_open_interest_usd: round(snapshot.total_open_interest_usd, 2),
      signal,
      signal_strength: round(signalStrength * 100, 1),
      top_smart_positions: topPositions,
      recent_dots: recentDots,
    }

    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        durationMs,
        source: 'wio_v2',
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })

  } catch (error: any) {
    console.error('[market-smart-money] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch market smart money data',
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
