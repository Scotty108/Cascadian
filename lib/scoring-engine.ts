/**
 * Smart Scoring Engine
 *
 * Core logic for calculating wallet intelligence scores using configurable parameters.
 * This engine is completely modular - all behavior is controlled by scoring-config.ts
 */

import {
  getCategoryThresholds,
  getCategoryConfig,
  SCORING_WEIGHTS,
  GRADE_BOUNDARIES,
  SPECIALIZATION_LEVELS,
  type MetricThresholds,
} from './scoring-config'

interface TradeData {
  pnl: number
  invested: number
  timestamp?: string | Date
}

/**
 * Calculate component score (0-100) based on value and thresholds
 *
 * Uses a piecewise linear function:
 * - 0-50 points: 0 to fair threshold
 * - 50-70 points: fair to good threshold
 * - 70-90 points: good to excellent threshold
 * - 90-100 points: excellent threshold and above
 */
export function scoreComponent(
  value: number,
  thresholds: { excellent: number; good: number; fair: number }
): number {
  if (value >= thresholds.excellent) {
    // 90-100 range: excellent and above
    const excess = value - thresholds.excellent
    const range = thresholds.excellent * 0.2 // 20% above excellent = 100
    return Math.min(100, 90 + (excess / range) * 10)
  }

  if (value >= thresholds.good) {
    // 70-90 range: good to excellent
    const progress = (value - thresholds.good) / (thresholds.excellent - thresholds.good)
    return 70 + progress * 20
  }

  if (value >= thresholds.fair) {
    // 50-70 range: fair to good
    const progress = (value - thresholds.fair) / (thresholds.good - thresholds.fair)
    return 50 + progress * 20
  }

  // 0-50 range: below fair
  return (value / thresholds.fair) * 50
}

/**
 * Calculate Sharpe ratio from trade returns
 */
export function calculateSharpe(returns: number[]): number {
  if (returns.length < 2) return 0

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
  const stdDev = Math.sqrt(variance)

  return stdDev > 0 ? avgReturn / stdDev : 0
}

/**
 * Calculate recency weight for a trade based on age
 *
 * Uses exponential decay: weight = decayRate ^ (days / 30)
 * Example: If decay = 0.95, trades lose 5% weight per 30 days
 */
export function calculateRecencyWeight(tradeTimestamp: string | Date, decayRate: number): number {
  const now = new Date()
  const tradeDate = new Date(tradeTimestamp)
  const daysDiff = (now.getTime() - tradeDate.getTime()) / (1000 * 60 * 60 * 24)

  // No decay for trades less than 7 days old
  if (daysDiff < 7) return 1.0

  // Exponential decay based on 30-day periods
  const periods = daysDiff / 30
  return Math.pow(decayRate, periods)
}

/**
 * Calculate consistency score (0-10 bonus points)
 *
 * Rewards traders who are consistently profitable rather than having a few big wins
 * - Measures standard deviation of returns
 * - Lower volatility = higher consistency
 */
export function calculateConsistencyBonus(returns: number[], maxBonus: number): number {
  if (returns.length < 3) return 0

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length

  // Can't reward consistency if average is negative
  if (avgReturn <= 0) return 0

  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
  const stdDev = Math.sqrt(variance)

  // Coefficient of variation: std dev / mean
  // Lower CV = more consistent
  const cv = stdDev / Math.abs(avgReturn)

  // Map CV to bonus score (lower CV = higher bonus)
  // CV < 0.5 = full bonus, CV > 2.0 = no bonus
  if (cv < 0.5) return maxBonus
  if (cv > 2.0) return 0

  const bonusPercent = 1 - (cv - 0.5) / 1.5
  return bonusPercent * maxBonus
}

/**
 * Calculate sample size confidence factor
 *
 * Applies a penalty for small sample sizes using smooth curve
 * - 1-2 trades: 20-40% confidence
 * - 3-5 trades: 40-70% confidence
 * - 5-10 trades: 70-100% confidence
 * - 10+ trades: 100% confidence
 */
export function calculateSampleSizeFactor(
  tradeCount: number,
  minTradesForFull: number
): number {
  if (tradeCount >= minTradesForFull) return 1.0

  // Logarithmic curve for smooth growth
  // Ensures 1 trade ≈ 0.2, 2 trades ≈ 0.35, 5 trades ≈ 0.65
  return Math.min(1.0, Math.log(tradeCount + 1) / Math.log(minTradesForFull + 1))
}

/**
 * Calculate category score with recency weighting and all adjustments
 */
export interface CategoryScoreInput {
  categoryName: string
  trades: TradeData[]
  winningTrades: number
  losingTrades: number
  totalPnL: number
}

export interface CategoryScoreOutput {
  category: string
  score: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A'
  trades: number
  winRate: number
  roi: number
  sharpe: number
  totalPnL: number
  specialization: 'Expert' | 'Advanced' | 'Intermediate' | 'Novice' | 'None'

  // Debug info (optional)
  breakdown?: {
    winRateScore: number
    roiScore: number
    sharpeScore: number
    consistencyBonus: number
    sampleSizeFactor: number
    difficultyMultiplier: number
    rawScore: number
    adjustedScore: number
  }
}

export function calculateCategoryScoreSmart(
  input: CategoryScoreInput,
  includeBreakdown = false
): CategoryScoreOutput {
  const { categoryName, trades, winningTrades, losingTrades, totalPnL } = input

  const totalTrades = trades.length

  // Get category-specific configuration
  const config = getCategoryConfig(categoryName)
  const thresholds = getCategoryThresholds(categoryName)

  // Calculate basic metrics
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0

  const totalInvested = trades.reduce((sum, t) => sum + t.invested, 0)
  const roi = totalInvested > 0 ? totalPnL / totalInvested : 0

  // Calculate returns for Sharpe and consistency
  const returns = trades.map((t) => (t.invested > 0 ? t.pnl / t.invested : 0))
  const sharpe = calculateSharpe(returns)

  // --- STEP 1: Calculate base component scores (0-100) ---
  const winRateScore = scoreComponent(winRate, thresholds.winRate)
  const roiScore = scoreComponent(roi, thresholds.roi)
  const sharpeScore = scoreComponent(sharpe, thresholds.sharpe)

  // --- STEP 2: Apply recency weighting to returns ---
  let weightedReturns = returns
  if (SCORING_WEIGHTS.recencyDecay < 1.0) {
    weightedReturns = returns.map((ret, idx) => {
      const trade = trades[idx]
      if (!trade.timestamp) return ret

      const weight = calculateRecencyWeight(trade.timestamp, SCORING_WEIGHTS.recencyDecay)
      return ret * weight
    })
  }

  // --- STEP 3: Calculate weighted average score ---
  const baseScore =
    winRateScore * SCORING_WEIGHTS.winRate +
    roiScore * SCORING_WEIGHTS.roi +
    sharpeScore * SCORING_WEIGHTS.sharpe

  // --- STEP 4: Add consistency bonus ---
  const consistencyBonus = calculateConsistencyBonus(
    weightedReturns,
    SCORING_WEIGHTS.consistencyBonus
  )

  // --- STEP 5: Apply sample size factor ---
  const sampleSizeFactor = calculateSampleSizeFactor(
    totalTrades,
    SCORING_WEIGHTS.minTradesForFullWeight
  )

  // --- STEP 6: Apply difficulty multiplier ---
  const rawScore = baseScore + consistencyBonus
  const adjustedScore = Math.min(100, rawScore * sampleSizeFactor * config.difficultyMultiplier)

  const finalScore = Math.round(adjustedScore)

  // --- STEP 7: Determine grade and specialization ---
  const grade = scoreToGrade(finalScore)
  const specialization = getSpecialization(finalScore, totalTrades)

  const output: CategoryScoreOutput = {
    category: categoryName,
    score: finalScore,
    grade,
    trades: totalTrades,
    winRate,
    roi,
    sharpe,
    totalPnL,
    specialization,
  }

  if (includeBreakdown) {
    output.breakdown = {
      winRateScore: Math.round(winRateScore),
      roiScore: Math.round(roiScore),
      sharpeScore: Math.round(sharpeScore),
      consistencyBonus: Math.round(consistencyBonus * 10) / 10,
      sampleSizeFactor: Math.round(sampleSizeFactor * 100) / 100,
      difficultyMultiplier: config.difficultyMultiplier,
      rawScore: Math.round(rawScore),
      adjustedScore: Math.round(adjustedScore),
    }
  }

  return output
}

/**
 * Convert score to letter grade
 */
export function scoreToGrade(score: number): 'S' | 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A' {
  if (score === 0) return 'N/A'
  if (score >= GRADE_BOUNDARIES.S) return 'S'
  if (score >= GRADE_BOUNDARIES.A) return 'A'
  if (score >= GRADE_BOUNDARIES.B) return 'B'
  if (score >= GRADE_BOUNDARIES.C) return 'C'
  if (score >= GRADE_BOUNDARIES.D) return 'D'
  return 'F'
}

/**
 * Determine specialization level
 */
export function getSpecialization(
  score: number,
  trades: number
): 'Expert' | 'Advanced' | 'Intermediate' | 'Novice' | 'None' {
  if (trades === 0 || score === 0) return 'None'

  if (
    score >= SPECIALIZATION_LEVELS.Expert.minScore &&
    trades >= SPECIALIZATION_LEVELS.Expert.minTrades
  )
    return 'Expert'
  if (
    score >= SPECIALIZATION_LEVELS.Advanced.minScore &&
    trades >= SPECIALIZATION_LEVELS.Advanced.minTrades
  )
    return 'Advanced'
  if (
    score >= SPECIALIZATION_LEVELS.Intermediate.minScore &&
    trades >= SPECIALIZATION_LEVELS.Intermediate.minTrades
  )
    return 'Intermediate'
  return 'Novice'
}
