/**
 * API Route: Get TSI Signal for Market
 * GET /api/signals/tsi/[marketId]
 *
 * Returns TSI (True Strength Index) momentum signal with conviction score
 *
 * Query params:
 * - lookbackMinutes: number (default: 1440 = 24 hours)
 * - fresh: boolean - force recalculation (default: false)
 *
 * Response:
 * {
 *   market_id: string
 *   tsi_fast: number
 *   tsi_slow: number
 *   crossover_signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
 *   crossover_timestamp: string | null
 *   directional_conviction: number
 *   elite_consensus_pct: number
 *   category_specialist_pct: number
 *   omega_weighted_consensus: number
 *   meets_entry_threshold: boolean
 *   signal_strength: 'STRONG' | 'MODERATE' | 'WEAK'
 *   updated_at: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { calculateAndSaveTSI } from '@/lib/metrics/tsi-calculator'
import { calculateDirectionalConviction } from '@/lib/metrics/directional-conviction'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  try {
    const { marketId } = await params
    const searchParams = request.nextUrl.searchParams
    const lookbackMinutes = parseInt(searchParams.get('lookbackMinutes') || '1440', 10)
    const fresh = searchParams.get('fresh') === 'true'

    if (!marketId) {
      return NextResponse.json(
        { error: 'Market ID is required' },
        { status: 400 }
      )
    }

    console.log(`[API] GET /api/signals/tsi/${marketId} (lookback: ${lookbackMinutes}min, fresh: ${fresh})`)

    // Check for cached signal (unless fresh requested)
    if (!fresh) {
      const cachedSignal = await getCachedTSISignal(marketId)
      if (cachedSignal) {
        console.log(`[API] Returning cached TSI signal for ${marketId}`)
        return NextResponse.json({
          success: true,
          cached: true,
          ...cachedSignal
        })
      }
    }

    // Calculate TSI
    const tsiResult = await calculateAndSaveTSI(marketId, lookbackMinutes)

    // Get recent trades for conviction calculation
    const recentTrades = await getRecentTrades(marketId, 24) // Last 24 hours

    // Calculate directional conviction
    let conviction = null
    if (tsiResult.crossoverSignal !== 'NEUTRAL' && recentTrades.length > 0) {
      const side = tsiResult.crossoverSignal === 'BULLISH' ? 'YES' : 'NO'

      conviction = await calculateDirectionalConviction({
        marketId,
        conditionId: marketId, // Use marketId as conditionId fallback
        side,
      })
    }

    // Determine signal strength
    const signalStrength = conviction
      ? conviction.directionalConviction >= 0.9
        ? 'STRONG'
        : conviction.directionalConviction >= 0.7
        ? 'MODERATE'
        : 'WEAK'
      : 'WEAK'

    // Build response
    const response = {
      market_id: marketId,
      tsi_fast: tsiResult.tsiFast,
      tsi_slow: tsiResult.tsiSlow,
      crossover_signal: tsiResult.crossoverSignal,
      crossover_timestamp: tsiResult.crossoverTimestamp?.toISOString() || null,
      directional_conviction: conviction?.directionalConviction || 0,
      elite_consensus_pct: conviction?.eliteConsensusPct || 0,
      category_specialist_pct: conviction?.categorySpecialistPct || 0,
      omega_weighted_consensus: conviction?.omegaWeightedConsensus || 0,
      meets_entry_threshold: conviction?.meetsEntryThreshold || false,
      signal_strength: signalStrength,
      updated_at: new Date().toISOString()
    }

    return NextResponse.json({
      success: true,
      cached: false,
      ...response
    })

  } catch (error) {
    console.error('[API] Failed to get TSI signal:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch TSI signal',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

/**
 * Get cached TSI signal from ClickHouse
 */
async function getCachedTSISignal(marketId: string) {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          market_id,
          tsi_fast,
          tsi_slow,
          crossover_signal,
          crossover_timestamp,
          updated_at
        FROM market_price_momentum
        WHERE market_id = {marketId:String}
          AND updated_at > now() - INTERVAL 10 SECOND
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      query_params: { marketId }
    })

    const rows = await result.json() as { data: Array<Record<string, any>> }
    if (rows.data && rows.data.length > 0) {
      const row = rows.data[0]
      return {
        market_id: row.market_id,
        tsi_fast: row.tsi_fast,
        tsi_slow: row.tsi_slow,
        crossover_signal: row.crossover_signal,
        crossover_timestamp: row.crossover_timestamp,
        directional_conviction: 0, // Would need to fetch from momentum_trading_signals
        elite_consensus_pct: 0,
        category_specialist_pct: 0,
        omega_weighted_consensus: 0,
        meets_entry_threshold: false,
        signal_strength: 'WEAK',
        updated_at: row.updated_at
      }
    }

    return null
  } catch (error) {
    console.error('[getCachedTSISignal] Error:', error)
    return null
  }
}

/**
 * Get recent trades for conviction calculation
 */
async function getRecentTrades(marketId: string, hoursAgo: number) {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          side,
          size_usd,
          price,
          timestamp
        FROM trades_raw
        WHERE market_id = {marketId:String}
          AND timestamp > now() - INTERVAL {hoursAgo:UInt32} HOUR
        ORDER BY timestamp DESC
        LIMIT 1000
      `,
      query_params: { marketId, hoursAgo }
    })

    const rows = await result.json() as { data: Array<Record<string, any>> }
    return rows.data || []
  } catch (error) {
    console.error('[getRecentTrades] Error:', error)
    return []
  }
}
