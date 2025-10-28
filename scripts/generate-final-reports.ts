#!/usr/bin/env tsx
/**
 * Generate Final Reports (Phase 5)
 *
 * PURPOSE:
 * Produce final JSON artifacts for demo / investor narrative after overnight enrichment.
 * Combines P&L, coverage, category specialization, AND resolution accuracy.
 *
 * WHAT THIS REPORTS:
 * - Total trades, wallets, resolution outcomes
 * - Data quality metrics (market_id coverage, resolved trades %)
 * - Global resolution accuracy (% of markets where wallets held winning side)
 * - Per-wallet summary:
 *   * P&L total and by category
 *   * Resolution accuracy overall and by top category
 *   * Category specialization
 *
 * RESOLUTION ACCURACY:
 * This metric answers: "Were they actually right about outcomes?"
 * Formula: AVG(won) * 100 from wallet_resolution_outcomes
 * Where won = 1 if final_side === resolved_outcome, else 0
 *
 * OUTPUT FILES:
 * - runtime/overnight-final-summary.json (comprehensive report)
 * - Console: OVERNIGHT_COMPLETE: {json} (machine-readable)
 *
 * SAFETY:
 * This script does not launch long-running ingestion loops or ClickHouse mutations automatically.
 * You must explicitly call main() to execute.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

const SUMMARY_FILE = resolve(process.cwd(), 'runtime/overnight-final-summary.json')

interface WalletSummary {
  wallet_address: string
  realized_pnl_usd_total: number
  coverage_pct: number
  top_category: string
  top_category_pnl_usd: number
  top_category_markets_sampled: number
  resolution_accuracy_pct_overall: number
  resolution_accuracy_pct_top_category: number
  markets_scored: number
}

interface FinalSummary {
  timestamp: string
  totals: {
    trades_total: number
    trades_new_from_goldsky: number
    wallets_total: number
    wallets_with_resolution_accuracy: number
    resolution_outcomes_total: number
    market_id_coverage_pct: number
    resolved_trades_pct: number
    avg_resolution_accuracy_pct: number
    resolution_markets_tracked: number
  }
  wallets: WalletSummary[]
}

/**
 * Get per-wallet category breakdown (P&L by category)
 */
async function getPerWalletCategoryBreakdown(): Promise<Map<string, any[]>> {
  console.log('  Querying per-wallet category breakdown...')

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          canonical_category,
          SUM(realized_pnl_usd) as pnl_usd,
          COUNT(DISTINCT condition_id) as num_markets
        FROM trades_raw
        WHERE is_resolved = 1
          AND canonical_category IS NOT NULL
          AND canonical_category != ''
        GROUP BY wallet_address, canonical_category
        ORDER BY wallet_address, pnl_usd DESC
      `,
      format: 'JSONEachRow'
    })

    const rows = await result.json() as Array<{
      wallet_address: string
      canonical_category: string
      pnl_usd: string
      num_markets: string
    }>

    const categoryMap = new Map<string, any[]>()

    for (const row of rows) {
      const wallet = row.wallet_address
      if (!categoryMap.has(wallet)) {
        categoryMap.set(wallet, [])
      }

      categoryMap.get(wallet)!.push({
        canonical_category: row.canonical_category,
        pnl_usd: parseFloat(row.pnl_usd),
        num_markets: parseInt(row.num_markets)
      })
    }

    // Sort each wallet's categories by P&L descending
    for (const [wallet, categories] of categoryMap.entries()) {
      categories.sort((a, b) => b.pnl_usd - a.pnl_usd)
    }

    console.log(`  ✓ Found category data for ${categoryMap.size} wallets`)
    return categoryMap
  } catch (error) {
    console.error('  ✗ Error querying category breakdown:', error)
    return new Map()
  }
}

/**
 * Get per-wallet resolution accuracy (overall)
 */
async function getPerWalletResolutionAccuracy(): Promise<Map<string, { accuracy_pct: number; markets_scored: number }>> {
  console.log('  Querying per-wallet resolution accuracy...')

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          AVG(won) * 100 as accuracy_pct,
          COUNT(DISTINCT condition_id) as markets_scored
        FROM wallet_resolution_outcomes
        GROUP BY wallet_address
      `,
      format: 'JSONEachRow'
    })

    const rows = await result.json() as Array<{
      wallet_address: string
      accuracy_pct: string
      markets_scored: string
    }>

    const accuracyMap = new Map<string, { accuracy_pct: number; markets_scored: number }>()

    for (const row of rows) {
      accuracyMap.set(row.wallet_address, {
        accuracy_pct: parseFloat(row.accuracy_pct),
        markets_scored: parseInt(row.markets_scored)
      })
    }

    console.log(`  ✓ Found accuracy data for ${accuracyMap.size} wallets`)
    return accuracyMap
  } catch (error) {
    console.error('  ✗ Error querying wallet accuracy:', error)
    return new Map()
  }
}

/**
 * Get per-wallet, per-category resolution accuracy
 */
async function getPerWalletCategoryAccuracy(): Promise<Map<string, Map<string, { accuracy_pct: number; markets_scored: number }>>> {
  console.log('  Querying per-wallet, per-category resolution accuracy...')

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          canonical_category,
          AVG(won) * 100 as accuracy_pct,
          COUNT(DISTINCT condition_id) as markets_scored
        FROM wallet_resolution_outcomes
        WHERE canonical_category IS NOT NULL
          AND canonical_category != ''
        GROUP BY wallet_address, canonical_category
        HAVING markets_scored >= 5
      `,
      format: 'JSONEachRow'
    })

    const rows = await result.json() as Array<{
      wallet_address: string
      canonical_category: string
      accuracy_pct: string
      markets_scored: string
    }>

    const categoryAccuracyMap = new Map<string, Map<string, { accuracy_pct: number; markets_scored: number }>>()

    for (const row of rows) {
      if (!categoryAccuracyMap.has(row.wallet_address)) {
        categoryAccuracyMap.set(row.wallet_address, new Map())
      }

      categoryAccuracyMap.get(row.wallet_address)!.set(row.canonical_category, {
        accuracy_pct: parseFloat(row.accuracy_pct),
        markets_scored: parseInt(row.markets_scored)
      })
    }

    console.log(`  ✓ Found category accuracy data for ${categoryAccuracyMap.size} wallets`)
    return categoryAccuracyMap
  } catch (error) {
    console.error('  ✗ Error querying category accuracy:', error)
    return new Map()
  }
}

/**
 * Get global totals
 *
 * Includes global resolution accuracy: AVG(won) * 100 across all wallet_resolution_outcomes
 * and resolution_markets_tracked: COUNT(DISTINCT condition_id)
 */
async function getGlobalTotals() {
  console.log('  Querying global totals...')

  try {
    // Total trades
    const totalTradesResult = await clickhouse.query({
      query: 'SELECT count() as total FROM trades_raw',
      format: 'JSONEachRow'
    })
    const totalTradesData = await totalTradesResult.json() as Array<{ total: string }>
    const trades_total = parseInt(totalTradesData[0].total)

    // Trades with market_id
    const marketIdCoverageResult = await clickhouse.query({
      query: "SELECT count() as total FROM trades_raw WHERE market_id != ''",
      format: 'JSONEachRow'
    })
    const marketIdCoverageData = await marketIdCoverageResult.json() as Array<{ total: string }>
    const trades_with_market_id = parseInt(marketIdCoverageData[0].total)

    // Resolved trades
    const resolvedTradesResult = await clickhouse.query({
      query: 'SELECT count() as total FROM trades_raw WHERE is_resolved = 1',
      format: 'JSONEachRow'
    })
    const resolvedTradesData = await resolvedTradesResult.json() as Array<{ total: string }>
    const resolved_trades = parseInt(resolvedTradesData[0].total)

    // Total wallets
    const totalWalletsResult = await clickhouse.query({
      query: 'SELECT count(DISTINCT wallet_address) as total FROM trades_raw',
      format: 'JSONEachRow'
    })
    const totalWalletsData = await totalWalletsResult.json() as Array<{ total: string }>
    const wallets_total = parseInt(totalWalletsData[0].total)

    // Wallets with resolution accuracy
    const walletsWithAccuracyResult = await clickhouse.query({
      query: 'SELECT count(DISTINCT wallet_address) as total FROM wallet_resolution_outcomes',
      format: 'JSONEachRow'
    })
    const walletsWithAccuracyData = await walletsWithAccuracyResult.json() as Array<{ total: string }>
    const wallets_with_resolution_accuracy = parseInt(walletsWithAccuracyData[0].total)

    // Resolution outcomes metrics
    const resolutionMetricsResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_outcomes,
          AVG(won) * 100 as avg_accuracy_pct,
          count(DISTINCT condition_id) as markets_tracked
        FROM wallet_resolution_outcomes
      `,
      format: 'JSONEachRow'
    })
    const resolutionMetricsData = await resolutionMetricsResult.json() as Array<{
      total_outcomes: string
      avg_accuracy_pct: string
      markets_tracked: string
    }>

    const resolution_outcomes_total = parseInt(resolutionMetricsData[0].total_outcomes)
    const avg_resolution_accuracy_pct = parseFloat(resolutionMetricsData[0].avg_accuracy_pct)
    const resolution_markets_tracked = parseInt(resolutionMetricsData[0].markets_tracked)

    // Calculate percentages
    const market_id_coverage_pct = trades_total > 0 ? (trades_with_market_id / trades_total) * 100 : 0
    const resolved_trades_pct = trades_total > 0 ? (resolved_trades / trades_total) * 100 : 0

    console.log(`  ✓ Totals: ${trades_total.toLocaleString()} trades, ${wallets_total} wallets`)

    return {
      trades_total,
      trades_new_from_goldsky: trades_total, // All trades are from Goldsky ingestion
      wallets_total,
      wallets_with_resolution_accuracy,
      resolution_outcomes_total,
      market_id_coverage_pct,
      resolved_trades_pct,
      avg_resolution_accuracy_pct,
      resolution_markets_tracked
    }
  } catch (error) {
    console.error('  ✗ Error querying global totals:', error)
    return {
      trades_total: 0,
      trades_new_from_goldsky: 0,
      wallets_total: 0,
      wallets_with_resolution_accuracy: 0,
      resolution_outcomes_total: 0,
      market_id_coverage_pct: 0,
      resolved_trades_pct: 0,
      avg_resolution_accuracy_pct: 0,
      resolution_markets_tracked: 0
    }
  }
}

/**
 * Get top wallets by P&L
 */
async function getTopWallets(): Promise<Array<{ wallet_address: string; realized_pnl_usd: number; coverage_pct: number }>> {
  console.log('  Querying top wallets by P&L...')

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          SUM(realized_pnl_usd) as realized_pnl_usd,
          COUNT(DISTINCT CASE WHEN is_resolved = 1 THEN condition_id END) * 100.0 /
            NULLIF(COUNT(DISTINCT condition_id), 0) as coverage_pct
        FROM trades_raw
        GROUP BY wallet_address
        ORDER BY realized_pnl_usd DESC
        LIMIT 100
      `,
      format: 'JSONEachRow'
    })

    const rows = await result.json() as Array<{
      wallet_address: string
      realized_pnl_usd: string
      coverage_pct: string
    }>

    const wallets = rows.map(row => ({
      wallet_address: row.wallet_address,
      realized_pnl_usd: parseFloat(row.realized_pnl_usd),
      coverage_pct: parseFloat(row.coverage_pct) || 0
    }))

    console.log(`  ✓ Found ${wallets.length} top wallets`)
    return wallets
  } catch (error) {
    console.error('  ✗ Error querying top wallets:', error)
    return []
  }
}

/**
 * Main execution function
 */
export async function main() {
  console.log('📊 Generating Final Reports (Phase 5)\n')

  console.log('Step 1: Get global totals')
  const totals = await getGlobalTotals()

  console.log('Step 2: Get per-wallet category breakdown')
  const categoryBreakdown = await getPerWalletCategoryBreakdown()

  console.log('Step 3: Get per-wallet resolution accuracy')
  const walletAccuracy = await getPerWalletResolutionAccuracy()

  console.log('Step 4: Get per-wallet, per-category accuracy')
  const walletCategoryAccuracy = await getPerWalletCategoryAccuracy()

  console.log('Step 5: Get top wallets')
  const topWallets = await getTopWallets()

  console.log('Step 6: Assemble wallet summaries')
  const walletSummaries: WalletSummary[] = []

  for (const wallet of topWallets) {
    const categories = categoryBreakdown.get(wallet.wallet_address) || []
    const topCategory = categories.length > 0 ? categories[0] : null

    const accuracy = walletAccuracy.get(wallet.wallet_address) || null
    const categoryAccuracyMap = walletCategoryAccuracy.get(wallet.wallet_address)
    const topCategoryAccuracy = topCategory && categoryAccuracyMap
      ? categoryAccuracyMap.get(topCategory.canonical_category)
      : null

    walletSummaries.push({
      wallet_address: wallet.wallet_address,
      realized_pnl_usd_total: wallet.realized_pnl_usd,
      coverage_pct: wallet.coverage_pct,
      top_category: topCategory ? topCategory.canonical_category : 'Uncategorized',
      top_category_pnl_usd: topCategory ? topCategory.pnl_usd : 0,
      top_category_markets_sampled: topCategory ? topCategory.num_markets : 0,
      resolution_accuracy_pct_overall: accuracy ? accuracy.accuracy_pct : 0,
      resolution_accuracy_pct_top_category: topCategoryAccuracy ? topCategoryAccuracy.accuracy_pct : 0,
      markets_scored: accuracy ? accuracy.markets_scored : 0
    })
  }

  const summary: FinalSummary = {
    timestamp: new Date().toISOString(),
    totals,
    wallets: walletSummaries
  }

  console.log('Step 7: Write summary to file')
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2))
  console.log(`✅ Summary written to: ${SUMMARY_FILE}\n`)

  console.log('📈 Final Summary:')
  console.log(`   Total Trades: ${summary.totals.trades_total.toLocaleString()}`)
  console.log(`   Total Wallets: ${summary.totals.wallets_total}`)
  console.log(`   Resolution Outcomes: ${summary.totals.resolution_outcomes_total}`)
  console.log(`   Wallets with Resolution Accuracy: ${summary.totals.wallets_with_resolution_accuracy}`)
  console.log(`   Global Resolution Accuracy: ${summary.totals.avg_resolution_accuracy_pct.toFixed(2)}%`)
  console.log(`   Resolution Markets Tracked: ${summary.totals.resolution_markets_tracked}`)
  console.log(`   Market ID Coverage: ${summary.totals.market_id_coverage_pct.toFixed(2)}%`)
  console.log(`   Resolved Trades: ${summary.totals.resolved_trades_pct.toFixed(2)}%`)
  console.log(`   Wallets Summarized: ${summary.wallets.length}`)
  console.log('')

  // Machine-readable output for log scraping
  console.log(`OVERNIGHT_COMPLETE: ${JSON.stringify(summary)}`)

  return summary
}

// DO NOT auto-execute
// Call main() explicitly when ready
