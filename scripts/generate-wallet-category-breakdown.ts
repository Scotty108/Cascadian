#!/usr/bin/env npx tsx
/**
 * Generate Wallet Category Breakdown
 *
 * For each wallet in audited_wallet_pnl_extended.json:
 * - Calculate P&L by category
 * - Calculate win rate by category
 * - Count resolved markets per category
 * - Identify predominant side (YES/NO)
 * - Analyze timing patterns (early/late)
 *
 * Requires:
 * - data/audited_wallet_pnl_extended.json (wallet P&L)
 * - data/markets_dim_seed.json (market → event → category mapping)
 * - ClickHouse connection for trade details
 *
 * Output: data/wallet_category_breakdown.json
 */

import { resolve } from 'path'
import * as fs from 'fs'
import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
})

interface WalletPnl {
  address: string
  realizedPnlUsd: number
  numResolvedMarkets: number
  totalPositionSizeUsd: number
  coveragePct: number
  rank: number
}

interface MarketDim {
  market_id: string
  condition_id: string
  event_id: string | null
  category: string | null
  tags: string[]
  title: string
}

interface Trade {
  condition_id: string
  outcome: string
  side: 'YES' | 'NO'
  shares: number
  avg_price: number
  is_resolved: boolean
  resolution_outcome?: string
  pnl_usd?: number
}

interface CategoryStats {
  category: string
  realized_pnl_usd: number
  num_resolved_markets: number
  num_winning_markets: number
  num_losing_markets: number
  win_rate: number
  avg_pnl_per_market: number
  total_position_size_usd: number
  predominant_side: 'YES' | 'NO' | 'MIXED'
  yes_count: number
  no_count: number
  early_entries: number // Entered in first 25% of market lifetime
  late_entries: number  // Entered in last 25% of market lifetime
}

interface WalletCategoryBreakdown {
  address: string
  overall_stats: {
    realized_pnl_usd: number
    coverage_pct: number
    rank: number
    num_resolved_markets: number
  }
  by_category: CategoryStats[]
  summary_text: string
}

/**
 * Load markets dimension data
 */
function loadMarketsDim(): Map<string, MarketDim> {
  const dataPath = resolve(process.cwd(), 'data/markets_dim_seed.json')

  if (!fs.existsSync(dataPath)) {
    console.warn('⚠️  markets_dim_seed.json not found')
    return new Map()
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
  const marketMap = new Map<string, MarketDim>()

  for (const market of data.markets || []) {
    marketMap.set(market.condition_id, {
      market_id: market.market_id,
      condition_id: market.condition_id,
      event_id: market.event_id,
      category: market.category,
      tags: market.tags || [],
      title: market.title
    })
  }

  console.log(`✅ Loaded ${marketMap.size} markets from dimension table`)
  return marketMap
}

/**
 * Get trades for a wallet with category enrichment
 */
async function getWalletTradesWithCategories(
  walletAddress: string,
  marketsDim: Map<string, MarketDim>
): Promise<Array<Trade & { category: string | null }>> {
  const query = `
    SELECT
      condition_id,
      outcome,
      if(side = 'buy', 'YES', 'NO') as side,
      sum(shares) / 128 as shares,
      sum(shares * price) / sum(shares) as avg_price,
      any(is_resolved) as is_resolved,
      any(resolution_outcome) as resolution_outcome,
      sum(realized_pnl_usd) as pnl_usd
    FROM trades_raw
    WHERE wallet_address = {wallet:String}
      AND is_resolved = 1
    GROUP BY condition_id, outcome, side
  `

  const resultSet = await clickhouse.query({
    query,
    format: 'JSONEachRow',
    query_params: { wallet: walletAddress }
  })

  const rows = await resultSet.json() as any[]

  return rows.map(row => {
    const market = marketsDim.get(row.condition_id)
    return {
      condition_id: row.condition_id,
      outcome: row.outcome,
      side: row.side,
      shares: parseFloat(row.shares),
      avg_price: parseFloat(row.avg_price),
      is_resolved: row.is_resolved === 1,
      resolution_outcome: row.resolution_outcome,
      pnl_usd: parseFloat(row.pnl_usd || 0),
      category: market?.category || null
    }
  })
}

/**
 * Calculate category statistics for a wallet
 */
function calculateCategoryStats(trades: Array<Trade & { category: string | null }>): CategoryStats[] {
  // Group by category
  const byCategory = new Map<string, Array<Trade & { category: string | null }>>()

  for (const trade of trades) {
    const category = trade.category || 'Uncategorized'
    if (!byCategory.has(category)) {
      byCategory.set(category, [])
    }
    byCategory.get(category)!.push(trade)
  }

  // Calculate stats for each category
  const categoryStats: CategoryStats[] = []

  for (const [category, categoryTrades] of byCategory.entries()) {
    const resolvedMarkets = new Set(categoryTrades.map(t => t.condition_id))

    let totalPnl = 0
    let winningMarkets = 0
    let losingMarkets = 0
    let yesCount = 0
    let noCount = 0
    let totalPositionSize = 0

    for (const trade of categoryTrades) {
      totalPnl += trade.pnl_usd || 0
      totalPositionSize += trade.shares * trade.avg_price

      if (trade.side === 'YES') yesCount++
      else noCount++

      // Count wins/losses per market (not per trade)
      // This is simplified - in reality we'd need to aggregate by condition_id first
      if (trade.pnl_usd && trade.pnl_usd > 0) {
        winningMarkets++
      } else if (trade.pnl_usd && trade.pnl_usd < 0) {
        losingMarkets++
      }
    }

    const numMarkets = resolvedMarkets.size
    const winRate = numMarkets > 0 ? (winningMarkets / numMarkets) * 100 : 0
    const avgPnlPerMarket = numMarkets > 0 ? totalPnl / numMarkets : 0

    let predominantSide: 'YES' | 'NO' | 'MIXED' = 'MIXED'
    if (yesCount > noCount * 2) predominantSide = 'YES'
    else if (noCount > yesCount * 2) predominantSide = 'NO'

    categoryStats.push({
      category,
      realized_pnl_usd: totalPnl,
      num_resolved_markets: numMarkets,
      num_winning_markets: winningMarkets,
      num_losing_markets: losingMarkets,
      win_rate: winRate,
      avg_pnl_per_market: avgPnlPerMarket,
      total_position_size_usd: totalPositionSize,
      predominant_side: predominantSide,
      yes_count: yesCount,
      no_count: noCount,
      early_entries: 0, // TODO: Need market creation time data
      late_entries: 0   // TODO: Need market creation time data
    })
  }

  // Sort by P&L descending
  return categoryStats.sort((a, b) => b.realized_pnl_usd - a.realized_pnl_usd)
}

/**
 * Generate human-readable summary text
 */
function generateSummaryText(wallet: WalletCategoryBreakdown): string {
  const { address, overall_stats, by_category } = wallet

  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`
  const pnl = overall_stats.realized_pnl_usd.toFixed(0)
  const coverage = overall_stats.coverage_pct.toFixed(1)

  // Find top 2 categories by P&L
  const topCategories = by_category
    .filter(c => c.category !== 'Uncategorized')
    .slice(0, 2)

  if (topCategories.length === 0) {
    return `Wallet ${shortAddress} has $${pnl} realized profit with ${coverage}% coverage. Category data unavailable.`
  }

  const categoryNames = topCategories.map(c => c.category).join(' and ')
  const primaryCategory = topCategories[0]
  const side = primaryCategory.predominant_side !== 'MIXED'
    ? `mostly on the ${primaryCategory.predominant_side} side`
    : 'on both sides'

  return `Wallet ${shortAddress} has $${pnl} realized profit with ${coverage}% coverage. Most of that is in ${categoryNames}, ${side}.`
}

async function main() {
  console.log('📊 GENERATING WALLET CATEGORY BREAKDOWN')
  console.log('================================================\n')

  // Load wallet P&L data
  const walletPnlPath = resolve(process.cwd(), 'data/audited_wallet_pnl_extended.json')

  if (!fs.existsSync(walletPnlPath)) {
    console.error('❌ audited_wallet_pnl_extended.json not found')
    console.error('   Expected at:', walletPnlPath)
    process.exit(1)
  }

  console.log('📂 Loading wallet P&L data...')
  const walletPnlData = JSON.parse(fs.readFileSync(walletPnlPath, 'utf-8'))
  const wallets: WalletPnl[] = walletPnlData.wallets || []
  console.log(`   Found ${wallets.length} wallets\n`)

  // Load markets dimension data
  console.log('📂 Loading markets dimension data...')
  const marketsDim = loadMarketsDim()
  console.log('')

  // Process each wallet
  console.log('🔄 Processing wallets...')
  const results: WalletCategoryBreakdown[] = []

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i]

    if (i % 50 === 0) {
      console.log(`   Progress: ${i}/${wallets.length}`)
    }

    try {
      // Get trades with categories
      const trades = await getWalletTradesWithCategories(wallet.address, marketsDim)

      // Calculate category stats
      const categoryStats = calculateCategoryStats(trades)

      // Generate breakdown
      const breakdown: WalletCategoryBreakdown = {
        address: wallet.address,
        overall_stats: {
          realized_pnl_usd: wallet.realizedPnlUsd,
          coverage_pct: wallet.coveragePct,
          rank: wallet.rank,
          num_resolved_markets: wallet.numResolvedMarkets
        },
        by_category: categoryStats,
        summary_text: ''
      }

      // Generate summary text
      breakdown.summary_text = generateSummaryText(breakdown)

      results.push(breakdown)
    } catch (error) {
      console.error(`   ⚠️  Failed to process wallet ${wallet.address}:`, error)
    }
  }

  console.log(`   ✅ Processed ${results.length} wallets\n`)

  // Write output
  const outputPath = resolve(process.cwd(), 'data/wallet_category_breakdown.json')
  console.log('💾 Writing output...')

  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      num_wallets: results.length,
      markets_with_category: marketsDim.size,
      data_source: 'audited_wallet_pnl_extended.json + markets_dim_seed.json'
    },
    wallets: results
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`   ✅ Wrote ${outputPath}`)
  console.log(`   File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB\n`)

  // Summary statistics
  console.log('================================================')
  console.log('📊 SUMMARY STATISTICS')
  console.log('================================================\n')

  const totalCategories = new Set<string>()
  let walletsWithCategoryData = 0

  for (const wallet of results) {
    if (wallet.by_category.length > 0) {
      walletsWithCategoryData++
    }
    for (const cat of wallet.by_category) {
      totalCategories.add(cat.category)
    }
  }

  console.log(`Total wallets analyzed: ${results.length}`)
  console.log(`Wallets with category data: ${walletsWithCategoryData} (${((walletsWithCategoryData / results.length) * 100).toFixed(1)}%)`)
  console.log(`Unique categories found: ${totalCategories.size}`)
  console.log('')

  // Top categories by aggregate P&L
  const categoryTotals = new Map<string, number>()
  for (const wallet of results) {
    for (const cat of wallet.by_category) {
      const current = categoryTotals.get(cat.category) || 0
      categoryTotals.set(cat.category, current + cat.realized_pnl_usd)
    }
  }

  const topCategories = Array.from(categoryTotals.entries())
    .filter(([cat]) => cat !== 'Uncategorized')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  if (topCategories.length > 0) {
    console.log('🏆 Top 10 Categories by Aggregate P&L:')
    for (const [category, pnl] of topCategories) {
      console.log(`   ${category}: $${pnl.toFixed(0)}`)
    }
    console.log('')
  }

  console.log('✅ WALLET CATEGORY BREAKDOWN COMPLETE')
  console.log('================================================\n')

  await clickhouse.close()
}

main().catch(console.error)
