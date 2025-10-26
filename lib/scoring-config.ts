/**
 * Modular Scoring Configuration
 *
 * This file contains all configurable parameters for the wallet intelligence scoring system.
 * Adjust these values to fine-tune the scoring algorithm without changing core logic.
 */

export interface MetricThresholds {
  // Win Rate thresholds (0-1 scale)
  winRate: {
    excellent: number  // 80%+ win rate
    good: number       // 65%+ win rate
    fair: number       // 50%+ win rate
  }

  // ROI thresholds (decimal, 0.40 = 40% ROI)
  roi: {
    excellent: number  // 40%+ ROI
    good: number       // 20%+ ROI
    fair: number       // 10%+ ROI
  }

  // Sharpe Ratio thresholds
  sharpe: {
    excellent: number  // 2.0+ (excellent risk-adjusted returns)
    good: number       // 1.5+ (very good)
    fair: number       // 1.0+ (good)
  }
}

export interface CategoryConfig {
  // Unique category identifier
  name: string

  // Keywords for auto-categorization
  keywords: string[]

  // Difficulty multiplier (easier categories get lower scores for same performance)
  // 1.0 = baseline, >1.0 = harder (bonus), <1.0 = easier (penalty)
  difficultyMultiplier: number

  // Custom thresholds for this category (overrides defaults)
  thresholds?: Partial<MetricThresholds>

  // Description of what makes this category unique
  description: string
}

export interface ScoringWeights {
  // Base metric weights (must sum to 1.0)
  winRate: number      // How much win rate affects score
  roi: number          // How much ROI affects score
  sharpe: number       // How much Sharpe ratio affects score

  // Adjustment factors
  recencyDecay: number        // Decay rate for older trades (0-1, lower = more decay)
  minTradesForFullWeight: number  // Trades needed for full confidence (e.g., 10)
  consistencyBonus: number    // Max bonus for consistency (0-10 points)
}

/**
 * Default metric thresholds
 * These apply to all categories unless overridden
 */
export const DEFAULT_THRESHOLDS: MetricThresholds = {
  winRate: {
    excellent: 0.80,  // 80%+ win rate
    good: 0.65,       // 65-80%
    fair: 0.50,       // 50-65%
  },
  roi: {
    excellent: 0.40,  // 40%+ ROI
    good: 0.20,       // 20-40%
    fair: 0.10,       // 10-20%
  },
  sharpe: {
    excellent: 2.0,   // Excellent risk-adjusted returns
    good: 1.5,        // Very good
    fair: 1.0,        // Good
  },
}

/**
 * Scoring weights - adjust these to change how metrics are balanced
 */
export const SCORING_WEIGHTS: ScoringWeights = {
  // Base metric weights (sum = 1.0)
  winRate: 0.35,     // 35% - Winning consistently matters most
  roi: 0.35,         // 35% - Profitability is equally important
  sharpe: 0.30,      // 30% - Risk-adjusted returns matter

  // Adjustment factors
  recencyDecay: 0.95,           // Older trades decay by 5% per 30 days
  minTradesForFullWeight: 10,   // Need 10+ trades for full confidence
  consistencyBonus: 5,          // Up to 5 bonus points for consistency
}

/**
 * Category-specific configurations
 * Each category has custom difficulty and optionally custom thresholds
 */
export const CATEGORY_CONFIGS: Record<string, CategoryConfig> = {
  'Politics': {
    name: 'Politics',
    keywords: [
      'trump', 'biden', 'election', 'congress', 'senate', 'president',
      'xi jinping', 'putin', 'zelenskyy', 'powell', 'fed chair', 'governor',
      'kamala', 'desantis', 'democrat', 'republican', 'vote', 'poll'
    ],
    difficultyMultiplier: 1.1,  // 10% harder - polls can be misleading
    description: 'Political events and elections require understanding of polls, sentiment, and political dynamics',
    thresholds: {
      winRate: {
        excellent: 0.75,  // Slightly lower due to unpredictability
        good: 0.62,
        fair: 0.50,
      }
    }
  },

  'Economics': {
    name: 'Economics',
    keywords: [
      'fed', 'rate', 'interest', 'treasury', 'yield', 'inflation', 'recession',
      'gdp', 'unemployment', 'irs', 'tax', 'jobs report', 'cpi', 'ppi'
    ],
    difficultyMultiplier: 1.15, // 15% harder - requires economic expertise
    description: 'Economic indicators and Fed decisions require deep understanding of macroeconomics',
    thresholds: {
      roi: {
        excellent: 0.35,  // Economic markets can be more efficient
        good: 0.18,
        fair: 0.10,
      }
    }
  },

  'Commodities': {
    name: 'Commodities',
    keywords: [
      'egg', 'eggs', 'oil', 'gold', 'silver', 'wheat', 'corn', 'price of',
      'crude', 'commodity', 'agriculture', 'metal'
    ],
    difficultyMultiplier: 1.05, // 5% harder - data-driven but volatile
    description: 'Commodity price predictions based on supply/demand and market fundamentals',
  },

  'Crypto': {
    name: 'Crypto',
    keywords: [
      'bitcoin', 'ethereum', 'crypto', 'btc', 'eth', 'satoshi', 'microstrategy',
      'coinbase', 'binance', 'changpeng zhao', 'cz', 'solana', 'dogecoin', 'xrp',
      'ripple', 'sol', 'doge', 'up or down'
    ],
    difficultyMultiplier: 1.25, // 25% harder - extremely volatile
    description: 'Cryptocurrency markets are highly volatile and difficult to predict',
    thresholds: {
      sharpe: {
        excellent: 1.5,  // Lower Sharpe expectations due to volatility
        good: 1.0,
        fair: 0.7,
      }
    }
  },

  'Sports': {
    name: 'Sports',
    keywords: [
      'nfl', 'nba', 'mlb', 'nhl', 'super bowl', 'world series', 'finals',
      'championship', 'lebron', 'mahomes', 'sports', 'game', 'match'
    ],
    difficultyMultiplier: 1.3,  // 30% harder - most unpredictable
    description: 'Sports outcomes are highly unpredictable with many variables',
    thresholds: {
      winRate: {
        excellent: 0.70,  // Lower expectations for sports
        good: 0.58,
        fair: 0.48,
      }
    }
  },

  'Pop Culture': {
    name: 'Pop Culture',
    keywords: [
      'taylor swift', 'kardashian', 'mrbeast', 'tiktok', 'spotify', 'netflix',
      'oscar', 'grammy', 'emmy', 'celebrity', 'music', 'movie'
    ],
    difficultyMultiplier: 1.2,  // 20% harder - trend-based
    description: 'Pop culture trends and entertainment industry predictions',
  },

  'Science & Tech': {
    name: 'Science & Tech',
    keywords: [
      'ai', 'deepseek', 'openai', 'spacex', 'mars', 'nuclear', 'climate',
      'covid', 'vaccine', 'technology', 'innovation', 'research'
    ],
    difficultyMultiplier: 1.15, // 15% harder - requires technical knowledge
    description: 'Scientific breakthroughs and technology milestones',
  },

  'Global Events': {
    name: 'Global Events',
    keywords: [
      'taiwan', 'china', 'invasion', 'military', 'war', 'conflict', 'nato',
      'nuclear weapon', 'russia', 'ukraine', 'israel', 'gaza'
    ],
    difficultyMultiplier: 1.4,  // 40% harder - geopolitical complexity
    description: 'Geopolitical events and international relations predictions',
    thresholds: {
      winRate: {
        excellent: 0.68,  // Very difficult to predict
        good: 0.55,
        fair: 0.45,
      }
    }
  },

  'Other': {
    name: 'Other',
    keywords: [],
    difficultyMultiplier: 1.0,  // Baseline difficulty
    description: 'Miscellaneous markets that don\'t fit other categories',
  },
}

/**
 * Helper function to get category config with fallback to defaults
 */
export function getCategoryConfig(categoryName: string): CategoryConfig {
  return CATEGORY_CONFIGS[categoryName] || CATEGORY_CONFIGS['Other']
}

/**
 * Helper function to get thresholds for a category (merges category-specific with defaults)
 */
export function getCategoryThresholds(categoryName: string): MetricThresholds {
  const config = getCategoryConfig(categoryName)

  return {
    winRate: {
      ...DEFAULT_THRESHOLDS.winRate,
      ...(config.thresholds?.winRate || {}),
    },
    roi: {
      ...DEFAULT_THRESHOLDS.roi,
      ...(config.thresholds?.roi || {}),
    },
    sharpe: {
      ...DEFAULT_THRESHOLDS.sharpe,
      ...(config.thresholds?.sharpe || {}),
    },
  }
}

/**
 * Grade boundaries (consistent across all categories)
 */
export const GRADE_BOUNDARIES = {
  S: 90,  // 90-100: Elite performance
  A: 80,  // 80-89: Excellent
  B: 70,  // 70-79: Good
  C: 60,  // 60-69: Fair
  D: 50,  // 50-59: Below average
  F: 0,   // 0-49: Poor
}

/**
 * Specialization level boundaries (based on score + trade count)
 */
export const SPECIALIZATION_LEVELS = {
  Expert: { minScore: 85, minTrades: 10 },
  Advanced: { minScore: 70, minTrades: 5 },
  Intermediate: { minScore: 55, minTrades: 3 },
  Novice: { minScore: 0, minTrades: 1 },
}
