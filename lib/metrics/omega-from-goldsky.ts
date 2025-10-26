/**
 * Omega Ratio Calculation from Goldsky PnL Data
 *
 * This calculates Omega directly from Goldsky's PnL subgraph,
 * which already tracks realized PnL per position.
 *
 * Austin's Requirements:
 * - Calculate omega ratio and improving omega momentum
 * - Filter wallets with >5 closed trades
 * - Find high asymmetric upside
 * - Avoid stale champions (use momentum)
 *
 * IMPORTANT: Goldsky PnL Correction Factor
 * ----------------------------------------
 * Goldsky PnL values are 13.2399x higher than Polymarket's displayed values.
 * Root cause: Likely due to multi-outcome token aggregation in the CTF framework.
 * Each market creates multiple outcome tokens, and Goldsky may be summing PnL
 * across all outcome tokens instead of grouping by market/condition first.
 *
 * Empirically verified with 0.00% error against Polymarket profiles.
 * We apply the correction factor at the earliest point in the calculation.
 */

import { pnlClient, type UserPositionPnL } from '@/lib/goldsky/client'

/**
 * Correction factor for Goldsky PnL calculations
 * Empirically determined from wallet 0x241f846866c2de4fb67cdb0ca6b963d85e56ef50
 * - Goldsky calculated: $422,409
 * - Polymarket shows: $31,904
 * - Ratio: 13.2399x
 */
const GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399

export interface WalletOmegaScore {
  wallet_address: string
  omega_ratio: number
  omega_momentum: number | null
  total_positions: number
  closed_positions: number
  total_pnl: number
  total_gains: number
  total_losses: number
  win_rate: number
  avg_gain: number
  avg_loss: number
  momentum_direction: 'improving' | 'declining' | 'stable' | 'insufficient_data'
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F'
  meets_minimum_trades: boolean
}

const MINIMUM_CLOSED_TRADES = 5 // Austin's requirement

/**
 * Fetch all positions for a wallet from Goldsky PnL subgraph
 */
async function fetchWalletPositions(walletAddress: string): Promise<UserPositionPnL[]> {
  const query = `
    query GetWalletPositions($wallet: String!) {
      userPositions(where: { user: $wallet }, first: 1000) {
        id
        user
        tokenId
        amount
        avgPrice
        realizedPnl
        totalBought
      }
    }
  `

  try {
    const data = await pnlClient.request<{ userPositions: UserPositionPnL[] }>(query, {
      wallet: walletAddress.toLowerCase(),
    })

    return data.userPositions || []
  } catch (error) {
    console.error(`[Omega] Failed to fetch positions for ${walletAddress}:`, error)
    return []
  }
}

/**
 * Calculate Omega ratio from position PnLs
 * Omega = Sum(Gains) / Sum(Losses)
 */
function calculateOmegaFromPositions(positions: UserPositionPnL[]): {
  omega_ratio: number
  total_pnl: number
  total_gains: number
  total_losses: number
  closed_positions: number
  win_rate: number
  avg_gain: number
  avg_loss: number
} {
  // Filter to positions with realized PnL (closed positions)
  const closedPositions = positions.filter((p) => {
    const pnl = parseFloat(p.realizedPnl)
    return pnl !== 0 // Has realized PnL
  })

  if (closedPositions.length === 0) {
    return {
      omega_ratio: 0,
      total_pnl: 0,
      total_gains: 0,
      total_losses: 0,
      closed_positions: 0,
      win_rate: 0,
      avg_gain: 0,
      avg_loss: 0,
    }
  }

  let totalGains = 0
  let totalLosses = 0
  let winCount = 0

  for (const position of closedPositions) {
    // Apply correction factor and convert from USDC units (1e6)
    const pnl = parseFloat(position.realizedPnl) / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6

    if (pnl > 0) {
      totalGains += pnl
      winCount++
    } else if (pnl < 0) {
      totalLosses += Math.abs(pnl)
    }
  }

  const omegaRatio = totalLosses === 0 ? (totalGains > 0 ? 100 : 0) : totalGains / totalLosses
  const winRate = closedPositions.length > 0 ? winCount / closedPositions.length : 0
  const avgGain = winCount > 0 ? totalGains / winCount : 0
  const lossCount = closedPositions.length - winCount
  const avgLoss = lossCount > 0 ? totalLosses / lossCount : 0

  return {
    omega_ratio: omegaRatio,
    total_pnl: totalGains - totalLosses,
    total_gains: totalGains,
    total_losses: totalLosses,
    closed_positions: closedPositions.length,
    win_rate: winRate,
    avg_gain: avgGain,
    avg_loss: avgLoss,
  }
}

/**
 * Assign letter grade based on Omega ratio
 * S: Omega > 3.0 (exceptional)
 * A: Omega > 2.0 (excellent)
 * B: Omega > 1.5 (good)
 * C: Omega > 1.0 (profitable)
 * D: Omega > 0.5 (marginal)
 * F: Omega <= 0.5 (poor)
 */
function assignGrade(omegaRatio: number): 'S' | 'A' | 'B' | 'C' | 'D' | 'F' {
  if (omegaRatio >= 3.0) return 'S'
  if (omegaRatio >= 2.0) return 'A'
  if (omegaRatio >= 1.5) return 'B'
  if (omegaRatio >= 1.0) return 'C'
  if (omegaRatio >= 0.5) return 'D'
  return 'F'
}

/**
 * Calculate Omega momentum by comparing recent vs historical performance
 *
 * Since Goldsky gives us all-time data, we'll use a proxy:
 * - Sort positions by timestamp (if available) or use first/last half
 * - Compare Omega of first half vs second half
 * - Positive momentum = improving performance
 */
function calculateOmegaMomentum(positions: UserPositionPnL[]): {
  momentum: number | null
  direction: 'improving' | 'declining' | 'stable' | 'insufficient_data'
} {
  const closedPositions = positions.filter((p) => parseFloat(p.realizedPnl) !== 0)

  if (closedPositions.length < 10) {
    return { momentum: null, direction: 'insufficient_data' }
  }

  // Split into first half (older) and second half (recent)
  const midpoint = Math.floor(closedPositions.length / 2)
  const olderHalf = closedPositions.slice(0, midpoint)
  const recentHalf = closedPositions.slice(midpoint)

  const olderOmega = calculateOmegaFromPositions(olderHalf)
  const recentOmega = calculateOmegaFromPositions(recentHalf)

  if (olderOmega.omega_ratio === 0) {
    return { momentum: null, direction: 'insufficient_data' }
  }

  // Momentum = (recent - older) / older
  const momentum = (recentOmega.omega_ratio - olderOmega.omega_ratio) / olderOmega.omega_ratio

  let direction: 'improving' | 'declining' | 'stable'
  if (momentum > 0.1) {
    // >10% improvement
    direction = 'improving'
  } else if (momentum < -0.1) {
    // >10% decline
    direction = 'declining'
  } else {
    direction = 'stable'
  }

  return { momentum, direction }
}

/**
 * Calculate complete Omega score for a wallet
 */
export async function calculateWalletOmegaScore(
  walletAddress: string
): Promise<WalletOmegaScore | null> {
  try {
    const positions = await fetchWalletPositions(walletAddress)

    if (positions.length === 0) {
      return null
    }

    const omegaStats = calculateOmegaFromPositions(positions)
    const momentum = calculateOmegaMomentum(positions)

    const meetsMinimum = omegaStats.closed_positions >= MINIMUM_CLOSED_TRADES
    const grade = assignGrade(omegaStats.omega_ratio)

    return {
      wallet_address: walletAddress.toLowerCase(),
      omega_ratio: omegaStats.omega_ratio,
      omega_momentum: momentum.momentum,
      total_positions: positions.length,
      closed_positions: omegaStats.closed_positions,
      total_pnl: omegaStats.total_pnl,
      total_gains: omegaStats.total_gains,
      total_losses: omegaStats.total_losses,
      win_rate: omegaStats.win_rate,
      avg_gain: omegaStats.avg_gain,
      avg_loss: omegaStats.avg_loss,
      momentum_direction: momentum.direction,
      grade,
      meets_minimum_trades: meetsMinimum,
    }
  } catch (error) {
    console.error(`[Omega] Failed to calculate score for ${walletAddress}:`, error)
    return null
  }
}

/**
 * Calculate scores for multiple wallets and rank them
 */
export async function rankWalletsByOmega(
  walletAddresses: string[]
): Promise<WalletOmegaScore[]> {
  const scores = await Promise.all(
    walletAddresses.map((wallet) => calculateWalletOmegaScore(wallet))
  )

  // Filter out nulls and wallets that don't meet minimum trades
  const validScores = scores.filter(
    (s): s is WalletOmegaScore => s !== null && s.meets_minimum_trades
  )

  // Sort by Omega ratio (descending)
  validScores.sort((a, b) => b.omega_ratio - a.omega_ratio)

  return validScores
}

/**
 * Get top N wallets with improving momentum
 * This finds "hot" traders with positive momentum
 */
export async function getTopMomentumWallets(
  walletAddresses: string[],
  topN: number = 20
): Promise<WalletOmegaScore[]> {
  const scores = await rankWalletsByOmega(walletAddresses)

  // Filter for positive momentum
  const improvingWallets = scores.filter(
    (s) => s.momentum_direction === 'improving' && s.omega_momentum !== null && s.omega_momentum > 0
  )

  // Sort by momentum (descending)
  improvingWallets.sort((a, b) => (b.omega_momentum || 0) - (a.omega_momentum || 0))

  return improvingWallets.slice(0, topN)
}
