/**
 * Wallet Intelligence Scoring System
 *
 * Scores wallets on a category-by-category basis to identify specialists
 * Example: "Egg Man" scores 95/100 in Commodities, 88/100 in Economics, N/A in Sports
 *
 * NEW: Uses modular scoring engine with configurable parameters
 * See scoring-config.ts to adjust thresholds, weights, and difficulty multipliers
 */

import {
  calculateCategoryScoreSmart,
  scoreToGrade,
  type CategoryScoreInput,
  type CategoryScoreOutput,
} from './scoring-engine'
import { CATEGORY_CONFIGS } from './scoring-config'

export interface CategoryScore {
  category: string
  score: number // 0-100
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A'
  trades: number
  winRate: number
  roi: number
  sharpe: number
  totalPnL: number
  specialization: 'Expert' | 'Advanced' | 'Intermediate' | 'Novice' | 'None'
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

export interface WalletScore {
  address: string
  overall: number // 0-100 (weighted average of categories traded)
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A'
  rank: string // "Top 1%", "Top 5%", etc.
  categories: CategoryScore[]
  specializations: string[] // Top categories they excel in
  strengths: string[] // ["Commodities (95)", "Economics (88)"]
  weaknesses: string[] // ["Sports (N/A)", "Pop Culture (N/A)"]
}

// Build CATEGORY_KEYWORDS from config for backwards compatibility
const CATEGORY_KEYWORDS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CATEGORY_CONFIGS).map(([key, config]) => [key, config.keywords])
)

/**
 * Categorize a market based on its title/slug
 */
export function categorizeMarket(title: string, slug: string = ''): string {
  const text = `${title} ${slug}`.toLowerCase()

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'Other') continue // Skip catch-all

    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return category
      }
    }
  }

  return 'Other'
}

// Re-export types from scoring engine for convenience
export type { CategoryScoreInput, CategoryScoreOutput } from './scoring-engine'
export { calculateCategoryScoreSmart } from './scoring-engine'

// Re-export configuration for easy access
export { CATEGORY_CONFIGS, SCORING_WEIGHTS, getCategoryConfig, getCategoryThresholds } from './scoring-config'

/**
 * Calculate category-specific score from closed positions
 * NOW USING SMART SCORING ENGINE with configurable parameters
 *
 * @param closedPositions - Array of closed trading positions
 * @param includeBreakdown - If true, includes detailed scoring breakdown for debugging
 */
export function calculateCategoryScore(
  closedPositions: Array<{
    title?: string
    slug?: string
    realizedPnl?: number
    realized_pnl?: number
    profit?: number
    avgPrice?: number
    entry_price?: number
    entryPrice?: number
    totalBought?: number
    size?: number
    closed_at?: string
    endDate?: string
  }>,
  includeBreakdown = false
): CategoryScore[] {
  // Group positions by category
  const categoryGroups: Record<string, typeof closedPositions> = {}

  for (const position of closedPositions) {
    const category = categorizeMarket(position.title || '', position.slug || '')
    if (!categoryGroups[category]) {
      categoryGroups[category] = []
    }
    categoryGroups[category].push(position)
  }

  // Calculate scores for each category using smart engine
  const scores: CategoryScore[] = []

  for (const [category, positions] of Object.entries(categoryGroups)) {
    if (positions.length === 0) continue

    // Prepare data for smart scoring engine
    const winningTrades = positions.filter(
      (p) => (p.realizedPnl || p.realized_pnl || p.profit || 0) > 0
    ).length
    const losingTrades = positions.length - winningTrades

    const totalPnL = positions.reduce(
      (sum, p) => sum + (p.realizedPnl || p.realized_pnl || p.profit || 0),
      0
    )

    const trades = positions.map((p) => {
      const pnl = p.realizedPnl || p.realized_pnl || p.profit || 0
      const invested =
        (p.avgPrice || p.entry_price || p.entryPrice || 0) * (p.totalBought || p.size || 1)
      const timestamp = p.closed_at || p.endDate

      return {
        pnl,
        invested,
        timestamp,
      }
    })

    const input: CategoryScoreInput = {
      categoryName: category,
      trades,
      winningTrades,
      losingTrades,
      totalPnL,
    }

    // Use smart scoring engine
    const result = calculateCategoryScoreSmart(input, includeBreakdown)

    scores.push(result)
  }

  // Sort by score (highest first)
  return scores.sort((a, b) => b.score - a.score)
}

/**
 * Calculate overall wallet score from category scores
 */
export function calculateWalletScore(
  address: string,
  categoryScores: CategoryScore[],
  totalTraders: number = 10000
): WalletScore {
  // Filter out categories with no trades
  const tradedCategories = categoryScores.filter(c => c.trades > 0)

  // Calculate weighted overall score (weight by number of trades)
  const totalTrades = tradedCategories.reduce((sum, c) => sum + c.trades, 0)
  const weightedScore = totalTrades > 0
    ? tradedCategories.reduce((sum, c) => sum + (c.score * c.trades), 0) / totalTrades
    : 0

  const overall = Math.round(weightedScore)
  const grade = scoreToGrade(overall)

  // Identify specializations (score >= 80 and top 3 categories)
  const specializations = tradedCategories
    .filter(c => c.score >= 80)
    .slice(0, 3)
    .map(c => c.category)

  // Strengths: Categories with score >= 70
  const strengths = tradedCategories
    .filter(c => c.score >= 70)
    .map(c => `${c.category} (${c.score})`)

  // Weaknesses: Categories with score < 50 OR no trades in major categories
  const allCategories = Object.keys(CATEGORY_KEYWORDS).filter(c => c !== 'Other')
  const untradedCategories = allCategories.filter(cat =>
    !tradedCategories.some(tc => tc.category === cat)
  )
  const weaknesses = [
    ...tradedCategories.filter(c => c.score < 50).map(c => `${c.category} (${c.score})`),
    ...untradedCategories.map(c => `${c} (N/A)`)
  ]

  // Calculate rank (placeholder - would query database for actual rank)
  const percentile = overall >= 90 ? 1 :
                    overall >= 85 ? 3 :
                    overall >= 80 ? 5 :
                    overall >= 75 ? 10 :
                    overall >= 70 ? 15 : 25
  const rank = `Top ${percentile}%`

  return {
    address,
    overall,
    grade,
    rank,
    categories: categoryScores,
    specializations,
    strengths,
    weaknesses: weaknesses.slice(0, 5), // Limit to top 5
  }
}

/**
 * Find similar wallets by category specialization
 */
export function findSimilarSpecialists(
  targetCategory: string,
  minScore: number = 80,
  allWalletScores: WalletScore[]
): WalletScore[] {
  return allWalletScores
    .filter(wallet => {
      const categoryScore = wallet.categories.find(c => c.category === targetCategory)
      return categoryScore && categoryScore.score >= minScore
    })
    .sort((a, b) => {
      const aScore = a.categories.find(c => c.category === targetCategory)?.score || 0
      const bScore = b.categories.find(c => c.category === targetCategory)?.score || 0
      return bScore - aScore
    })
}
