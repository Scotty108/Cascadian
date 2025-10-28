/**
 * Wallet Resolution Accuracy Analytics
 *
 * Computes "conviction accuracy" - whether a wallet held the winning side at resolution
 * This is distinct from P&L (which rewards trading) - this rewards prediction accuracy
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
})

interface ResolutionAccuracy {
  overall_pct: number
  markets_tracked: number
  top_category: string | null
  top_category_pct: number | null
  top_category_markets: number | null
}

/**
 * Get resolution accuracy for a wallet from ClickHouse
 *
 * Returns overall hit rate + top category hit rate
 * Returns null if ClickHouse unavailable or wallet has no data
 */
export async function getWalletResolutionAccuracy(
  walletAddress: string
): Promise<ResolutionAccuracy | null> {
  try {
    // Query overall accuracy
    const overallQuery = `
      SELECT
        COUNT(*) as markets_tracked,
        SUM(won) as wins,
        AVG(won) * 100 as hit_rate_pct
      FROM wallet_resolution_outcomes
      WHERE wallet_address = {wallet:String}
    `

    const overallResult = await clickhouse.query({
      query: overallQuery,
      format: 'JSONEachRow',
      query_params: { wallet: walletAddress },
    })

    const overallRows = (await overallResult.json()) as Array<{
      markets_tracked: string
      wins: string
      hit_rate_pct: string
    }>

    if (overallRows.length === 0 || parseInt(overallRows[0].markets_tracked) === 0) {
      return null
    }

    const marketsTracked = parseInt(overallRows[0].markets_tracked)
    const overallPct = parseFloat(overallRows[0].hit_rate_pct)

    // Query per-category accuracy to find top category (min 5 markets)
    const categoryQuery = `
      SELECT
        canonical_category,
        COUNT(*) as markets_tracked,
        SUM(won) as wins,
        AVG(won) * 100 as hit_rate_pct
      FROM wallet_resolution_outcomes
      WHERE wallet_address = {wallet:String}
        AND canonical_category != 'Uncategorized'
      GROUP BY canonical_category
      HAVING COUNT(*) >= 5
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `

    const categoryResult = await clickhouse.query({
      query: categoryQuery,
      format: 'JSONEachRow',
      query_params: { wallet: walletAddress },
    })

    const categoryRows = (await categoryResult.json()) as Array<{
      canonical_category: string
      markets_tracked: string
      wins: string
      hit_rate_pct: string
    }>

    let topCategory: string | null = null
    let topCategoryPct: number | null = null
    let topCategoryMarkets: number | null = null

    if (categoryRows.length > 0) {
      topCategory = categoryRows[0].canonical_category
      topCategoryPct = parseFloat(categoryRows[0].hit_rate_pct)
      topCategoryMarkets = parseInt(categoryRows[0].markets_tracked)
    }

    return {
      overall_pct: overallPct,
      markets_tracked: marketsTracked,
      top_category: topCategory,
      top_category_pct: topCategoryPct,
      top_category_markets: topCategoryMarkets,
    }
  } catch (error) {
    console.error('Failed to get wallet resolution accuracy:', error)
    return null // Degrade gracefully
  }
}

/**
 * Generate resolution accuracy blurb
 */
export function generateResolutionBlurb(accuracy: ResolutionAccuracy | null): string {
  if (!accuracy) {
    return 'Resolution accuracy pending enrichment'
  }

  // If they have a qualifying top category (count >= 5), use category-specific blurb
  if (accuracy.top_category && accuracy.top_category_pct !== null && accuracy.top_category_markets !== null) {
    return `${accuracy.top_category_pct.toFixed(0)}% resolution accuracy in ${accuracy.top_category} across ${accuracy.top_category_markets} settled markets`
  }

  // Otherwise use overall accuracy
  return `${accuracy.overall_pct.toFixed(0)}% resolution accuracy across ${accuracy.markets_tracked} settled markets`
}

/**
 * Close ClickHouse connection
 */
export async function closeClickHouse() {
  await clickhouse.close()
}
