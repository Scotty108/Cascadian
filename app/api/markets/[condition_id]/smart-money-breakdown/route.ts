/**
 * Smart Money Breakdown API
 *
 * GET /api/markets/[condition_id]/smart-money-breakdown
 *
 * Returns detailed smart money analysis for a market:
 * - Entry timeline (when smart money bought, by month)
 * - Top positions (biggest smart money wallets)
 * - P&L status (are they winning/losing)
 * - Conviction metrics (holding strength)
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface EntryMonth {
  month: string
  wallets: number
  total_usd: number
  avg_entry_price: number
  min_entry: number
  max_entry: number
}

interface TopPosition {
  wallet_id: string
  tier: string
  side: string
  shares: number
  cost_usd: number
  avg_entry_price: number
  opened_at: string
  fills_count: number
  unrealized_pnl: number
  roi_percent: number
}

interface SmartMoneyBreakdown {
  market_id: string
  summary: {
    total_wallets: number
    smart_wallets: number
    smart_yes_wallets: number
    smart_no_wallets: number
    total_open_interest_usd: number
    smart_invested_usd: number
    smart_yes_usd: number
    smart_no_usd: number
    smart_money_odds: number
    crowd_odds: number
    divergence: number
  }
  entry_timeline: EntryMonth[]
  top_positions: TopPosition[]
  pnl_status: {
    avg_entry_price: number
    current_price: number
    unrealized_pnl_usd: number
    unrealized_roi_percent: number
    status: 'winning' | 'losing' | 'breakeven'
    exit_count: number
    hold_rate_percent: number
  }
  conviction: {
    score: number // 0-100
    level: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
    factors: string[]
  }
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

    // 1. Get summary stats
    const summaryResult = await clickhouse.query({
      query: `
        SELECT
          countDistinct(p.wallet_id) as total_wallets,
          countDistinctIf(p.wallet_id, wc.tier IN ('superforecaster', 'smart', 'profitable')) as smart_wallets,
          countDistinctIf(p.wallet_id, wc.tier IN ('superforecaster', 'smart', 'profitable') AND p.side = 'YES') as smart_yes_wallets,
          countDistinctIf(p.wallet_id, wc.tier IN ('superforecaster', 'smart', 'profitable') AND p.side = 'NO') as smart_no_wallets,
          round(sum(p.cost_usd), 2) as total_open_interest_usd,
          round(sumIf(p.cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable')), 2) as smart_invested_usd,
          round(sumIf(p.cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND p.side = 'YES'), 2) as smart_yes_usd,
          round(sumIf(p.cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND p.side = 'NO'), 2) as smart_no_usd
        FROM wio_positions_v2 p
        LEFT JOIN wio_wallet_classification_v1 wc ON p.wallet_id = wc.wallet_id AND wc.window_id = 2
        WHERE p.condition_id = '${marketId}'
          AND p.is_resolved = 0
          AND p.qty_shares_remaining > 0
      `,
      format: 'JSONEachRow',
    })
    const summaryRows = await summaryResult.json() as any[]
    const summary = summaryRows[0] || {}

    // Calculate smart money odds
    const smartYes = Number(summary.smart_yes_usd) || 0
    const smartNo = Number(summary.smart_no_usd) || 0
    const smartMoneyOdds = smartYes + smartNo > 0
      ? (smartYes / (smartYes + smartNo)) * 100
      : 50

    // Get current market price
    const priceResult = await clickhouse.query({
      query: `
        SELECT mark_price
        FROM pm_latest_mark_price_v1
        WHERE condition_id = '${marketId}' AND outcome_index = 0
        LIMIT 1
      `,
      format: 'JSONEachRow',
    })
    const priceRows = await priceResult.json() as any[]
    const crowdOdds = (Number(priceRows[0]?.mark_price) || 0.5) * 100

    // 2. Get entry timeline by month
    const timelineResult = await clickhouse.query({
      query: `
        SELECT
          formatDateTime(toStartOfMonth(p.ts_open), '%Y-%m') as month,
          countDistinct(p.wallet_id) as wallets,
          round(sum(p.cost_usd), 0) as total_usd,
          round(avg(p.p_entry_side), 3) as avg_entry_price,
          round(min(p.p_entry_side), 3) as min_entry,
          round(max(p.p_entry_side), 3) as max_entry
        FROM wio_positions_v2 p
        JOIN wio_wallet_classification_v1 wc ON p.wallet_id = wc.wallet_id AND wc.window_id = 2
        WHERE p.condition_id = '${marketId}'
          AND p.is_resolved = 0
          AND p.qty_shares_remaining > 0
          AND wc.tier IN ('superforecaster', 'smart', 'profitable')
        GROUP BY month
        ORDER BY month
      `,
      format: 'JSONEachRow',
    })
    const entryTimeline = (await timelineResult.json() as any[]).map(row => ({
      month: row.month,
      wallets: Number(row.wallets),
      total_usd: Number(row.total_usd),
      avg_entry_price: Number(row.avg_entry_price),
      min_entry: Number(row.min_entry),
      max_entry: Number(row.max_entry),
    }))

    // 3. Get top positions
    const topResult = await clickhouse.query({
      query: `
        SELECT
          p.wallet_id as wallet_id,
          wc.tier as tier,
          p.side as side,
          round(p.qty_shares_remaining, 2) as shares,
          round(p.cost_usd, 2) as cost_usd,
          round(p.p_entry_side, 3) as avg_entry_price,
          formatDateTime(p.ts_open, '%Y-%m-%d') as opened_at,
          p.fills_count,
          -- Calculate unrealized PnL
          round(
            IF(p.side = 'YES',
              (ifNull(mp.mark_price, 0.5) - p.p_entry_side) * p.qty_shares_remaining,
              (p.p_entry_side - ifNull(mp.mark_price, 0.5)) * p.qty_shares_remaining
            ), 2
          ) as unrealized_pnl,
          round(
            IF(p.cost_usd > 0,
              IF(p.side = 'YES',
                ((ifNull(mp.mark_price, 0.5) - p.p_entry_side) * p.qty_shares_remaining / p.cost_usd) * 100,
                ((p.p_entry_side - ifNull(mp.mark_price, 0.5)) * p.qty_shares_remaining / p.cost_usd) * 100
              ),
              0
            ), 1
          ) as roi_percent
        FROM wio_positions_v2 p
        JOIN wio_wallet_classification_v1 wc ON p.wallet_id = wc.wallet_id AND wc.window_id = 2
        LEFT JOIN pm_latest_mark_price_v1 mp ON p.condition_id = mp.condition_id AND mp.outcome_index = 0
        WHERE p.condition_id = '${marketId}'
          AND p.is_resolved = 0
          AND p.qty_shares_remaining > 0
          AND wc.tier IN ('superforecaster', 'smart', 'profitable')
        ORDER BY p.cost_usd DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const topPositions = (await topResult.json() as any[]).map(row => ({
      wallet_id: row.wallet_id,
      tier: row.tier,
      side: row.side,
      shares: Number(row.shares),
      cost_usd: Number(row.cost_usd),
      avg_entry_price: Number(row.avg_entry_price),
      opened_at: row.opened_at,
      fills_count: Number(row.fills_count),
      unrealized_pnl: Number(row.unrealized_pnl),
      roi_percent: Number(row.roi_percent),
    }))

    // 4. Calculate P&L status
    const pnlResult = await clickhouse.query({
      query: `
        SELECT
          round(avgIf(p.p_entry_side, wc.tier IN ('superforecaster', 'smart', 'profitable')), 4) as avg_entry,
          round(sumIf(
            IF(p.side = 'YES',
              (ifNull(mp.mark_price, 0.5) - p.p_entry_side) * p.qty_shares_remaining,
              (p.p_entry_side - ifNull(mp.mark_price, 0.5)) * p.qty_shares_remaining
            ),
            wc.tier IN ('superforecaster', 'smart', 'profitable')
          ), 2) as total_unrealized_pnl
        FROM wio_positions_v2 p
        LEFT JOIN wio_wallet_classification_v1 wc ON p.wallet_id = wc.wallet_id AND wc.window_id = 2
        LEFT JOIN pm_latest_mark_price_v1 mp ON p.condition_id = mp.condition_id AND mp.outcome_index = 0
        WHERE p.condition_id = '${marketId}'
          AND p.is_resolved = 0
          AND p.qty_shares_remaining > 0
      `,
      format: 'JSONEachRow',
    })
    const pnlRows = await pnlResult.json() as any[]
    const avgEntry = Number(pnlRows[0]?.avg_entry) || 0.5
    const totalUnrealizedPnl = Number(pnlRows[0]?.total_unrealized_pnl) || 0
    const smartInvested = Number(summary.smart_invested_usd) || 1
    const unrealizedRoi = (totalUnrealizedPnl / smartInvested) * 100

    const currentPrice = crowdOdds / 100
    let pnlStatus: 'winning' | 'losing' | 'breakeven' = 'breakeven'
    if (unrealizedRoi > 2) pnlStatus = 'winning'
    else if (unrealizedRoi < -2) pnlStatus = 'losing'

    // 5. Calculate conviction score
    const smartWallets = Number(summary.smart_wallets) || 0
    const smartInvestedUsd = Number(summary.smart_invested_usd) || 0
    const divergence = smartMoneyOdds - crowdOdds

    let convictionScore = 50 // Base score
    const factors: string[] = []

    // Factor 1: Number of smart wallets (more wallets = higher conviction)
    if (smartWallets >= 100) {
      convictionScore += 15
      factors.push(`${smartWallets} smart wallets participating`)
    } else if (smartWallets >= 50) {
      convictionScore += 10
      factors.push(`${smartWallets} smart wallets participating`)
    } else if (smartWallets >= 20) {
      convictionScore += 5
      factors.push(`${smartWallets} smart wallets participating`)
    }

    // Factor 2: Total invested (more $ = higher conviction)
    if (smartInvestedUsd >= 1000000) {
      convictionScore += 15
      factors.push(`$${(smartInvestedUsd / 1000000).toFixed(1)}M invested`)
    } else if (smartInvestedUsd >= 100000) {
      convictionScore += 10
      factors.push(`$${(smartInvestedUsd / 1000).toFixed(0)}K invested`)
    }

    // Factor 3: Consensus (all on same side = higher conviction)
    const yesPercent = smartYes / (smartYes + smartNo + 0.01) * 100
    if (yesPercent >= 95 || yesPercent <= 5) {
      convictionScore += 15
      factors.push('100% consensus on one side')
    } else if (yesPercent >= 80 || yesPercent <= 20) {
      convictionScore += 10
      factors.push(`${Math.max(yesPercent, 100 - yesPercent).toFixed(0)}% consensus`)
    }

    // Factor 4: Divergence from crowd (bigger divergence = stronger signal)
    if (Math.abs(divergence) >= 30) {
      convictionScore += 10
      factors.push(`${Math.abs(divergence).toFixed(0)}pt divergence from crowd`)
    } else if (Math.abs(divergence) >= 15) {
      convictionScore += 5
      factors.push(`${Math.abs(divergence).toFixed(0)}pt divergence from crowd`)
    }

    // Factor 5: Holding through drawdown (still holding when underwater = conviction)
    if (pnlStatus === 'losing' && smartWallets > 10) {
      convictionScore += 5
      factors.push('Holding despite being underwater')
    }

    // Cap at 100
    convictionScore = Math.min(100, convictionScore)

    let convictionLevel: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
    if (convictionScore >= 85) convictionLevel = 'very_high'
    else if (convictionScore >= 70) convictionLevel = 'high'
    else if (convictionScore >= 55) convictionLevel = 'medium'
    else if (convictionScore >= 40) convictionLevel = 'low'
    else convictionLevel = 'very_low'

    const breakdown: SmartMoneyBreakdown = {
      market_id: marketId,
      summary: {
        total_wallets: Number(summary.total_wallets) || 0,
        smart_wallets: smartWallets,
        smart_yes_wallets: Number(summary.smart_yes_wallets) || 0,
        smart_no_wallets: Number(summary.smart_no_wallets) || 0,
        total_open_interest_usd: Number(summary.total_open_interest_usd) || 0,
        smart_invested_usd: smartInvestedUsd,
        smart_yes_usd: smartYes,
        smart_no_usd: smartNo,
        smart_money_odds: Math.round(smartMoneyOdds * 10) / 10,
        crowd_odds: Math.round(crowdOdds * 10) / 10,
        divergence: Math.round((smartMoneyOdds - crowdOdds) * 10) / 10,
      },
      entry_timeline: entryTimeline,
      top_positions: topPositions,
      pnl_status: {
        avg_entry_price: avgEntry,
        current_price: currentPrice,
        unrealized_pnl_usd: totalUnrealizedPnl,
        unrealized_roi_percent: Math.round(unrealizedRoi * 10) / 10,
        status: pnlStatus,
        exit_count: 0, // Would need to track exits separately
        hold_rate_percent: 100, // Assuming all still holding
      },
      conviction: {
        score: convictionScore,
        level: convictionLevel,
        factors,
      },
    }

    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      data: breakdown,
      meta: { durationMs },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    })

  } catch (error: any) {
    console.error('[smart-money-breakdown] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch smart money breakdown' },
      { status: 500 }
    )
  }
}
