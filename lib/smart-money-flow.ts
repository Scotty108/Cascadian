/**
 * Smart Money Flow Analyzer
 *
 * Analyzes market liquidity by wallet intelligence scores
 * Shows not just "5M on YES, 5M on NO" but "4M smart money on YES, 1M dumb money"
 */

export interface WalletTier {
  tier: 'elite' | 'smart' | 'average' | 'poor' | 'unknown'
  minScore: number
  maxScore: number
  label: string
  color: string
}

export const WALLET_TIERS: WalletTier[] = [
  {
    tier: 'elite',
    minScore: 85,
    maxScore: 100,
    label: 'Elite Traders',
    color: '#a855f7', // purple
  },
  {
    tier: 'smart',
    minScore: 70,
    maxScore: 84,
    label: 'Smart Money',
    color: '#00E0AA', // green
  },
  {
    tier: 'average',
    minScore: 50,
    maxScore: 69,
    label: 'Average',
    color: '#94a3b8', // gray
  },
  {
    tier: 'poor',
    minScore: 0,
    maxScore: 49,
    label: 'Poor Performers',
    color: '#ef4444', // red
  },
  {
    tier: 'unknown',
    minScore: 0,
    maxScore: 0,
    label: 'Unscored',
    color: '#64748b', // dark gray
  },
]

export function getWalletTier(score: number | null): WalletTier {
  if (score === null) return WALLET_TIERS.find((t) => t.tier === 'unknown')!

  for (const tier of WALLET_TIERS) {
    if (tier.tier === 'unknown') continue
    if (score >= tier.minScore && score <= tier.maxScore) {
      return tier
    }
  }

  return WALLET_TIERS.find((t) => t.tier === 'unknown')!
}

export interface TierLiquidity {
  tier: WalletTier
  liquidity: number // USD value
  walletCount: number
  percentage: number // % of total liquidity on this side
}

export interface SideLiquidity {
  side: 'YES' | 'NO'
  totalLiquidity: number
  tiers: TierLiquidity[]
  smartMoneyPercentage: number // % that is smart/elite money
  averageWalletScore: number // Weighted average score
}

export interface SmartMoneyFlow {
  marketId: string
  marketTitle: string
  yes: SideLiquidity
  no: SideLiquidity

  // Smart money sentiment: -100 to +100
  // Positive = smart money favors YES
  // Negative = smart money favors NO
  smartMoneySentiment: number

  // Confidence: 0-100 based on how much smart money is involved
  confidence: number

  // Divergence: When smart money disagrees with market price
  // High divergence = opportunity
  divergence: number
}

export interface WalletPosition {
  walletAddress: string
  side: 'YES' | 'NO'
  shares: number
  avgPrice: number
  currentValue: number
  walletScore?: number | null // Intelligence score (0-100)
}

/**
 * Calculate smart money flow for a market
 */
export function calculateSmartMoneyFlow(
  marketId: string,
  marketTitle: string,
  positions: WalletPosition[],
  currentYesPrice: number
): SmartMoneyFlow {
  // Separate positions by side
  const yesPositions = positions.filter((p) => p.side === 'YES')
  const noPositions = positions.filter((p) => p.side === 'NO')

  // Calculate liquidity by tier for each side
  const yesLiquidity = calculateSideLiquidity('YES', yesPositions)
  const noLiquidity = calculateSideLiquidity('NO', noPositions)

  // Calculate smart money sentiment (-100 to +100)
  // Positive = smart money favors YES
  const yesSmartMoney =
    (yesLiquidity.tiers.find((t) => t.tier.tier === 'elite')?.liquidity || 0) +
    (yesLiquidity.tiers.find((t) => t.tier.tier === 'smart')?.liquidity || 0)

  const noSmartMoney =
    (noLiquidity.tiers.find((t) => t.tier.tier === 'elite')?.liquidity || 0) +
    (noLiquidity.tiers.find((t) => t.tier.tier === 'smart')?.liquidity || 0)

  const totalSmartMoney = yesSmartMoney + noSmartMoney
  const smartMoneySentiment =
    totalSmartMoney > 0 ? ((yesSmartMoney - noSmartMoney) / totalSmartMoney) * 100 : 0

  // Calculate confidence (0-100) based on smart money participation
  const totalLiquidity = yesLiquidity.totalLiquidity + noLiquidity.totalLiquidity
  const smartMoneyParticipation = totalLiquidity > 0 ? totalSmartMoney / totalLiquidity : 0
  const confidence = Math.min(100, smartMoneyParticipation * 100)

  // Calculate divergence (smart money vs market price)
  // If smart money is 80% on YES but price is 40%, divergence is high
  const smartMoneyYesPercent =
    totalSmartMoney > 0 ? (yesSmartMoney / totalSmartMoney) * 100 : 50
  const marketYesPercent = currentYesPrice * 100
  const divergence = Math.abs(smartMoneyYesPercent - marketYesPercent)

  return {
    marketId,
    marketTitle,
    yes: yesLiquidity,
    no: noLiquidity,
    smartMoneySentiment,
    confidence,
    divergence,
  }
}

/**
 * Calculate liquidity breakdown by tier for one side
 */
function calculateSideLiquidity(side: 'YES' | 'NO', positions: WalletPosition[]): SideLiquidity {
  // Group positions by tier
  const tierGroups = new Map<string, WalletPosition[]>()

  for (const tier of WALLET_TIERS) {
    tierGroups.set(tier.tier, [])
  }

  for (const position of positions) {
    const tier = getWalletTier(position.walletScore ?? null)
    tierGroups.get(tier.tier)!.push(position)
  }

  // Calculate liquidity per tier
  const totalLiquidity = positions.reduce((sum, p) => sum + p.currentValue, 0)

  const tiers: TierLiquidity[] = WALLET_TIERS.map((tier) => {
    const tierPositions = tierGroups.get(tier.tier)!
    const liquidity = tierPositions.reduce((sum, p) => sum + p.currentValue, 0)
    const percentage = totalLiquidity > 0 ? (liquidity / totalLiquidity) * 100 : 0

    return {
      tier,
      liquidity,
      walletCount: tierPositions.length,
      percentage,
    }
  })

  // Calculate smart money percentage (elite + smart)
  const smartMoneyLiquidity =
    (tiers.find((t) => t.tier.tier === 'elite')?.liquidity || 0) +
    (tiers.find((t) => t.tier.tier === 'smart')?.liquidity || 0)
  const smartMoneyPercentage = totalLiquidity > 0 ? (smartMoneyLiquidity / totalLiquidity) * 100 : 0

  // Calculate weighted average wallet score
  let totalWeightedScore = 0
  let totalWeight = 0

  for (const position of positions) {
    if (position.walletScore !== null && position.walletScore !== undefined) {
      totalWeightedScore += position.walletScore * position.currentValue
      totalWeight += position.currentValue
    }
  }

  const averageWalletScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0

  return {
    side,
    totalLiquidity,
    tiers,
    smartMoneyPercentage,
    averageWalletScore,
  }
}

/**
 * Get smart money recommendation based on sentiment and divergence
 */
export function getSmartMoneyRecommendation(flow: SmartMoneyFlow): {
  action: 'STRONG_YES' | 'LEAN_YES' | 'NEUTRAL' | 'LEAN_NO' | 'STRONG_NO'
  reason: string
  confidence: 'high' | 'medium' | 'low'
} {
  const { smartMoneySentiment, divergence, confidence: participationConfidence } = flow

  // High confidence if smart money is heavily involved
  const confidenceLevel: 'high' | 'medium' | 'low' =
    participationConfidence > 60 ? 'high' : participationConfidence > 30 ? 'medium' : 'low'

  // Strong sentiment = abs(sentiment) > 50
  // Lean = 20-50
  // Neutral = <20

  if (smartMoneySentiment > 50) {
    return {
      action: 'STRONG_YES',
      reason: `Smart money heavily favors YES (${smartMoneySentiment.toFixed(0)}% sentiment)`,
      confidence: confidenceLevel,
    }
  }

  if (smartMoneySentiment > 20) {
    return {
      action: 'LEAN_YES',
      reason: `Smart money leans toward YES (${smartMoneySentiment.toFixed(0)}% sentiment)`,
      confidence: confidenceLevel,
    }
  }

  if (smartMoneySentiment < -50) {
    return {
      action: 'STRONG_NO',
      reason: `Smart money heavily favors NO (${Math.abs(smartMoneySentiment).toFixed(0)}% sentiment)`,
      confidence: confidenceLevel,
    }
  }

  if (smartMoneySentiment < -20) {
    return {
      action: 'LEAN_NO',
      reason: `Smart money leans toward NO (${Math.abs(smartMoneySentiment).toFixed(0)}% sentiment)`,
      confidence: confidenceLevel,
    }
  }

  // High divergence with neutral sentiment = interesting opportunity
  if (divergence > 25) {
    return {
      action: 'NEUTRAL',
      reason: `Smart money is split, but diverges ${divergence.toFixed(0)}% from market price`,
      confidence: confidenceLevel,
    }
  }

  return {
    action: 'NEUTRAL',
    reason: 'Smart money is relatively neutral on this market',
    confidence: confidenceLevel,
  }
}

/**
 * Format liquidity for display
 */
export function formatLiquidity(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}K`
  }
  return `$${amount.toFixed(0)}`
}
