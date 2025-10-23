/**
 * Wallet Intelligence Scoring System
 *
 * Scores wallets on a category-by-category basis to identify specialists
 * Example: "Egg Man" scores 95/100 in Commodities, 88/100 in Economics, N/A in Sports
 */

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

// Map market titles to categories using keywords
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Politics': ['trump', 'biden', 'election', 'congress', 'senate', 'president', 'xi jinping', 'putin', 'zelenskyy', 'powell', 'fed chair', 'governor'],
  'Economics': ['fed', 'rate', 'interest', 'treasury', 'yield', 'inflation', 'recession', 'gdp', 'unemployment', 'irs', 'tax'],
  'Commodities': ['egg', 'eggs', 'oil', 'gold', 'silver', 'wheat', 'corn', 'price of'],
  'Crypto': ['bitcoin', 'ethereum', 'crypto', 'btc', 'eth', 'satoshi', 'microstrategy', 'coinbase', 'binance', 'changpeng zhao', 'cz'],
  'Sports': ['nfl', 'nba', 'mlb', 'nhl', 'super bowl', 'world series', 'finals', 'championship', 'lebron', 'mahomes'],
  'Pop Culture': ['taylor swift', 'kardashian', 'mrbeast', 'tiktok', 'spotify', 'netflix', 'oscar', 'grammy', 'emmy'],
  'Science & Tech': ['ai', 'deepseek', 'openai', 'spacex', 'mars', 'nuclear', 'climate', 'covid', 'vaccine'],
  'Global Events': ['taiwan', 'china', 'invasion', 'military', 'war', 'conflict', 'nato', 'nuclear weapon'],
  'Other': [] // Catch-all for markets that don't fit
}

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

/**
 * Calculate score for a specific component (0-100 scale)
 */
function scoreComponent(value: number, thresholds: { excellent: number; good: number; fair: number }): number {
  if (value >= thresholds.excellent) return 90 + ((value - thresholds.excellent) / (thresholds.excellent * 0.2)) * 10
  if (value >= thresholds.good) return 70 + ((value - thresholds.good) / (thresholds.excellent - thresholds.good)) * 20
  if (value >= thresholds.fair) return 50 + ((value - thresholds.fair) / (thresholds.good - thresholds.fair)) * 20
  return (value / thresholds.fair) * 50
}

/**
 * Calculate Sharpe ratio for a set of trades
 */
function calculateSharpe(returns: number[]): number {
  if (returns.length < 2) return 0

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
  const stdDev = Math.sqrt(variance)

  return stdDev > 0 ? avgReturn / stdDev : 0
}

/**
 * Convert score to letter grade
 */
function scoreToGrade(score: number): 'S' | 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A' {
  if (score === 0) return 'N/A'
  if (score >= 90) return 'S'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

/**
 * Determine specialization level
 */
function getSpecialization(score: number, trades: number): CategoryScore['specialization'] {
  if (trades === 0 || score === 0) return 'None'
  if (score >= 85 && trades >= 10) return 'Expert'
  if (score >= 70 && trades >= 5) return 'Advanced'
  if (score >= 55 && trades >= 3) return 'Intermediate'
  return 'Novice'
}

/**
 * Calculate category-specific score from closed positions
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
    totalBought?: number
    size?: number
  }>
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

  // Calculate scores for each category
  const scores: CategoryScore[] = []

  for (const [category, positions] of Object.entries(categoryGroups)) {
    if (positions.length === 0) continue

    // Calculate metrics
    const totalTrades = positions.length
    const winningTrades = positions.filter(p => (p.realizedPnl || p.realized_pnl || p.profit || 0) > 0).length
    const winRate = winningTrades / totalTrades

    // Calculate ROI
    const totalInvested = positions.reduce((sum, p) => {
      return sum + ((p.avgPrice || p.entry_price || 0) * (p.totalBought || p.size || 0))
    }, 0)
    const totalPnL = positions.reduce((sum, p) => sum + (p.realizedPnl || p.realized_pnl || p.profit || 0), 0)
    const roi = totalInvested > 0 ? totalPnL / totalInvested : 0

    // Calculate Sharpe ratio
    const returns = positions.map(p => {
      const pnl = p.realizedPnl || p.realized_pnl || p.profit || 0
      const invested = (p.avgPrice || p.entry_price || 0) * (p.totalBought || p.size || 1)
      return invested > 0 ? pnl / invested : 0
    })
    const sharpe = calculateSharpe(returns)

    // Calculate component scores (0-100)
    const winRateScore = scoreComponent(winRate, { excellent: 0.80, good: 0.65, fair: 0.50 })
    const roiScore = scoreComponent(roi, { excellent: 0.40, good: 0.20, fair: 0.10 })
    const sharpeScore = scoreComponent(sharpe, { excellent: 2.0, good: 1.5, fair: 1.0 })

    // Weight factors based on number of trades (more trades = more reliable)
    const tradeCountFactor = Math.min(1.0, totalTrades / 10) // Fully weighted at 10+ trades

    // Calculate overall category score (weighted average)
    const score = Math.min(100, (
      (winRateScore * 0.35) +
      (roiScore * 0.35) +
      (sharpeScore * 0.30)
    ) * tradeCountFactor)

    scores.push({
      category,
      score: Math.round(score),
      grade: scoreToGrade(score),
      trades: totalTrades,
      winRate,
      roi,
      sharpe,
      totalPnL,
      specialization: getSpecialization(score, totalTrades),
    })
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
