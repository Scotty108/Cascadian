/**
 * Copy Targets API
 *
 * GET /api/wallets/copy-targets?limit=50&min_credibility=0.3
 *
 * Returns wallets ranked by copyability score - the best candidates
 * for copy trading based on:
 * - Reasonable hold times (not scalping)
 * - Manageable drawdowns
 * - Good win rates
 * - Not too high frequency (can actually follow)
 *
 * Combined with credibility to ensure they're actually profitable.
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface CopyTarget {
  rank: number
  wallet_id: string
  tier: string

  // Core scores
  copyability: number
  credibility: number
  bot_likelihood: number

  // Why they're copyable
  hold_hours_p50: number | null
  fills_per_day: number
  max_drawdown_pct: number | null

  // Performance
  pnl_usd: number
  roi_pct: number
  win_rate_pct: number
  positions: number
  resolved_positions: number

  // Recent activity
  active_days: number
  days_since_last_trade: number | null
}

export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const minCopyability = parseFloat(searchParams.get('min_copyability') || '0.5')
    const minCredibility = parseFloat(searchParams.get('min_credibility') || '0.3')
    const maxBot = parseFloat(searchParams.get('max_bot') || '0.5')
    const minPositions = parseInt(searchParams.get('min_positions') || '20')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

    // Query top copy targets
    const query = `
      SELECT
        s.wallet_id as wallet_id,
        wc.tier as tier,
        s.copyability_score as copyability_score,
        s.credibility_score as credibility_score,
        s.bot_likelihood as bot_likelihood,
        m90.hold_minutes_p50 as hold_minutes_p50,
        m90.fills_per_day as fills_per_day,
        m90.max_loss_roi as max_loss_roi,
        mAll.pnl_total_usd as pnl_total_usd,
        mAll.roi_cost_weighted as roi_cost_weighted,
        mAll.win_rate as win_rate,
        mAll.positions_n as positions_n,
        mAll.resolved_positions_n as resolved_positions_n,
        mAll.active_days_n as active_days_n,
        m90.days_since_last_trade as days_since_last_trade
      FROM wio_wallet_scores_v1 s
      JOIN wio_metric_observations_v1 m90
        ON s.wallet_id = m90.wallet_id
        AND m90.scope_type = 'GLOBAL'
        AND m90.window_id = 2  -- 90d window
      JOIN wio_metric_observations_v1 mAll
        ON s.wallet_id = mAll.wallet_id
        AND mAll.scope_type = 'GLOBAL'
        AND mAll.window_id = 1  -- ALL window for lifetime stats
      LEFT JOIN (
        SELECT wallet_id, argMax(tier, computed_at) as tier
        FROM wio_wallet_classification_v1
        WHERE window_id = 2
        GROUP BY wallet_id
      ) wc ON s.wallet_id = wc.wallet_id
      WHERE s.window_id = 2
        AND s.copyability_score >= ${minCopyability}
        AND s.credibility_score >= ${minCredibility}
        AND s.bot_likelihood <= ${maxBot}
        AND mAll.positions_n >= ${minPositions}
        AND mAll.pnl_total_usd > 0  -- Only profitable wallets
      ORDER BY s.copyability_score DESC, s.credibility_score DESC
      LIMIT ${limit}
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })
    const rows = await result.json() as any[]

    // Transform results
    const targets: CopyTarget[] = rows.map((row, index) => ({
      rank: index + 1,
      wallet_id: row.wallet_id,
      tier: row.tier || 'unknown',
      copyability: round(row.copyability_score, 4),
      credibility: round(row.credibility_score, 4),
      bot_likelihood: round(row.bot_likelihood, 4),
      hold_hours_p50: row.hold_minutes_p50 > 0 ? round(row.hold_minutes_p50 / 60, 1) : null,
      fills_per_day: round(row.fills_per_day, 1),
      max_drawdown_pct: row.max_loss_roi ? round(row.max_loss_roi * 100, 1) : null,
      pnl_usd: round(row.pnl_total_usd, 0),
      roi_pct: round(row.roi_cost_weighted * 100, 1),
      win_rate_pct: round(row.win_rate * 100, 1),
      positions: Number(row.positions_n),
      resolved_positions: Number(row.resolved_positions_n),
      active_days: Number(row.active_days_n),
      days_since_last_trade: Number(row.days_since_last_trade) || null,
    }))

    // Compute tier distribution
    const tierCounts: Record<string, number> = {}
    for (const t of targets) {
      tierCounts[t.tier] = (tierCounts[t.tier] || 0) + 1
    }

    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      data: {
        targets,
        summary: {
          total: targets.length,
          avg_copyability: targets.length > 0
            ? round(targets.reduce((sum, t) => sum + t.copyability, 0) / targets.length, 3)
            : 0,
          avg_credibility: targets.length > 0
            ? round(targets.reduce((sum, t) => sum + t.credibility, 0) / targets.length, 3)
            : 0,
          avg_hold_hours: targets.filter(t => t.hold_hours_p50).length > 0
            ? round(
                targets.filter(t => t.hold_hours_p50).reduce((sum, t) => sum + (t.hold_hours_p50 || 0), 0) /
                targets.filter(t => t.hold_hours_p50).length,
                1
              )
            : null,
          tier_distribution: tierCounts,
        },
      },
      meta: {
        durationMs,
        filters: {
          min_copyability: minCopyability,
          min_credibility: minCredibility,
          max_bot: maxBot,
          min_positions: minPositions,
          limit,
        },
        description: 'Wallets ranked by copyability - best candidates for copy trading',
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })

  } catch (error: any) {
    console.error('[copy-targets] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch copy targets',
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
