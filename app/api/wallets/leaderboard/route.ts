/**
 * WIO Wallet Leaderboard API Endpoint
 *
 * GET /api/wallets/leaderboard?tier=superforecaster&limit=100&min_positions=10
 *
 * Returns top wallets by credibility score:
 * - Filterable by tier, min positions
 * - PnL, win rate, ROI metrics
 * - Sorted by credibility (default) or other metrics
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface LeaderboardEntry {
  rank: number
  wallet_id: string
  tier: string
  credibility: number
  bot_likelihood: number
  copyability: number
  positions: number
  resolved_positions: number
  pnl_usd: number
  roi_pct: number
  win_rate_pct: number
  profit_factor: number | null
  hold_hours_p50: number | null
  active_days: number
}

const VALID_TIERS = ['superforecaster', 'smart', 'profitable', 'slight_loser', 'heavy_loser', 'bot', 'inactive']
const VALID_SORT_BY = ['credibility', 'pnl', 'roi', 'win_rate', 'positions']

export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const tier = searchParams.get('tier') // Filter by tier
    const minPositions = parseInt(searchParams.get('min_positions') || '10')
    const minPnl = parseFloat(searchParams.get('min_pnl') || '0')
    const maxBot = parseFloat(searchParams.get('max_bot') || '0.5')
    const sortBy = searchParams.get('sort_by') || 'credibility'
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)

    // Validate tier
    if (tier && !VALID_TIERS.includes(tier)) {
      return NextResponse.json(
        { success: false, error: `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate sort_by
    if (!VALID_SORT_BY.includes(sortBy)) {
      return NextResponse.json(
        { success: false, error: `Invalid sort_by. Must be one of: ${VALID_SORT_BY.join(', ')}` },
        { status: 400 }
      )
    }

    // Build WHERE clauses
    const conditions: string[] = [
      's.window_id = 2', // 90d window
      `s.bot_likelihood <= ${maxBot}`,
      `mAll.positions_n >= ${minPositions}`,
    ]

    if (tier) {
      conditions.push(`wc.tier = '${tier}'`)
    }

    if (minPnl > 0) {
      conditions.push(`mAll.pnl_total_usd >= ${minPnl}`)
    }

    // Build ORDER BY
    const orderMap: Record<string, string> = {
      credibility: 's.credibility_score DESC',
      pnl: 'mAll.pnl_total_usd DESC',
      roi: 'mAll.roi_cost_weighted DESC',
      win_rate: 'mAll.win_rate DESC',
      positions: 'mAll.positions_n DESC',
    }
    const orderBy = orderMap[sortBy]

    // Query leaderboard
    const query = `
      SELECT
        s.wallet_id,
        wc.tier,
        s.credibility_score,
        s.bot_likelihood,
        s.copyability_score,
        mAll.positions_n,
        mAll.resolved_positions_n,
        mAll.pnl_total_usd,
        mAll.roi_cost_weighted,
        mAll.win_rate,
        mAll.profit_factor,
        mAll.hold_minutes_p50,
        mAll.active_days_n
      FROM wio_wallet_scores_v1 s
      JOIN wio_metric_observations_v1 mAll
        ON s.wallet_id = mAll.wallet_id
        AND mAll.scope_type = 'GLOBAL'
        AND mAll.window_id = 1  -- ALL window for lifetime stats
      LEFT JOIN wio_wallet_classification_v1 wc
        ON s.wallet_id = wc.wallet_id
        AND wc.window_id = 2
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ${limit}
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })
    const rows = await result.json() as any[]

    // Transform results with ranking
    const entries: LeaderboardEntry[] = rows.map((row, index) => ({
      rank: index + 1,
      wallet_id: row.wallet_id,
      tier: row.tier || 'unknown',
      credibility: round(row.credibility_score, 4),
      bot_likelihood: round(row.bot_likelihood, 4),
      copyability: round(row.copyability_score, 4),
      positions: Number(row.positions_n),
      resolved_positions: Number(row.resolved_positions_n),
      pnl_usd: round(row.pnl_total_usd, 2),
      roi_pct: round(row.roi_cost_weighted * 100, 2),
      win_rate_pct: round(row.win_rate * 100, 1),
      profit_factor: row.profit_factor > 0 && row.profit_factor < 999 ? round(row.profit_factor, 2) : null,
      hold_hours_p50: row.hold_minutes_p50 > 0 ? round(row.hold_minutes_p50 / 60, 1) : null,
      active_days: Number(row.active_days_n),
    }))

    // Get tier distribution for context
    const tierQuery = `
      SELECT
        wc.tier,
        count() as count,
        round(avg(s.credibility_score), 4) as avg_credibility,
        round(avg(mAll.pnl_total_usd), 0) as avg_pnl
      FROM wio_wallet_scores_v1 s
      JOIN wio_metric_observations_v1 mAll
        ON s.wallet_id = mAll.wallet_id
        AND mAll.scope_type = 'GLOBAL'
        AND mAll.window_id = 1
      LEFT JOIN wio_wallet_classification_v1 wc
        ON s.wallet_id = wc.wallet_id
        AND wc.window_id = 2
      WHERE s.window_id = 2
        AND s.bot_likelihood <= ${maxBot}
        AND mAll.positions_n >= ${minPositions}
      GROUP BY wc.tier
      ORDER BY avg_credibility DESC
    `
    const tierResult = await clickhouse.query({
      query: tierQuery,
      format: 'JSONEachRow',
    })
    const tierDistribution = await tierResult.json() as any[]

    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      data: {
        entries,
        tier_distribution: tierDistribution.map(t => ({
          tier: t.tier || 'unknown',
          count: Number(t.count),
          avg_credibility: round(t.avg_credibility, 4),
          avg_pnl: Number(t.avg_pnl),
        })),
      },
      meta: {
        durationMs,
        filters: {
          tier: tier || 'all',
          min_positions: minPositions,
          min_pnl: minPnl,
          max_bot: maxBot,
          sort_by: sortBy,
          limit,
        },
        total_returned: entries.length,
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })

  } catch (error: any) {
    console.error('[leaderboard] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch leaderboard',
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
