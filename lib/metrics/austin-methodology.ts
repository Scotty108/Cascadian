/**
 * Austin Methodology: Top-Down Category Analysis
 *
 * Find "winnable games" by analyzing categories from the top down:
 * 1. Identify best categories where elite wallets succeed
 * 2. Find best markets within those categories
 * 3. Follow elite wallets who dominate that category
 *
 * Winnability Criteria (Austin's "Winnable Game"):
 * - Elite wallet count >= 20 (enough smart money)
 * - Median omega of elites >= 2.0 (they're actually winning)
 * - Mean CLV >= 0.02 (2% edge on closing prices)
 * - Avg EV per hour >= $10 (worth the time)
 * - Total volume >= $100k (liquid enough)
 *
 * Winnability Score Formula:
 * - (eliteCount / 50) × 25 = Max 25 points
 * - (medianOmega / 5) × 25 = Max 25 points
 * - (meanCLV / 0.05) × 20 = Max 20 points
 * - (avgEVPerHour / 20) × 20 = Max 20 points
 * - (totalVolume / 1000000) × 10 = Max 10 points
 * Total: 100 points
 */

import { clickhouse } from '@/lib/clickhouse/client'
import { supabaseAdmin } from '@/lib/supabase'

// ============================================================================
// Types
// ============================================================================

export interface CategoryAnalysis {
  category: string
  categoryRank: number // 1 = best category

  // Elite Performance
  eliteWalletCount: number
  medianOmegaOfElites: number
  meanCLVOfElites: number
  avgEVPerHour: number

  // Market Data
  totalVolumeUsd: number
  avgMarketLiquidity: number
  activeMarketCount: number

  // Top Markets in Category
  topMarkets: MarketAnalysis[]

  // Specialists
  topSpecialists: WalletSpecialist[]

  // Recommendation
  isWinnableGame: boolean // Meets Austin's criteria
  winnabilityScore: number // 0-100 composite score

  // Additional Analytics
  window?: string
  calculatedAt: Date
}

export interface MarketAnalysis {
  marketId: string
  question: string
  volume24h: number
  liquidity: number
  eliteParticipation: number // % of elites who traded this
  avgEliteOmega: number
  tsiSignal?: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  conviction?: number
}

export interface WalletSpecialist {
  walletAddress: string
  categoryOmega: number
  tradesInCategory: number
  pctOfWalletTrades: number // What % of their trades are in this category
  isInsider: boolean
}

export interface CategoryRankingRow {
  category: string
  elite_wallet_count: string
  median_omega_of_elites: string
  mean_clv_of_elites: string
  avg_ev_per_hour: string
  total_volume_usd: string
  avg_market_liquidity: string
  total_markets: string
  active_markets_24h: string
  calculated_at: string
}

export interface TopMarketRow {
  market_id: string
  question: string
  volume_24h: string
  liquidity: string
  elite_participation: string
  avg_elite_omega: string
}

export interface CategorySpecialistRow {
  wallet_address: string
  category_omega: string
  trades_in_category: string
  pct_of_wallet_trades: string
  is_likely_insider: boolean
}

// ============================================================================
// Constants
// ============================================================================

export const WINNABILITY_THRESHOLDS = {
  MIN_ELITE_WALLETS: 20,
  MIN_MEDIAN_OMEGA: 2.0,
  MIN_MEAN_CLV: 0.02,
  MIN_AVG_EV_PER_HOUR: 10,
  MIN_TOTAL_VOLUME: 100000,
} as const

export const WINNABILITY_WEIGHTS = {
  ELITE_COUNT_MAX: 50,
  ELITE_COUNT_POINTS: 25,
  MEDIAN_OMEGA_MAX: 5,
  MEDIAN_OMEGA_POINTS: 25,
  MEAN_CLV_MAX: 0.05,
  MEAN_CLV_POINTS: 20,
  EV_PER_HOUR_MAX: 20,
  EV_PER_HOUR_POINTS: 20,
  TOTAL_VOLUME_MAX: 1000000,
  TOTAL_VOLUME_POINTS: 10,
} as const

// ============================================================================
// Cache Layer
// ============================================================================

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const cache = new Map<string, CacheEntry<any>>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null

  const age = Date.now() - entry.timestamp
  if (age > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }

  return entry.data as T
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
  })
}

function clearCache(): void {
  cache.clear()
}

// ============================================================================
// Winnability Calculation
// ============================================================================

/**
 * Calculate winnability score (0-100) based on Austin's criteria
 */
export function calculateWinnabilityScore(analysis: CategoryAnalysis): number {
  const {
    eliteWalletCount,
    medianOmegaOfElites,
    meanCLVOfElites,
    avgEVPerHour,
    totalVolumeUsd,
  } = analysis

  // Elite count contribution (max 25 points)
  const eliteCountScore = Math.min(
    (eliteWalletCount / WINNABILITY_WEIGHTS.ELITE_COUNT_MAX) *
      WINNABILITY_WEIGHTS.ELITE_COUNT_POINTS,
    WINNABILITY_WEIGHTS.ELITE_COUNT_POINTS
  )

  // Median omega contribution (max 25 points)
  const medianOmegaScore = Math.min(
    (medianOmegaOfElites / WINNABILITY_WEIGHTS.MEDIAN_OMEGA_MAX) *
      WINNABILITY_WEIGHTS.MEDIAN_OMEGA_POINTS,
    WINNABILITY_WEIGHTS.MEDIAN_OMEGA_POINTS
  )

  // Mean CLV contribution (max 20 points)
  const meanCLVScore = Math.min(
    (meanCLVOfElites / WINNABILITY_WEIGHTS.MEAN_CLV_MAX) *
      WINNABILITY_WEIGHTS.MEAN_CLV_POINTS,
    WINNABILITY_WEIGHTS.MEAN_CLV_POINTS
  )

  // EV per hour contribution (max 20 points)
  const evPerHourScore = Math.min(
    (avgEVPerHour / WINNABILITY_WEIGHTS.EV_PER_HOUR_MAX) *
      WINNABILITY_WEIGHTS.EV_PER_HOUR_POINTS,
    WINNABILITY_WEIGHTS.EV_PER_HOUR_POINTS
  )

  // Total volume contribution (max 10 points)
  const volumeScore = Math.min(
    (totalVolumeUsd / WINNABILITY_WEIGHTS.TOTAL_VOLUME_MAX) *
      WINNABILITY_WEIGHTS.TOTAL_VOLUME_POINTS,
    WINNABILITY_WEIGHTS.TOTAL_VOLUME_POINTS
  )

  return eliteCountScore + medianOmegaScore + meanCLVScore + evPerHourScore + volumeScore
}

/**
 * Check if category meets winnability criteria
 */
export function isWinnableGame(analysis: CategoryAnalysis): boolean {
  const {
    eliteWalletCount,
    medianOmegaOfElites,
    meanCLVOfElites,
    avgEVPerHour,
    totalVolumeUsd,
  } = analysis

  return (
    eliteWalletCount >= WINNABILITY_THRESHOLDS.MIN_ELITE_WALLETS &&
    medianOmegaOfElites >= WINNABILITY_THRESHOLDS.MIN_MEDIAN_OMEGA &&
    meanCLVOfElites >= WINNABILITY_THRESHOLDS.MIN_MEAN_CLV &&
    avgEVPerHour >= WINNABILITY_THRESHOLDS.MIN_AVG_EV_PER_HOUR &&
    totalVolumeUsd >= WINNABILITY_THRESHOLDS.MIN_TOTAL_VOLUME
  )
}

// ============================================================================
// Category Rankings
// ============================================================================

/**
 * Get all categories ranked by winnability
 */
export async function analyzeCategories(
  window: '24h' | '7d' | '30d' | 'lifetime' = '30d',
  limit: number = 20
): Promise<CategoryAnalysis[]> {
  const cacheKey = `categories:${window}:${limit}`
  const cached = getCached<CategoryAnalysis[]>(cacheKey)
  if (cached) {
    console.log(`[Austin] Cache hit for ${cacheKey}`)
    return cached
  }

  console.log(`[Austin] Analyzing categories (window: ${window}, limit: ${limit})...`)

  try {
    // Get category rankings from ClickHouse
    const query = `
      SELECT
        category,
        elite_wallet_count,
        median_omega_of_elites,
        mean_clv_of_elites,
        COALESCE(avg_ev_per_hour, 0) as avg_ev_per_hour,
        total_volume_usd,
        COALESCE(avg_market_liquidity, 0) as avg_market_liquidity,
        total_markets,
        active_markets_24h,
        calculated_at
      FROM category_analytics
      WHERE window = '${window}'
      ORDER BY
        elite_wallet_count DESC,
        median_omega_of_elites DESC
      LIMIT ${limit}
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const rows = (await result.json()) as CategoryRankingRow[]

    if (rows.length === 0) {
      console.warn('[Austin] No category data found. Run refreshCategoryAnalytics().')
      return []
    }

    // Process each category
    const analyses = await Promise.all(
      rows.map(async (row, index) => {
        const analysis: CategoryAnalysis = {
          category: row.category,
          categoryRank: index + 1,
          eliteWalletCount: parseInt(row.elite_wallet_count),
          medianOmegaOfElites: parseFloat(row.median_omega_of_elites),
          meanCLVOfElites: parseFloat(row.mean_clv_of_elites),
          avgEVPerHour: parseFloat(row.avg_ev_per_hour),
          totalVolumeUsd: parseFloat(row.total_volume_usd),
          avgMarketLiquidity: parseFloat(row.avg_market_liquidity),
          activeMarketCount: parseInt(row.active_markets_24h),
          topMarkets: [],
          topSpecialists: [],
          isWinnableGame: false,
          winnabilityScore: 0,
          window,
          calculatedAt: new Date(row.calculated_at),
        }

        // Calculate winnability
        analysis.winnabilityScore = calculateWinnabilityScore(analysis)
        analysis.isWinnableGame = isWinnableGame(analysis)

        return analysis
      })
    )

    setCache(cacheKey, analyses)
    console.log(`[Austin] Analyzed ${analyses.length} categories`)

    return analyses
  } catch (error) {
    console.error('[Austin] Failed to analyze categories:', error)
    throw error
  }
}

/**
 * Get detailed analysis for a specific category
 */
export async function getCategoryAnalysis(
  category: string,
  window: '24h' | '7d' | '30d' | 'lifetime' = '30d',
  includeMarkets: boolean = true,
  includeSpecialists: boolean = true
): Promise<CategoryAnalysis | null> {
  const cacheKey = `category:${category}:${window}:${includeMarkets}:${includeSpecialists}`
  const cached = getCached<CategoryAnalysis>(cacheKey)
  if (cached) {
    console.log(`[Austin] Cache hit for ${cacheKey}`)
    return cached
  }

  console.log(`[Austin] Analyzing category: ${category}...`)

  try {
    // Get category data from ClickHouse
    const query = `
      SELECT
        category,
        elite_wallet_count,
        median_omega_of_elites,
        mean_clv_of_elites,
        COALESCE(avg_ev_per_hour, 0) as avg_ev_per_hour,
        total_volume_usd,
        COALESCE(avg_market_liquidity, 0) as avg_market_liquidity,
        total_markets,
        active_markets_24h,
        calculated_at
      FROM category_analytics
      WHERE category = '${category}'
        AND window = '${window}'
      LIMIT 1
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const rows = (await result.json()) as CategoryRankingRow[]

    if (rows.length === 0) {
      console.warn(`[Austin] No data found for category: ${category}`)
      return null
    }

    const row = rows[0]
    const analysis: CategoryAnalysis = {
      category: row.category,
      categoryRank: 0, // Will be set if needed
      eliteWalletCount: parseInt(row.elite_wallet_count),
      medianOmegaOfElites: parseFloat(row.median_omega_of_elites),
      meanCLVOfElites: parseFloat(row.mean_clv_of_elites),
      avgEVPerHour: parseFloat(row.avg_ev_per_hour),
      totalVolumeUsd: parseFloat(row.total_volume_usd),
      avgMarketLiquidity: parseFloat(row.avg_market_liquidity),
      activeMarketCount: parseInt(row.active_markets_24h),
      topMarkets: [],
      topSpecialists: [],
      isWinnableGame: false,
      winnabilityScore: 0,
      window,
      calculatedAt: new Date(row.calculated_at),
    }

    // Calculate winnability
    analysis.winnabilityScore = calculateWinnabilityScore(analysis)
    analysis.isWinnableGame = isWinnableGame(analysis)

    // Get top markets in category
    if (includeMarkets) {
      analysis.topMarkets = await getTopMarketsInCategory(category, 10)
    }

    // Get top specialists
    if (includeSpecialists) {
      analysis.topSpecialists = await getCategorySpecialists(category, 20)
    }

    setCache(cacheKey, analysis)
    console.log(`[Austin] Analyzed category: ${category}`)

    return analysis
  } catch (error) {
    console.error(`[Austin] Failed to analyze category ${category}:`, error)
    throw error
  }
}

// ============================================================================
// Top Markets in Category
// ============================================================================

/**
 * Get top markets in a category by elite participation
 */
export async function getTopMarketsInCategory(
  category: string,
  limit: number = 10
): Promise<MarketAnalysis[]> {
  console.log(`[Austin] Getting top markets in ${category}...`)

  try {
    // Query top markets from Supabase + ClickHouse data
    // This is a simplified version - in production you'd join with trades data
    const { data: markets, error } = await supabaseAdmin
      .from('markets')
      .select('id, question, volume_24h, liquidity, category')
      .eq('category', category)
      .eq('active', true)
      .order('volume_24h', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[Austin] Failed to fetch markets:', error)
      return []
    }

    if (!markets || markets.length === 0) {
      return []
    }

    // For each market, get elite participation stats from ClickHouse
    const marketAnalyses = await Promise.all(
      markets.map(async (market) => {
        const eliteStats = await getMarketEliteStats(market.id)

        return {
          marketId: market.id,
          question: market.question,
          volume24h: parseFloat(market.volume_24h || '0'),
          liquidity: parseFloat(market.liquidity || '0'),
          eliteParticipation: eliteStats.participationPct,
          avgEliteOmega: eliteStats.avgOmega,
        }
      })
    )

    console.log(`[Austin] Found ${marketAnalyses.length} top markets`)
    return marketAnalyses
  } catch (error) {
    console.error('[Austin] Failed to get top markets:', error)
    return []
  }
}

/**
 * Get elite participation stats for a market
 */
async function getMarketEliteStats(
  marketId: string
): Promise<{ participationPct: number; avgOmega: number }> {
  try {
    // Get condition_id from market
    const { data: market } = await supabaseAdmin
      .from('markets')
      .select('condition_id')
      .eq('id', marketId)
      .single()

    if (!market?.condition_id) {
      return { participationPct: 0, avgOmega: 0 }
    }

    // Query elite participation from ClickHouse
    const query = `
      WITH elite_wallets AS (
        SELECT DISTINCT wallet_address
        FROM wallet_metrics_complete
        WHERE metric_2_omega_net > 2.0
          AND metric_22_resolved_bets >= 50
      ),
      market_traders AS (
        SELECT DISTINCT wallet_address
        FROM trades_raw
        WHERE condition_id = '${market.condition_id.toLowerCase()}'
          AND timestamp >= now() - INTERVAL 7 DAY
      )
      SELECT
        countDistinct(mt.wallet_address) as total_traders,
        countDistinctIf(mt.wallet_address, ew.wallet_address IS NOT NULL) as elite_traders,
        avgIf(wmc.metric_2_omega_net, ew.wallet_address IS NOT NULL) as avg_elite_omega
      FROM market_traders mt
      LEFT JOIN elite_wallets ew ON mt.wallet_address = ew.wallet_address
      LEFT JOIN wallet_metrics_complete wmc ON mt.wallet_address = wmc.wallet_address
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const rows = (await result.json()) as Array<{
      total_traders: string
      elite_traders: string
      avg_elite_omega: string
    }>

    if (rows.length === 0) {
      return { participationPct: 0, avgOmega: 0 }
    }

    const totalTraders = parseInt(rows[0].total_traders)
    const eliteTraders = parseInt(rows[0].elite_traders)
    const avgOmega = parseFloat(rows[0].avg_elite_omega || '0')

    const participationPct = totalTraders > 0 ? eliteTraders / totalTraders : 0

    return {
      participationPct,
      avgOmega,
    }
  } catch (error) {
    console.error(`[Austin] Failed to get elite stats for market ${marketId}:`, error)
    return { participationPct: 0, avgOmega: 0 }
  }
}

// ============================================================================
// Category Specialists
// ============================================================================

/**
 * Get top specialists in a category
 */
export async function getCategorySpecialists(
  category: string,
  limit: number = 20
): Promise<WalletSpecialist[]> {
  console.log(`[Austin] Getting specialists for ${category}...`)

  try {
    // Get specialists from Supabase wallet_category_tags
    const { data: specialists, error } = await supabaseAdmin
      .from('wallet_category_tags')
      .select(
        'wallet_address, category_omega, trades_in_category, pct_of_wallet_trades, is_likely_insider'
      )
      .eq('category', category)
      .eq('is_likely_specialist', true)
      .order('category_omega', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[Austin] Failed to fetch specialists:', error)
      return []
    }

    if (!specialists || specialists.length === 0) {
      return []
    }

    const walletSpecialists: WalletSpecialist[] = specialists.map((s) => ({
      walletAddress: s.wallet_address,
      categoryOmega: parseFloat(s.category_omega || '0'),
      tradesInCategory: s.trades_in_category || 0,
      pctOfWalletTrades: parseFloat(s.pct_of_wallet_trades || '0'),
      isInsider: s.is_likely_insider || false,
    }))

    console.log(`[Austin] Found ${walletSpecialists.length} specialists`)
    return walletSpecialists
  } catch (error) {
    console.error('[Austin] Failed to get category specialists:', error)
    return []
  }
}

// ============================================================================
// Analytics Refresh
// ============================================================================

/**
 * Refresh category analytics (should be called on cron schedule)
 */
export async function refreshCategoryAnalytics(
  window: '24h' | '7d' | '30d' | 'lifetime' = '30d'
): Promise<void> {
  console.log(`[Austin] Refreshing category analytics (window: ${window})...`)

  try {
    // Calculate analytics for each category
    const query = `
      INSERT INTO category_analytics
      SELECT
        m.category as category,
        '${window}' as window,

        -- Elite Performance
        countDistinctIf(
          t.wallet_address,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as elite_wallet_count,

        quantileIf(0.5)(
          wmc.metric_2_omega_net,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as median_omega_of_elites,

        avgIf(
          wmc.metric_28_clv_mean,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as mean_clv_of_elites,

        quantileIf(0.75)(
          wmc.metric_2_omega_net,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as percentile_75_omega,

        quantileIf(0.25)(
          wmc.metric_2_omega_net,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as percentile_25_omega,

        -- Market Stats
        countDistinct(m.market_id) as total_markets,
        countDistinctIf(m.market_id, m.updated_at >= now() - INTERVAL 24 HOUR) as active_markets_24h,
        countDistinctIf(m.market_id, m.resolved = true AND m.end_date >= now() - INTERVAL 7 DAY) as resolved_markets_7d,
        avgIf(
          dateDiff('day', m.created_at, m.end_date),
          m.resolved = true
        ) as avg_time_to_resolution_days,

        -- Volume Stats
        sum(t.size_usd) as total_volume_usd,
        sumIf(
          t.size_usd,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as elite_volume_usd,
        sumIf(
          t.size_usd,
          wmc.metric_2_omega_net <= 2.0 OR wmc.metric_22_resolved_bets < 50
        ) as crowd_volume_usd,
        sumIf(t.size_usd, t.timestamp >= now() - INTERVAL 24 HOUR) as volume_24h,

        -- Competition Metrics
        countDistinct(t.wallet_address) / countDistinct(m.market_id) as avg_wallets_per_market,

        -- Placeholder values (would need more complex queries)
        0.5 as specialist_concentration,
        0.0 as barrier_to_entry_score,
        0.0 as avg_edge_half_life_hours,
        0.0 as avg_latency_penalty_index,
        0.0 as avg_holding_period_hours,
        0.0 as news_driven_pct,

        now() as calculated_at

      FROM markets m
      INNER JOIN trades_raw t ON m.condition_id = t.condition_id
      LEFT JOIN wallet_metrics_complete wmc ON t.wallet_address = wmc.wallet_address
      WHERE 1=1
        ${window !== 'lifetime' ? `AND t.timestamp >= now() - INTERVAL ${window === '24h' ? '24 HOUR' : window === '7d' ? '7 DAY' : '30 DAY'}` : ''}
      GROUP BY m.category
      HAVING elite_wallet_count > 0
    `

    await clickhouse.command({
      query,
    })

    // Clear cache after refresh
    clearCache()

    console.log(`[Austin] ✅ Category analytics refreshed for window: ${window}`)
  } catch (error) {
    console.error('[Austin] Failed to refresh category analytics:', error)
    throw error
  }
}

/**
 * Create ClickHouse materialized view for real-time analytics
 */
export async function createCategoryAnalyticsMV(): Promise<void> {
  console.log('[Austin] Creating category analytics materialized view...')

  try {
    const query = `
      CREATE MATERIALIZED VIEW IF NOT EXISTS category_analytics_mv
      TO category_analytics
      AS
      SELECT
        m.category as category,
        '30d' as window,
        countDistinctIf(
          t.wallet_address,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as elite_wallet_count,
        quantileIf(0.5)(
          wmc.metric_2_omega_net,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as median_omega_of_elites,
        avgIf(
          wmc.metric_28_clv_mean,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as mean_clv_of_elites,
        quantileIf(0.75)(
          wmc.metric_2_omega_net,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as percentile_75_omega,
        quantileIf(0.25)(
          wmc.metric_2_omega_net,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as percentile_25_omega,
        countDistinct(m.market_id) as total_markets,
        countDistinctIf(m.market_id, m.updated_at >= now() - INTERVAL 24 HOUR) as active_markets_24h,
        0 as resolved_markets_7d,
        0 as avg_time_to_resolution_days,
        sum(t.size_usd) as total_volume_usd,
        sumIf(
          t.size_usd,
          wmc.metric_2_omega_net > 2.0 AND wmc.metric_22_resolved_bets >= 50
        ) as elite_volume_usd,
        sumIf(
          t.size_usd,
          wmc.metric_2_omega_net <= 2.0 OR wmc.metric_22_resolved_bets < 50
        ) as crowd_volume_usd,
        sumIf(t.size_usd, t.timestamp >= now() - INTERVAL 24 HOUR) as volume_24h,
        countDistinct(t.wallet_address) / countDistinct(m.market_id) as avg_wallets_per_market,
        0.5 as specialist_concentration,
        0.0 as barrier_to_entry_score,
        0.0 as avg_edge_half_life_hours,
        0.0 as avg_latency_penalty_index,
        0.0 as avg_holding_period_hours,
        0.0 as news_driven_pct,
        now() as calculated_at
      FROM markets m
      INNER JOIN trades_raw t ON m.condition_id = t.condition_id
      LEFT JOIN wallet_metrics_complete wmc ON t.wallet_address = wmc.wallet_address
      WHERE t.timestamp >= now() - INTERVAL 30 DAY
      GROUP BY m.category
    `

    await clickhouse.command({
      query,
    })

    console.log('[Austin] ✅ Materialized view created')
  } catch (error) {
    console.error('[Austin] Failed to create materialized view:', error)
    throw error
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get winnable categories only
 */
export async function getWinnableCategories(
  window: '24h' | '7d' | '30d' | 'lifetime' = '30d',
  limit: number = 20
): Promise<CategoryAnalysis[]> {
  const allCategories = await analyzeCategories(window, limit)
  return allCategories.filter((c) => c.isWinnableGame)
}

/**
 * Get category recommendation for a user
 */
export async function getCategoryRecommendation(
  preferredCategories?: string[]
): Promise<CategoryAnalysis | null> {
  const categories = await analyzeCategories('30d', 50)

  // Filter by preferred categories if provided
  let filtered = categories
  if (preferredCategories && preferredCategories.length > 0) {
    filtered = categories.filter((c) => preferredCategories.includes(c.category))
  }

  // Sort by winnability score
  filtered.sort((a, b) => b.winnabilityScore - a.winnabilityScore)

  return filtered.length > 0 ? filtered[0] : null
}

/**
 * Export category analysis to JSON for API
 */
export function exportCategoryAnalysis(analysis: CategoryAnalysis): Record<string, any> {
  return {
    category: analysis.category,
    categoryRank: analysis.categoryRank,
    metrics: {
      eliteWalletCount: analysis.eliteWalletCount,
      medianOmegaOfElites: analysis.medianOmegaOfElites,
      meanCLVOfElites: analysis.meanCLVOfElites,
      avgEVPerHour: analysis.avgEVPerHour,
      totalVolumeUsd: analysis.totalVolumeUsd,
      avgMarketLiquidity: analysis.avgMarketLiquidity,
      activeMarketCount: analysis.activeMarketCount,
    },
    winnability: {
      isWinnableGame: analysis.isWinnableGame,
      winnabilityScore: analysis.winnabilityScore,
      criteria: {
        hasEnoughElites: analysis.eliteWalletCount >= WINNABILITY_THRESHOLDS.MIN_ELITE_WALLETS,
        hasHighOmega: analysis.medianOmegaOfElites >= WINNABILITY_THRESHOLDS.MIN_MEDIAN_OMEGA,
        hasEdge: analysis.meanCLVOfElites >= WINNABILITY_THRESHOLDS.MIN_MEAN_CLV,
        isWorthTime: analysis.avgEVPerHour >= WINNABILITY_THRESHOLDS.MIN_AVG_EV_PER_HOUR,
        hasLiquidity: analysis.totalVolumeUsd >= WINNABILITY_THRESHOLDS.MIN_TOTAL_VOLUME,
      },
    },
    topMarkets: analysis.topMarkets.slice(0, 5),
    topSpecialists: analysis.topSpecialists.slice(0, 10),
    calculatedAt: analysis.calculatedAt.toISOString(),
  }
}
