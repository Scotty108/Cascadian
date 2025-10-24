/**
 * Market SII (Signal Intelligence Index) API Endpoint
 *
 * Calculates real-time SII based on holder position distribution
 *
 * MVP Implementation: Uses position size as proxy for "smartness"
 * - Larger positions = higher implicit whale score
 * - Concentration of large holders = higher SII
 *
 * SII = concentration-weighted position score (0-100)
 *
 * Future: Will use real wallet_scores from database once populated
 *
 * GET /api/markets/[id]/sii?conditionId=0x...
 */

import { NextRequest, NextResponse } from 'next/server'

/**
 * Calculate whale score based on position size relative to market
 * Larger positions get higher scores (logarithmic scale)
 */
function calculateImplicitWhaleScore(shares: number, totalShares: number): number {
  const marketShare = shares / totalShares

  // Logarithmic scoring:
  // 0.1% = 20pts, 1% = 50pts, 10% = 80pts, 50%+ = 100pts
  const score = Math.min(100, 20 + (Math.log10(marketShare * 100 + 1) * 30))

  return Math.max(0, Math.min(100, score))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: marketId } = await params
  const { searchParams } = new URL(request.url)
  const conditionId = searchParams.get('conditionId')

  if (!conditionId) {
    return NextResponse.json(
      { success: false, error: 'conditionId query parameter required' },
      { status: 400 }
    )
  }

  try {
    console.log(`[SII API] Calculating SII for market: ${marketId}`)

    // Fetch holders from Polymarket Data API
    const holdersResponse = await fetch(
      `http://localhost:3000/api/polymarket/holders?conditionId=${conditionId}&limit=100`
    )

    if (!holdersResponse.ok) {
      throw new Error('Failed to fetch holders data')
    }

    const holdersData = await holdersResponse.json()
    const yesHolders = holdersData.data?.yes || []

    if (yesHolders.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          market_id: marketId,
          condition_id: conditionId,
          sii_score: 50, // Neutral score when no data
          holder_count: 0,
          message: 'No holder data available - using neutral SII'
        }
      })
    }

    // Calculate total shares
    const totalShares = yesHolders.reduce((sum: number, h: any) =>
      sum + parseFloat(h.position_shares || 0), 0
    )

    // Calculate implicit whale scores and weighted SII
    let totalWeightedScore = 0
    let totalUnweightedScore = 0

    const holderScores = yesHolders.map((holder: any) => {
      const shares = parseFloat(holder.position_shares || 0)
      const whaleScore = calculateImplicitWhaleScore(shares, totalShares)

      totalWeightedScore += shares * whaleScore
      totalUnweightedScore += whaleScore

      return {
        wallet_alias: holder.wallet_alias,
        shares: Math.round(shares * 100) / 100,
        whale_score: Math.round(whaleScore * 100) / 100,
        market_share_pct: Math.round((shares / totalShares) * 10000) / 100
      }
    })

    const siiScore = totalShares > 0 ? totalWeightedScore / totalShares : 50
    const avgWhaleScore = yesHolders.length > 0 ? totalUnweightedScore / yesHolders.length : 50

    // Sort by whale score for top holders
    holderScores.sort((a, b) => b.whale_score - a.whale_score)

    console.log(`[SII API] Market ${marketId}: SII=${siiScore.toFixed(2)}, Holders=${yesHolders.length}`)

    return NextResponse.json({
      success: true,
      data: {
        market_id: marketId,
        condition_id: conditionId,
        sii_score: Math.round(siiScore * 100) / 100,
        holder_count: yesHolders.length,
        total_shares: Math.round(totalShares * 100) / 100,
        avg_whale_score: Math.round(avgWhaleScore * 100) / 100,
        top_holder_score: holderScores[0]?.whale_score || 0,
        top_holders: holderScores.slice(0, 5),
        interpretation: siiScore >= 70 ? 'High confidence - Smart money concentrated'
          : siiScore >= 50 ? 'Moderate confidence - Mixed holder quality'
          : 'Low confidence - Dispersed or retail-heavy'
      }
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[SII API] Error for market ${marketId}:`, message)

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
