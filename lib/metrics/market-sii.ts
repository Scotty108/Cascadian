/**
 * Market SII (Smart Investor Index)
 *
 * Compares the Omega scores of top traders on YES vs NO sides of each market.
 * Generates signals showing which side the smart money is on.
 *
 * Algorithm:
 * 1. Get top 20 positions (by value) on YES side
 * 2. Get top 20 positions (by value) on NO side
 * 3. Calculate average Omega score for each side
 * 4. Compare: higher Omega = smarter money on that side
 * 5. Calculate signal strength and confidence
 */

import { positionsClient } from '@/lib/goldsky/client'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy initialization to avoid env var issues
let supabaseInstance: SupabaseClient | null = null
function getSupabase() {
  if (!supabaseInstance) {
    supabaseInstance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return supabaseInstance
}

export interface MarketSII {
  market_id: string
  market_question?: string

  // YES side
  yes_top_wallets: string[]
  yes_avg_omega: number
  yes_total_volume: number
  yes_wallet_count: number

  // NO side
  no_top_wallets: string[]
  no_avg_omega: number
  no_total_volume: number
  no_wallet_count: number

  // Signal
  smart_money_side: 'YES' | 'NO' | 'NEUTRAL'
  omega_differential: number // YES avg - NO avg
  signal_strength: number // 0-1 (how strong)
  confidence_score: number // 0-1 (based on sample quality)

  // Timestamps
  calculated_at: string
}

interface MarketPosition {
  user: string
  outcomeIndex: string // '0' = NO, '1' = YES (usually)
  amount: string // Position balance/size
  netShares?: string // Current position size
  avgEntryPrice?: string
  realizedProfit?: string
}

/**
 * Get top N positions for a market by outcome
 */
async function getTopPositions(
  conditionId: string,
  outcomeIndex: string,
  limit: number = 20
): Promise<MarketPosition[]> {
  const query = `
    query GetMarketPositions($conditionId: String!, $outcomeIndex: String!, $limit: Int!) {
      userBalances(
        where: {
          asset_: {
            condition: $conditionId
            outcomeIndex: $outcomeIndex
          }
        }
        first: $limit
        orderBy: balance
        orderDirection: desc
      ) {
        user
        asset {
          outcomeIndex
        }
        balance
      }
    }
  `

  try {
    const data = await positionsClient.request<any>(query, {
      conditionId: conditionId.toLowerCase(),
      outcomeIndex,
      limit,
    })

    // Transform to expected format
    return (data.userBalances || []).map((balance: any) => ({
      user: balance.user,
      outcomeIndex: balance.asset.outcomeIndex,
      amount: balance.balance, // Map balance to amount for compatibility
    }))
  } catch (error) {
    console.error(`[SII] Failed to fetch positions for ${conditionId}:`, error)
    return []
  }
}

/**
 * Get Omega scores for multiple wallets from cache
 * Falls back to calculating if not cached
 */
async function getWalletOmegaScores(walletAddresses: string[]): Promise<Map<string, number>> {
  const scores = new Map<string, number>()

  if (walletAddresses.length === 0) return scores

  // Query wallet_scores table for cached Omega ratios
  const { data, error } = await getSupabase()
    .from('wallet_scores')
    .select('wallet_address, omega_ratio')
    .in('wallet_address', walletAddresses)
    .gte('omega_ratio', 0) // Only wallets with valid scores

  if (error) {
    console.error('[SII] Error fetching wallet scores:', error)
    return scores
  }

  // Build map of wallet -> omega
  data?.forEach((row) => {
    scores.set(row.wallet_address, parseFloat(row.omega_ratio))
  })

  return scores
}

/**
 * Calculate signal strength based on Omega differential and sample quality
 */
function calculateSignalStrength(
  differential: number,
  yesWalletCount: number,
  noWalletCount: number
): number {
  // Normalize differential to 0-1 scale
  // Omega diff of 0.5 or more = strong signal (1.0)
  const normalizedDiff = Math.min(Math.abs(differential) / 0.5, 1.0)

  // Sample size factor (need good sample on both sides)
  const minSampleSize = Math.min(yesWalletCount, noWalletCount)
  const sampleFactor = Math.min(minSampleSize / 10, 1.0) // 10+ wallets per side = full confidence

  return normalizedDiff * sampleFactor
}

/**
 * Calculate confidence score based on:
 * - Sample size (more wallets = higher confidence)
 * - Omega quality (higher average Omega = higher confidence)
 * - Balance (similar sample sizes = higher confidence)
 */
function calculateConfidence(
  yesAvgOmega: number,
  noAvgOmega: number,
  yesWalletCount: number,
  noWalletCount: number
): number {
  // Quality factor: average of both sides' Omega
  // Omega 2.0+ = excellent (1.0), Omega 1.0 = ok (0.5)
  const avgOmega = (yesAvgOmega + noAvgOmega) / 2
  const qualityFactor = Math.min(avgOmega / 2.0, 1.0)

  // Sample size factor
  const totalWallets = yesWalletCount + noWalletCount
  const sizeFactor = Math.min(totalWallets / 40, 1.0) // 40 wallets (20+20) = full size

  // Balance factor: penalize if one side has way more wallets
  const ratio = Math.min(yesWalletCount, noWalletCount) / Math.max(yesWalletCount, noWalletCount)
  const balanceFactor = ratio // 1.0 = perfectly balanced, 0.5 = 2:1 ratio

  return (qualityFactor * 0.4 + sizeFactor * 0.3 + balanceFactor * 0.3)
}

/**
 * Calculate Market SII for a single market
 */
export async function calculateMarketSII(
  conditionId: string,
  marketQuestion?: string
): Promise<MarketSII | null> {
  try {
    // Get top positions for both sides
    // In CTF: outcomeIndex 1 = YES, outcomeIndex 0 = NO (usually, but check market)
    const [yesPositions, noPositions] = await Promise.all([
      getTopPositions(conditionId, '1', 20), // YES
      getTopPositions(conditionId, '0', 20), // NO
    ])

    if (yesPositions.length === 0 && noPositions.length === 0) {
      console.log(`[SII] No positions found for market ${conditionId}`)
      return null
    }

    // Extract wallet addresses
    const yesWallets = yesPositions.map((p) => p.user.toLowerCase())
    const noWallets = noPositions.map((p) => p.user.toLowerCase())
    const allWallets = [...new Set([...yesWallets, ...noWallets])]

    // Get Omega scores for all wallets
    const omegaScores = await getWalletOmegaScores(allWallets)

    // Calculate average Omega for each side
    let yesOmegaSum = 0
    let yesOmegaCount = 0
    let yesTotalVolume = 0

    yesWallets.forEach((wallet, i) => {
      const omega = omegaScores.get(wallet)
      if (omega !== undefined && omega > 0) {
        yesOmegaSum += omega
        yesOmegaCount++
      }
      // Add volume (position size)
      yesTotalVolume += parseFloat(yesPositions[i].amount || '0') / 1e6
    })

    let noOmegaSum = 0
    let noOmegaCount = 0
    let noTotalVolume = 0

    noWallets.forEach((wallet, i) => {
      const omega = omegaScores.get(wallet)
      if (omega !== undefined && omega > 0) {
        noOmegaSum += omega
        noOmegaCount++
      }
      // Add volume (position size)
      noTotalVolume += parseFloat(noPositions[i].amount || '0') / 1e6
    })

    // Calculate averages
    const yesAvgOmega = yesOmegaCount > 0 ? yesOmegaSum / yesOmegaCount : 0
    const noAvgOmega = noOmegaCount > 0 ? noOmegaSum / noOmegaCount : 0

    // Determine smart money side
    const differential = yesAvgOmega - noAvgOmega
    let smartMoneySide: 'YES' | 'NO' | 'NEUTRAL'

    if (Math.abs(differential) < 0.1) {
      // Less than 0.1 Omega difference = neutral
      smartMoneySide = 'NEUTRAL'
    } else if (differential > 0) {
      smartMoneySide = 'YES'
    } else {
      smartMoneySide = 'NO'
    }

    // Calculate signal strength and confidence
    const signalStrength = calculateSignalStrength(differential, yesOmegaCount, noOmegaCount)
    const confidence = calculateConfidence(yesAvgOmega, noAvgOmega, yesOmegaCount, noOmegaCount)

    return {
      market_id: conditionId,
      market_question: marketQuestion,
      yes_top_wallets: yesWallets.slice(0, 20),
      yes_avg_omega: yesAvgOmega,
      yes_total_volume: yesTotalVolume,
      yes_wallet_count: yesOmegaCount,
      no_top_wallets: noWallets.slice(0, 20),
      no_avg_omega: noAvgOmega,
      no_total_volume: noTotalVolume,
      no_wallet_count: noOmegaCount,
      smart_money_side: smartMoneySide,
      omega_differential: differential,
      signal_strength: signalStrength,
      confidence_score: confidence,
      calculated_at: new Date().toISOString(),
    }
  } catch (error) {
    console.error(`[SII] Failed to calculate SII for ${conditionId}:`, error)
    return null
  }
}

/**
 * Save Market SII to database
 */
export async function saveMarketSII(sii: MarketSII): Promise<boolean> {
  try {
    const { error } = await getSupabase().from('market_sii').upsert(
      {
        market_id: sii.market_id,
        yes_top_wallets: sii.yes_top_wallets,
        yes_avg_omega: sii.yes_avg_omega,
        yes_total_volume: sii.yes_total_volume,
        yes_wallet_count: sii.yes_wallet_count,
        no_top_wallets: sii.no_top_wallets,
        no_avg_omega: sii.no_avg_omega,
        no_total_volume: sii.no_total_volume,
        no_wallet_count: sii.no_wallet_count,
        smart_money_side: sii.smart_money_side,
        omega_differential: sii.omega_differential,
        signal_strength: sii.signal_strength,
        confidence_score: sii.confidence_score,
        market_question: sii.market_question,
        calculated_at: sii.calculated_at,
      },
      {
        onConflict: 'market_id',
      }
    )

    if (error) {
      console.error('[SII] Failed to save to database:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('[SII] Database error:', error)
    return false
  }
}

/**
 * Get cached Market SII from database
 */
export async function getMarketSII(
  marketId: string,
  maxAgeSeconds: number = 3600
): Promise<MarketSII | null> {
  try {
    const { data, error } = await getSupabase()
      .from('market_sii')
      .select('*')
      .eq('market_id', marketId)
      .single()

    if (error || !data) {
      return null
    }

    // Check if cache is fresh enough
    const cacheAge = Date.now() - new Date(data.calculated_at).getTime()
    if (cacheAge / 1000 > maxAgeSeconds) {
      return null // Cache expired
    }

    return data as MarketSII
  } catch (error) {
    console.error('[SII] Error fetching from cache:', error)
    return null
  }
}

/**
 * Get strongest SII signals (markets where smart money has clear preference)
 */
export async function getStrongestSignals(limit: number = 20): Promise<MarketSII[]> {
  try {
    const { data, error } = await getSupabase()
      .from('market_sii')
      .select('*')
      .gte('signal_strength', 0.5) // Only strong signals
      .order('signal_strength', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[SII] Error fetching strongest signals:', error)
      return []
    }

    return (data || []) as MarketSII[]
  } catch (error) {
    console.error('[SII] Error:', error)
    return []
  }
}

/**
 * Calculate or refresh Market SII (with caching)
 */
export async function refreshMarketSII(
  conditionId: string,
  marketQuestion?: string,
  forceRefresh: boolean = false
): Promise<MarketSII | null> {
  // Check cache first
  if (!forceRefresh) {
    const cached = await getMarketSII(conditionId)
    if (cached) {
      return cached
    }
  }

  // Calculate fresh
  const sii = await calculateMarketSII(conditionId, marketQuestion)
  if (sii) {
    await saveMarketSII(sii)
  }

  return sii
}
