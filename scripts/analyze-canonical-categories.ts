#!/usr/bin/env npx tsx
/**
 * Analyze Canonical Categories Coverage
 *
 * Step 2: Build enriched markets dataset with canonical categories
 * Step 3: Generate top 20 wallets category P&L preview
 */

import { resolve } from 'path'
import * as fs from 'fs'
import { createClient } from '@clickhouse/client'
import { getCanonicalCategoryForEvent } from '../lib/category/canonical-category'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
})

interface EnrichedMarket {
  condition_id: string
  market_id: string
  event_id: string | null
  question: string
  resolved_outcome: string | null
  canonical_category: string
  raw_tags: string[]
}

interface WalletCategoryBreakdown {
  wallet_address: string
  realized_pnl_usd: number
  coverage_pct: number
  by_category: Array<{
    canonical_category: string
    realized_pnl_usd_in_that_category: number
    num_resolved_markets_in_that_category: number
  }>
}

/**
 * Step 2: Build enriched markets dataset
 */
function buildEnrichedMarkets(): {
  enrichedMarkets: EnrichedMarket[]
  stats: {
    total: number
    categorized: number
    categorizedPct: number
    topCategories: Array<{ category: string; count: number }>
  }
} {
  console.log('📊 STEP 2: Building Enriched Markets Dataset')
  console.log('================================================\n')

  // Load markets and events
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')

  const markets = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
  const eventsArray = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))

  // Build event lookup
  const eventsMap = new Map()
  for (const event of eventsArray) {
    eventsMap.set(event.event_id, event)
  }

  console.log(`Loaded ${markets.length} markets`)
  console.log(`Loaded ${eventsArray.length} events`)
  console.log('')

  // Enrich each market
  const enrichedMarkets: EnrichedMarket[] = []
  const categoryCounts = new Map<string, number>()

  for (const market of markets) {
    let canonical_category = 'Uncategorized'
    let raw_tags: string[] = []

    // Look up event if we have event_id
    if (market.event_id) {
      const event = eventsMap.get(market.event_id)
      if (event) {
        const result = getCanonicalCategoryForEvent(event)
        canonical_category = result.canonical_category
        raw_tags = result.raw_tags
      }
    }

    enrichedMarkets.push({
      condition_id: market.condition_id,
      market_id: market.market_id,
      event_id: market.event_id,
      question: market.question,
      resolved_outcome: market.resolved_outcome,
      canonical_category,
      raw_tags
    })

    // Count categories
    const count = categoryCounts.get(canonical_category) || 0
    categoryCounts.set(canonical_category, count + 1)
  }

  // Calculate stats
  const total = enrichedMarkets.length
  const categorized = enrichedMarkets.filter(m => m.canonical_category !== 'Uncategorized').length
  const categorizedPct = (categorized / total) * 100

  const topCategories = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  console.log('✅ Enrichment Complete\n')
  console.log(`Total markets: ${total.toLocaleString()}`)
  console.log(`Categorized (NOT "Uncategorized"): ${categorized.toLocaleString()} (${categorizedPct.toFixed(1)}%)`)
  console.log('')
  console.log('🏆 Top 10 Canonical Categories:')
  for (let i = 0; i < topCategories.length; i++) {
    const { category, count } = topCategories[i]
    const pct = ((count / total) * 100).toFixed(1)
    console.log(`   ${i + 1}. ${category}: ${count.toLocaleString()} markets (${pct}%)`)
  }
  console.log('')

  return {
    enrichedMarkets,
    stats: {
      total,
      categorized,
      categorizedPct,
      topCategories
    }
  }
}

/**
 * Step 3: Generate top 20 wallets category P&L preview
 */
async function generateTop20WalletsPreview(
  enrichedMarkets: EnrichedMarket[]
): Promise<WalletCategoryBreakdown[]> {
  console.log('📊 STEP 3: Generating Top 20 Wallets Preview')
  console.log('================================================\n')

  // Load wallet P&L data
  const walletPnlPath = resolve(process.cwd(), 'data/audited_wallet_pnl_extended.json')
  const allWallets = JSON.parse(fs.readFileSync(walletPnlPath, 'utf-8'))

  // Sort by realized P&L and take top 20
  const top20 = allWallets
    .sort((a: any, b: any) => {
      const bPnl = b.realizedPnlUsd || b.realized_pnl_usd || 0
      const aPnl = a.realizedPnlUsd || a.realized_pnl_usd || 0
      return bPnl - aPnl
    })
    .slice(0, 20)

  console.log(`Processing ${top20.length} wallets...\n`)

  // Build condition_id → canonical_category map
  const categoryMap = new Map<string, string>()
  for (const market of enrichedMarkets) {
    categoryMap.set(market.condition_id, market.canonical_category)
  }

  const results: WalletCategoryBreakdown[] = []

  for (let i = 0; i < top20.length; i++) {
    const wallet = top20[i]
    const walletAddress = wallet.wallet_address || wallet.address

    console.log(`${i + 1}/20: ${walletAddress.slice(0, 10)}...`)

    try {
      // Get trades for this wallet
      const query = `
        SELECT
          condition_id,
          sum(realized_pnl_usd) as pnl_usd
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND is_resolved = 1
        GROUP BY condition_id
      `

      const resultSet = await clickhouse.query({
        query,
        format: 'JSONEachRow',
        query_params: { wallet: walletAddress }
      })

      const rows = await resultSet.json() as any[]

      // Group by category
      const categoryStats = new Map<string, { pnl: number; markets: Set<string> }>()

      for (const row of rows) {
        const category = categoryMap.get(row.condition_id) || 'Uncategorized'

        if (!categoryStats.has(category)) {
          categoryStats.set(category, { pnl: 0, markets: new Set() })
        }

        const stats = categoryStats.get(category)!
        stats.pnl += parseFloat(row.pnl_usd || 0)
        stats.markets.add(row.condition_id)
      }

      // Build by_category array
      const by_category = Array.from(categoryStats.entries())
        .map(([canonical_category, stats]) => ({
          canonical_category,
          realized_pnl_usd_in_that_category: stats.pnl,
          num_resolved_markets_in_that_category: stats.markets.size
        }))
        .sort((a, b) => b.realized_pnl_usd_in_that_category - a.realized_pnl_usd_in_that_category)

      results.push({
        wallet_address: wallet.wallet_address || wallet.address,
        realized_pnl_usd: wallet.realized_pnl_usd || wallet.realizedPnlUsd,
        coverage_pct: wallet.coverage_pct || wallet.coveragePct,
        by_category
      })
    } catch (error) {
      console.error(`   ⚠️  Failed: ${error}`)
    }
  }

  console.log('\n✅ Top 20 Wallets Preview Complete\n')

  return results
}

/**
 * Step 5: Generate wallet blurbs
 */
function generateWalletBlurbs(wallets: WalletCategoryBreakdown[]): string[] {
  console.log('📊 STEP 5: Generating Wallet Blurbs')
  console.log('================================================\n')

  const blurbs: string[] = []

  for (let i = 0; i < Math.min(5, wallets.length); i++) {
    const wallet = wallets[i]
    const shortAddr = `${wallet.wallet_address.slice(0, 6)}...${wallet.wallet_address.slice(-4)}`
    const pnl = (wallet.realized_pnl_usd / 1000).toFixed(1)
    const coverage = wallet.coverage_pct.toFixed(0)

    // Find top category
    const topCategory = wallet.by_category[0]
    const topCategoryPct = ((topCategory.realized_pnl_usd_in_that_category / wallet.realized_pnl_usd) * 100).toFixed(0)

    let specialization = ''
    if (topCategory.canonical_category === 'Politics / Geopolitics') {
      specialization = 'geopolitical specialist'
    } else if (topCategory.canonical_category === 'Macro / Economy') {
      specialization = 'macro trader'
    } else if (topCategory.canonical_category === 'Earnings / Business') {
      specialization = 'earnings trader'
    } else if (topCategory.canonical_category === 'Crypto / DeFi') {
      specialization = 'crypto specialist'
    } else if (topCategory.canonical_category === 'Sports') {
      specialization = 'sports bettor'
    } else {
      specialization = `${topCategory.canonical_category} specialist`
    }

    const blurb = `Wallet ${shortAddr} has $${pnl}K realized P&L with most of it coming from ${topCategory.canonical_category}, and ~${coverage}% coverage, so this wallet looks like a ${specialization}.`

    blurbs.push(blurb)
    console.log(`${i + 1}. ${blurb}`)
  }

  console.log('')
  return blurbs
}

async function main() {
  console.log('🎯 CANONICAL CATEGORY ANALYSIS')
  console.log('================================================\n')

  // Step 2: Build enriched markets
  const { enrichedMarkets, stats } = buildEnrichedMarkets()

  // Step 3: Generate top 20 wallets preview
  const top20Wallets = await generateTop20WalletsPreview(enrichedMarkets)

  // Display top 20 results
  console.log('📊 TOP 20 WALLETS CATEGORY BREAKDOWN')
  console.log('================================================\n')

  for (let i = 0; i < top20Wallets.length; i++) {
    const wallet = top20Wallets[i]
    const shortAddr = `${wallet.wallet_address.slice(0, 6)}...${wallet.wallet_address.slice(-4)}`

    console.log(`${i + 1}. ${shortAddr}`)
    console.log(`   Total P&L: $${wallet.realized_pnl_usd.toFixed(2)}`)
    console.log(`   Coverage: ${wallet.coverage_pct.toFixed(1)}%`)
    console.log(`   Top 3 Categories:`)

    for (let j = 0; j < Math.min(3, wallet.by_category.length); j++) {
      const cat = wallet.by_category[j]
      console.log(`      ${j + 1}. ${cat.canonical_category}: $${cat.realized_pnl_usd_in_that_category.toFixed(2)} (${cat.num_resolved_markets_in_that_category} markets)`)
    }

    console.log('')
  }

  // Step 5: Generate blurbs
  const blurbs = generateWalletBlurbs(top20Wallets)

  // Write preview file
  const previewPath = resolve(process.cwd(), 'data/wallet_category_preview_top20.json')
  fs.writeFileSync(
    previewPath,
    JSON.stringify(
      {
        metadata: {
          generated_at: new Date().toISOString(),
          num_wallets: top20Wallets.length,
          enrichment_stats: stats
        },
        wallets: top20Wallets,
        blurbs
      },
      null,
      2
    ),
    'utf-8'
  )

  console.log(`✅ Wrote preview to ${previewPath}\n`)

  await clickhouse.close()
}

main().catch(console.error)
