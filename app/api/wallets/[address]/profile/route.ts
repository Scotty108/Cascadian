/**
 * WIO Wallet Profile API Endpoint
 *
 * GET /api/wallets/[address]/profile
 *
 * Returns comprehensive wallet intelligence data:
 * - Wallet metrics across all windows (ALL, 90d, 30d, 14d, 7d, 1d)
 * - Credibility, bot likelihood, copyability scores
 * - Tier classification
 * - Open positions summary
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Window enum values (ClickHouse Enum8)
const WINDOW_LABELS: Record<string, string> = {
  'ALL': 'ALL',
  '90d': '90d',
  '30d': '30d',
  '14d': '14d',
  '7d': '7d',
  '1d': '1d',
}

interface WalletMetrics {
  window: string
  positions_n: number
  resolved_positions_n: number
  pnl_usd: number
  roi: number
  win_rate: number
  profit_factor: number | null
  position_cost_p50: number
  brier_mean: number | null
  hold_minutes_p50: number | null
  active_days: number
  fills_per_day: number
  max_loss_roi: number | null
}

interface WalletScores {
  credibility: number
  bot_likelihood: number
  copyability: number
  skill_component: number
  consistency_component: number
  sample_size_factor: number
}

interface OpenPosition {
  market_id: string
  side: string
  shares: number
  cost_usd: number
  entry_price: number
  mark_price: number
  unrealized_pnl: number
  unrealized_roi: number
}

interface WalletProfile {
  wallet_address: string
  tier: string | null
  tier_label: string
  metrics: WalletMetrics[]
  scores: WalletScores | null
  open_positions: {
    count: number
    total_cost_usd: number
    total_unrealized_pnl: number
    positions: OpenPosition[]
  }
  computed_at: string
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const startTime = Date.now()

  try {
    const { address } = await params
    const walletAddress = address.toLowerCase()

    // Validate address format
    if (!/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet address format' },
        { status: 400 }
      )
    }

    // Fetch metrics across all windows
    const metricsResult = await clickhouse.query({
      query: `
        SELECT
          toString(window_id) as window_id,
          positions_n,
          resolved_positions_n,
          pnl_total_usd,
          roi_cost_weighted,
          win_rate,
          profit_factor,
          position_cost_p50,
          brier_mean,
          hold_minutes_p50,
          active_days_n,
          fills_per_day,
          max_loss_roi
        FROM wio_metric_observations_v1
        WHERE wallet_id = '${walletAddress}'
          AND scope_type = 'GLOBAL'
        ORDER BY window_id
      `,
      format: 'JSONEachRow',
    })
    const metricsRows = await metricsResult.json() as any[]

    // Fetch wallet scores (90d window)
    const scoresResult = await clickhouse.query({
      query: `
        SELECT
          credibility_score,
          bot_likelihood,
          copyability_score,
          skill_component,
          consistency_component,
          sample_size_factor
        FROM wio_wallet_scores_v1
        WHERE wallet_id = '${walletAddress}'
          AND window_id = 2
        LIMIT 1
      `,
      format: 'JSONEachRow',
    })
    const scoresRows = await scoresResult.json() as any[]

    // Fetch wallet tier classification (90d window)
    const tierResult = await clickhouse.query({
      query: `
        SELECT tier
        FROM wio_wallet_classification_v1
        WHERE wallet_id = '${walletAddress}'
          AND window_id = 2
        LIMIT 1
      `,
      format: 'JSONEachRow',
    })
    const tierRows = await tierResult.json() as any[]

    // Fetch open positions (latest snapshot)
    const openResult = await clickhouse.query({
      query: `
        SELECT
          market_id,
          side,
          open_shares_net as shares,
          open_cost_usd as cost_usd,
          avg_entry_price_side as entry_price,
          mark_price_side as mark_price,
          unrealized_pnl_usd as unrealized_pnl,
          unrealized_roi
        FROM wio_open_snapshots_v1
        WHERE wallet_id = '${walletAddress}'
        ORDER BY as_of_ts DESC, open_cost_usd DESC
        LIMIT 100
      `,
      format: 'JSONEachRow',
    })
    const openRows = await openResult.json() as any[]

    // Build metrics array
    const metrics: WalletMetrics[] = metricsRows.map((row: any) => ({
      window: WINDOW_LABELS[row.window_id] || row.window_id,
      positions_n: Number(row.positions_n),
      resolved_positions_n: Number(row.resolved_positions_n),
      pnl_usd: round(row.pnl_total_usd, 2),
      roi: round(row.roi_cost_weighted * 100, 2), // Convert to percentage
      win_rate: round(row.win_rate * 100, 1), // Convert to percentage
      profit_factor: row.profit_factor && row.profit_factor > 0 ? round(row.profit_factor, 2) : null,
      position_cost_p50: round(row.position_cost_p50, 2),
      brier_mean: row.brier_mean && row.brier_mean > 0 ? round(row.brier_mean, 4) : null,
      hold_minutes_p50: row.hold_minutes_p50 ? round(row.hold_minutes_p50, 0) : null,
      active_days: Number(row.active_days_n),
      fills_per_day: round(row.fills_per_day, 2),
      max_loss_roi: row.max_loss_roi ? round(row.max_loss_roi * 100, 1) : null,
    }))

    // Build scores object
    const scores: WalletScores | null = scoresRows.length > 0 ? {
      credibility: round(scoresRows[0].credibility_score, 4),
      bot_likelihood: round(scoresRows[0].bot_likelihood, 4),
      copyability: round(scoresRows[0].copyability_score, 4),
      skill_component: round(scoresRows[0].skill_component, 4),
      consistency_component: round(scoresRows[0].consistency_component, 4),
      sample_size_factor: round(scoresRows[0].sample_size_factor, 4),
    } : null

    // Get tier
    const tier = tierRows.length > 0 ? tierRows[0].tier : null

    // Build open positions
    const openPositions: OpenPosition[] = openRows.map((row: any) => ({
      market_id: row.market_id,
      side: row.side,
      shares: round(row.shares, 2),
      cost_usd: round(row.cost_usd, 2),
      entry_price: round(row.entry_price, 4),
      mark_price: round(row.mark_price, 4),
      unrealized_pnl: round(row.unrealized_pnl, 2),
      unrealized_roi: round(row.unrealized_roi * 100, 2), // Convert to percentage
    }))

    // Calculate open position totals
    const totalOpenCost = openPositions.reduce((sum, p) => sum + p.cost_usd, 0)
    const totalUnrealizedPnl = openPositions.reduce((sum, p) => sum + p.unrealized_pnl, 0)

    // Build response
    const profile: WalletProfile = {
      wallet_address: walletAddress,
      tier,
      tier_label: getTierLabel(tier),
      metrics,
      scores,
      open_positions: {
        count: openPositions.length,
        total_cost_usd: round(totalOpenCost, 2),
        total_unrealized_pnl: round(totalUnrealizedPnl, 2),
        positions: openPositions.slice(0, 20), // Return top 20 by cost
      },
      computed_at: new Date().toISOString(),
    }

    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      data: profile,
      meta: {
        durationMs,
        source: 'wio_v2',
        windows_available: Object.values(WINDOW_LABELS),
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })

  } catch (error: any) {
    console.error('[wallet-profile] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch wallet profile',
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

// Helper to get tier label
function getTierLabel(tier: string | null): string {
  const labels: Record<string, string> = {
    superforecaster: 'Superforecaster',
    smart: 'Smart Money',
    profitable: 'Profitable',
    slight_loser: 'Slight Loser',
    heavy_loser: 'Heavy Loser',
    bot: 'Bot/MM',
    inactive: 'Inactive',
  }
  return tier ? labels[tier] || tier : 'Unknown'
}
