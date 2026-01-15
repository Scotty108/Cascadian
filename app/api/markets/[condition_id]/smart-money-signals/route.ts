/**
 * Smart Money Signals API
 *
 * GET /api/markets/[condition_id]/smart-money-signals?days=30
 *
 * Returns historical smart money data with signal detection for charting.
 * Uses validated signal engine to highlight when actionable signals occurred.
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { detectSignal, MarketSnapshot, MarketCategory } from '@/lib/smart-money'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SmartMoneySignalPoint {
  timestamp: number
  crowd_odds: number
  smart_money_odds: number
  divergence: number
  wallet_count: number
  total_usd: number
  flow_24h: number
  // Consensus counts (pure count, no USD weighting)
  sf_yes_count: number
  sf_no_count: number
  smart_yes_count: number
  smart_no_count: number
  elite_yes: number
  elite_no: number
  elite_total: number
  consensus: 'UNANIMOUS_YES' | 'UNANIMOUS_NO' | 'DIVIDED' | 'NONE'
  alignment: number  // 0-1, how aligned elite wallets are
  // Signal detection
  signal_type: string | null
  signal_action: 'BET_YES' | 'BET_NO' | null
  signal_is_fade: boolean
  expected_roi: number | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null
}

const CATEGORY_MAP: Record<string, MarketCategory | null> = {
  tech: 'Tech',
  technology: 'Tech',
  crypto: 'Crypto',
  cryptocurrency: 'Crypto',
  politics: 'Politics',
  political: 'Politics',
  economy: 'Economy',
  economic: 'Economy',
  finance: 'Finance',
  financial: 'Finance',
  culture: 'Culture',
  pop_culture: 'Culture',
  world: 'World',
  global: 'World',
  other: 'Other',
  sports: 'Sports',
}

function normalizeCategory(category: string): MarketCategory | null {
  const normalized = category?.toLowerCase().trim()
  return CATEGORY_MAP[normalized] || null
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

    // First get market metadata for category and end_date
    const metaResult = await clickhouse.query({
      query: `
        SELECT category, end_date
        FROM pm_market_metadata
        WHERE condition_id = '${marketId}'
        LIMIT 1
      `,
      format: 'JSONEachRow',
    })
    const metaRows = await metaResult.json() as any[]
    const metadata = metaRows[0]
    const category = normalizeCategory(metadata?.category || '')
    const endDate = metadata?.end_date ? new Date(metadata.end_date) : null

    // Query historical smart money data from v2 metrics table
    // Use FINAL to get merged ReplacingMergeTree results (needed after backfill)
    const query = `
      SELECT
        toUnixTimestamp(ts) * 1000 as timestamp,
        crowd_price,
        smart_money_odds,
        divergence,
        wallet_count,
        total_usd,
        flow_24h,
        category,
        -- Consensus counts
        sf_yes_count,
        sf_no_count,
        smart_yes_count,
        smart_no_count
      FROM wio_smart_money_metrics_v2 FINAL
      WHERE market_id = '${marketId}'
        AND ts >= now() - INTERVAL ${days} DAY
      ORDER BY ts ASC
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })
    const rows = await result.json() as any[]

    // Process each data point and detect signals
    const dataPoints: SmartMoneySignalPoint[] = rows.map(row => {
      const timestamp = Number(row.timestamp)
      const crowdOdds = row.crowd_price
      const smartMoneyOdds = row.smart_money_odds
      const walletCount = Number(row.wallet_count)
      const totalUsd = Number(row.total_usd)

      // Consensus counts
      const sfYesCount = Number(row.sf_yes_count || 0)
      const sfNoCount = Number(row.sf_no_count || 0)
      const smartYesCount = Number(row.smart_yes_count || 0)
      const smartNoCount = Number(row.smart_no_count || 0)
      const eliteYes = sfYesCount + smartYesCount
      const eliteNo = sfNoCount + smartNoCount
      const eliteTotal = eliteYes + eliteNo

      // Derive consensus state
      let consensus: 'UNANIMOUS_YES' | 'UNANIMOUS_NO' | 'DIVIDED' | 'NONE' = 'NONE'
      if (eliteYes > 0 && eliteNo === 0) {
        consensus = 'UNANIMOUS_YES'
      } else if (eliteNo > 0 && eliteYes === 0) {
        consensus = 'UNANIMOUS_NO'
      } else if (eliteTotal > 0) {
        consensus = 'DIVIDED'
      }

      // Alignment: 0 = evenly split, 1 = all on one side
      const alignment = eliteTotal > 0 ? Math.abs(eliteYes - eliteNo) / eliteTotal : 0

      // Calculate days_before for signal detection
      let daysBefore = 30 // Default if no end date
      if (endDate) {
        const snapshotDate = new Date(timestamp)
        daysBefore = Math.max(0, Math.floor((endDate.getTime() - snapshotDate.getTime()) / (1000 * 60 * 60 * 24)))
      }

      // Build market snapshot for signal detection
      const snapshot: MarketSnapshot | null = category ? {
        market_id: marketId,
        timestamp: new Date(timestamp),
        category,
        smart_money_odds: smartMoneyOdds,
        crowd_price: crowdOdds,
        wallet_count: walletCount,
        total_usd: totalUsd,
        days_before: daysBefore,
      } : null

      // Detect signal
      const signal = snapshot ? detectSignal(snapshot) : null

      return {
        timestamp,
        crowd_odds: round(crowdOdds * 100, 1),
        smart_money_odds: round(smartMoneyOdds * 100, 1),
        divergence: round((smartMoneyOdds - crowdOdds) * 100, 1),
        wallet_count: walletCount,
        total_usd: round(totalUsd, 0),
        flow_24h: round(row.flow_24h || 0, 0),
        // Consensus
        sf_yes_count: sfYesCount,
        sf_no_count: sfNoCount,
        smart_yes_count: smartYesCount,
        smart_no_count: smartNoCount,
        elite_yes: eliteYes,
        elite_no: eliteNo,
        elite_total: eliteTotal,
        consensus,
        alignment: round(alignment, 2),
        // Signal info
        signal_type: signal?.signal_type || null,
        signal_action: signal?.action || null,
        signal_is_fade: signal?.is_fade || false,
        expected_roi: signal ? round(signal.expected_roi * 100, 0) : null,
        confidence: signal?.confidence || null,
      }
    })

    // Find signal occurrences for summary
    const signalOccurrences = dataPoints.filter(p => p.signal_type)
    const signalSummary = signalOccurrences.reduce((acc, p) => {
      if (!p.signal_type) return acc
      if (!acc[p.signal_type]) {
        acc[p.signal_type] = {
          count: 0,
          action: p.signal_action,
          is_fade: p.signal_is_fade,
          expected_roi: p.expected_roi,
          first_seen: p.timestamp,
          last_seen: p.timestamp,
        }
      }
      acc[p.signal_type].count++
      acc[p.signal_type].last_seen = p.timestamp
      return acc
    }, {} as Record<string, any>)

    // Get current values
    const current = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1] : null

    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      data: {
        market_id: marketId,
        category: category || metadata?.category || 'Unknown',
        history: dataPoints,
        current,
        signals: {
          total_occurrences: signalOccurrences.length,
          by_type: signalSummary,
          has_active_signal: current?.signal_type !== null,
        },
        stats: {
          data_points: dataPoints.length,
          days_requested: days,
          oldest: dataPoints.length > 0 ? new Date(dataPoints[0].timestamp).toISOString() : null,
          newest: dataPoints.length > 0 ? new Date(dataPoints[dataPoints.length - 1].timestamp).toISOString() : null,
        },
      },
      meta: { durationMs },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })

  } catch (error: any) {
    console.error('[smart-money-signals] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch smart money signals',
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
