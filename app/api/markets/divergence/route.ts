/**
 * Market Divergence API
 *
 * GET /api/markets/divergence?min_delta=5&limit=50
 *
 * Returns markets where smart money odds differ significantly from crowd odds.
 * Useful for finding contrarian opportunities where experienced traders
 * disagree with the market consensus.
 *
 * Positive delta = smart money more bullish than crowd
 * Negative delta = smart money more bearish than crowd
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DivergentMarket {
  market_id: string
  market_title: string | null
  crowd_odds: number
  smart_money_odds: number
  dumb_money_odds: number
  smart_vs_crowd_delta: number
  smart_vs_dumb_delta: number
  smart_wallet_count: number
  smart_holdings_usd: number
  dumb_wallet_count: number
  total_open_interest_usd: number
  signal: 'STRONG_YES' | 'LEAN_YES' | 'NEUTRAL' | 'LEAN_NO' | 'STRONG_NO'
  snapshot_time: string
}

export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const minDelta = parseFloat(searchParams.get('min_delta') || '5') / 100 // Convert % to decimal
    const minSmartWallets = parseInt(searchParams.get('min_smart_wallets') || '3')
    const minOpenInterest = parseFloat(searchParams.get('min_oi') || '1000')
    const direction = searchParams.get('direction') // 'bullish', 'bearish', or null for both
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

    // Build WHERE conditions
    const conditions: string[] = [
      `abs(ms.smart_vs_crowd_delta) >= ${minDelta}`,
      `ms.smart_wallet_count >= ${minSmartWallets}`,
      `ms.total_open_interest_usd >= ${minOpenInterest}`,
    ]

    if (direction === 'bullish') {
      conditions.push('ms.smart_vs_crowd_delta > 0')
    } else if (direction === 'bearish') {
      conditions.push('ms.smart_vs_crowd_delta < 0')
    }

    // Query markets with significant divergence
    const query = `
      SELECT
        ms.market_id,
        m.question as market_title,
        ms.crowd_odds,
        ms.smart_money_odds,
        ms.dumb_money_odds,
        ms.smart_vs_crowd_delta,
        ms.smart_vs_dumb_delta,
        ms.smart_wallet_count,
        ms.smart_holdings_usd,
        ms.dumb_wallet_count,
        ms.total_open_interest_usd,
        ms.as_of_ts as snapshot_time
      FROM wio_market_snapshots_v1 ms
      LEFT JOIN pm_market_metadata m ON ms.market_id = m.condition_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY abs(ms.smart_vs_crowd_delta) DESC
      LIMIT ${limit}
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })
    const rows = await result.json() as any[]

    // Transform results
    const markets: DivergentMarket[] = rows.map(row => {
      const delta = row.smart_vs_crowd_delta || 0
      let signal: DivergentMarket['signal'] = 'NEUTRAL'

      if (delta >= 0.15) signal = 'STRONG_YES'
      else if (delta >= 0.05) signal = 'LEAN_YES'
      else if (delta <= -0.15) signal = 'STRONG_NO'
      else if (delta <= -0.05) signal = 'LEAN_NO'

      return {
        market_id: row.market_id,
        market_title: row.market_title || null,
        crowd_odds: round(row.crowd_odds * 100, 1),
        smart_money_odds: round(row.smart_money_odds * 100, 1),
        dumb_money_odds: round(row.dumb_money_odds * 100, 1),
        smart_vs_crowd_delta: round(row.smart_vs_crowd_delta * 100, 1),
        smart_vs_dumb_delta: round(row.smart_vs_dumb_delta * 100, 1),
        smart_wallet_count: Number(row.smart_wallet_count),
        smart_holdings_usd: round(row.smart_holdings_usd, 0),
        dumb_wallet_count: Number(row.dumb_wallet_count),
        total_open_interest_usd: round(row.total_open_interest_usd, 0),
        signal,
        snapshot_time: row.snapshot_time,
      }
    })

    // Summary stats
    const bullishCount = markets.filter(m => m.smart_vs_crowd_delta > 0).length
    const bearishCount = markets.filter(m => m.smart_vs_crowd_delta < 0).length

    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      data: {
        markets,
        summary: {
          total: markets.length,
          bullish_divergence: bullishCount,
          bearish_divergence: bearishCount,
          avg_abs_delta: markets.length > 0
            ? round(markets.reduce((sum, m) => sum + Math.abs(m.smart_vs_crowd_delta), 0) / markets.length, 1)
            : 0,
        },
      },
      meta: {
        durationMs,
        filters: {
          min_delta_pct: minDelta * 100,
          min_smart_wallets: minSmartWallets,
          min_open_interest: minOpenInterest,
          direction: direction || 'all',
          limit,
        },
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })

  } catch (error: any) {
    console.error('[market-divergence] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch divergent markets',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
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
