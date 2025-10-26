/**
 * API Route: Get Top Wallets
 * GET /api/wallets/top
 *
 * Returns top-performing wallets ranked by Tier 1 metrics
 *
 * Query params:
 * - window: '30d' | '90d' | '180d' | 'lifetime' (default: 'lifetime')
 * - sortBy: 'omega' | 'pnl' | 'win_rate' | 'ev_per_bet' | 'resolved_bets' (default: 'omega')
 * - sortOrder: 'asc' | 'desc' (default: 'desc')
 * - limit: number (default: 50, max: 500)
 * - offset: number (default: 0)
 * - minTrades: number (default: 10)
 *
 * Response:
 * {
 *   success: true
 *   wallets: WalletMetrics[]
 *   total: number
 *   window: string
 *   sortBy: string
 *   limit: number
 *   offset: number
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type TimeWindow = '30d' | '90d' | '180d' | 'lifetime'
type SortMetric = 'omega' | 'pnl' | 'win_rate' | 'ev_per_bet' | 'resolved_bets'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const window = (searchParams.get('window') || 'lifetime') as TimeWindow
    const sortBy = (searchParams.get('sortBy') || 'omega') as SortMetric
    const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc'
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 500)
    const offset = parseInt(searchParams.get('offset') || '0', 10)
    const minTrades = parseInt(searchParams.get('minTrades') || '10', 10)

    console.log(`[API] GET /api/wallets/top (window: ${window}, sortBy: ${sortBy}, limit: ${limit})`)

    // Validate parameters
    if (!['30d', '90d', '180d', 'lifetime'].includes(window)) {
      return NextResponse.json(
        { error: 'Invalid window. Must be: 30d, 90d, 180d, or lifetime' },
        { status: 400 }
      )
    }

    if (!['omega', 'pnl', 'win_rate', 'ev_per_bet', 'resolved_bets'].includes(sortBy)) {
      return NextResponse.json(
        { error: 'Invalid sortBy. Must be: omega, pnl, win_rate, ev_per_bet, or resolved_bets' },
        { status: 400 }
      )
    }

    // Map sortBy to actual column name
    const sortColumn = getSortColumn(sortBy)

    // Query top wallets
    const walletsQuery = `
      SELECT
        wallet_address,
        window,
        metric_1_omega_gross as omega_gross,
        metric_2_omega_net as omega_net,
        metric_9_net_pnl_usd as net_pnl_usd,
        metric_12_hit_rate as hit_rate,
        metric_13_avg_win_usd as avg_win_usd,
        metric_14_avg_loss_usd as avg_loss_usd,
        metric_15_ev_per_bet_mean as ev_per_bet_mean,
        metric_22_resolved_bets as resolved_bets,
        if(metric_14_avg_loss_usd != 0,
           metric_13_avg_win_usd / abs(metric_14_avg_loss_usd),
           0) as win_loss_ratio,
        0 as total_volume_usd
      FROM wallet_metrics_complete
      WHERE window = {window:String}
        AND metric_22_resolved_bets >= {minTrades:UInt32}
        AND metric_2_omega_net > 0
      ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    `

    const result = await clickhouse.query({
      query: walletsQuery,
      query_params: {
        window,
        minTrades,
        limit,
        offset
      }
    })

    const rows = await result.json()
    const wallets = rows.data || []

    // Get total count (for pagination)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM wallet_metrics_complete
      WHERE window = {window:String}
        AND metric_22_resolved_bets >= {minTrades:UInt32}
        AND metric_2_omega_net > 0
    `

    const countResult = await clickhouse.query({
      query: countQuery,
      query_params: { window, minTrades }
    })

    const countRows = await countResult.json()
    const total = countRows.data?.[0]?.total || 0

    return NextResponse.json({
      success: true,
      wallets,
      total,
      window,
      sortBy,
      sortOrder,
      limit,
      offset,
      metadata: {
        timestamp: new Date().toISOString(),
        min_trades_filter: minTrades
      }
    })

  } catch (error) {
    console.error('[API] Failed to get top wallets:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch top wallets',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

/**
 * Map friendly sort names to actual column names
 */
function getSortColumn(sortBy: SortMetric): string {
  switch (sortBy) {
    case 'omega':
      return 'metric_2_omega_net'
    case 'pnl':
      return 'metric_9_net_pnl_usd'
    case 'win_rate':
      return 'metric_12_hit_rate'
    case 'ev_per_bet':
      return 'metric_15_ev_per_bet_mean'
    case 'resolved_bets':
      return 'metric_22_resolved_bets'
    default:
      return 'metric_2_omega_net'
  }
}
