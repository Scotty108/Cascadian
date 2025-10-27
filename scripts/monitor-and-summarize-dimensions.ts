#!/usr/bin/env npx tsx
/**
 * Monitor Dimension Build and Generate Summaries
 *
 * Polls dimension-build.log until completion, then immediately:
 * 1. Verifies output files exist
 * 2. Generates category summaries for markets and events
 * 3. Creates preview of top 20 wallets with category breakdown
 */

import { resolve } from 'path'
import * as fs from 'fs'
import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
})

/**
 * Check if dimension build is complete
 */
function isDimensionBuildComplete(): boolean {
  const logPath = resolve(process.cwd(), 'data/dimension-build.log')
  if (!fs.existsSync(logPath)) return false

  const log = fs.readFileSync(logPath, 'utf-8')
  return log.includes('✅ DIMENSION BUILD COMPLETE') || log.includes('Wrote data/markets_dim_seed.json')
}

/**
 * Summarize markets dimension
 */
function summarizeMarketsDim() {
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')

  if (!fs.existsSync(marketsPath)) {
    console.error('❌ markets_dim_seed.json not found!')
    return null
  }

  const data = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
  const markets = data.markets || []

  console.log('\n📊 MARKETS DIMENSION SUMMARY')
  console.log('================================================\n')

  const totalRows = markets.length
  const withCategory = markets.filter((m: any) => m.category && m.category !== null).length

  console.log(`Total rows: ${totalRows.toLocaleString()}`)
  console.log(`Rows with non-null category: ${withCategory.toLocaleString()} (${((withCategory / totalRows) * 100).toFixed(1)}%)`)
  console.log('')

  // Count categories
  const categoryCounts = new Map<string, number>()
  for (const market of markets) {
    if (market.category) {
      const count = categoryCounts.get(market.category) || 0
      categoryCounts.set(market.category, count + 1)
    }
  }

  const topCategories = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  console.log('🏆 Top 10 Most Common Categories:')
  for (let i = 0; i < topCategories.length; i++) {
    const [category, count] = topCategories[i]
    console.log(`   ${i + 1}. ${category}: ${count.toLocaleString()} markets`)
  }
  console.log('')

  return {
    totalRows,
    withCategory,
    categoryPct: (withCategory / totalRows) * 100,
    topCategories: topCategories.map(([cat, count]) => ({ category: cat, count }))
  }
}

/**
 * Summarize events dimension
 */
function summarizeEventsDim() {
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')

  if (!fs.existsSync(eventsPath)) {
    console.error('❌ events_dim_seed.json not found!')
    return null
  }

  const data = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))
  const events = data.events || []

  console.log('\n📊 EVENTS DIMENSION SUMMARY')
  console.log('================================================\n')

  const totalRows = events.length
  const withCategory = events.filter((e: any) => e.category && e.category !== null).length

  console.log(`Total rows: ${totalRows.toLocaleString()}`)
  console.log(`Rows with non-null category: ${withCategory.toLocaleString()} (${((withCategory / totalRows) * 100).toFixed(1)}%)`)
  console.log('')

  // Count categories
  const categoryCounts = new Map<string, number>()
  for (const event of events) {
    if (event.category) {
      const count = categoryCounts.get(event.category) || 0
      categoryCounts.set(event.category, count + 1)
    }
  }

  const topCategories = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  console.log('🏆 Top 10 Most Common Categories:')
  for (let i = 0; i < topCategories.length; i++) {
    const [category, count] = topCategories[i]
    console.log(`   ${i + 1}. ${category}: ${count.toLocaleString()} events`)
  }
  console.log('')

  return {
    totalRows,
    withCategory,
    categoryPct: (withCategory / totalRows) * 100,
    topCategories: topCategories.map(([cat, count]) => ({ category: cat, count }))
  }
}

/**
 * Generate preview for top 20 wallets
 */
async function generateTop20Preview() {
  console.log('\n📊 TOP 20 WALLETS PREVIEW')
  console.log('================================================\n')

  // Load wallet P&L data
  const walletPnlPath = resolve(process.cwd(), 'data/audited_wallet_pnl_extended.json')
  if (!fs.existsSync(walletPnlPath)) {
    console.error('❌ audited_wallet_pnl_extended.json not found!')
    return
  }

  const walletData = JSON.parse(fs.readFileSync(walletPnlPath, 'utf-8'))
  const allWallets = walletData.wallets || []

  // Sort by realized P&L and take top 20
  const top20 = allWallets
    .sort((a: any, b: any) => b.realizedPnlUsd - a.realizedPnlUsd)
    .slice(0, 20)

  // Load markets dimension
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  if (!fs.existsSync(marketsPath)) {
    console.error('❌ markets_dim_seed.json not found!')
    return
  }

  const marketsData = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
  const marketsDim = new Map<string, any>()
  for (const market of marketsData.markets || []) {
    marketsDim.set(market.condition_id, market)
  }

  console.log('Loading trade data for top 20 wallets...\n')

  const previews = []

  for (let i = 0; i < top20.length; i++) {
    const wallet = top20[i]

    console.log(`Processing ${i + 1}/20: ${wallet.address.slice(0, 10)}...`)

    try {
      // Get trades for this wallet
      const query = `
        SELECT
          condition_id,
          sum(realized_pnl_usd) as pnl_usd,
          count(DISTINCT condition_id) as num_markets
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND is_resolved = 1
        GROUP BY condition_id
      `

      const resultSet = await clickhouse.query({
        query,
        format: 'JSONEachRow',
        query_params: { wallet: wallet.address }
      })

      const rows = await resultSet.json() as any[]

      // Group by category
      const categoryStats = new Map<string, { pnl: number; markets: Set<string> }>()

      for (const row of rows) {
        const market = marketsDim.get(row.condition_id)
        const category = market?.category || 'Uncategorized'

        if (!categoryStats.has(category)) {
          categoryStats.set(category, { pnl: 0, markets: new Set() })
        }

        const stats = categoryStats.get(category)!
        stats.pnl += parseFloat(row.pnl_usd || 0)
        stats.markets.add(row.condition_id)
      }

      // Get top 3 categories
      const topCategories = Array.from(categoryStats.entries())
        .map(([category, stats]) => ({
          category,
          realized_pnl_usd: stats.pnl,
          num_resolved_markets: stats.markets.size
        }))
        .sort((a, b) => b.realized_pnl_usd - a.realized_pnl_usd)
        .slice(0, 3)

      previews.push({
        address: wallet.address,
        realized_pnl_usd: wallet.realizedPnlUsd,
        coverage_pct: wallet.coveragePct,
        top_categories: topCategories
      })
    } catch (error) {
      console.error(`   ⚠️  Failed to process wallet ${wallet.address}:`, error)
    }
  }

  // Display results
  console.log('\n' + '='.repeat(80))
  console.log('PREVIEW RESULTS')
  console.log('='.repeat(80) + '\n')

  for (let i = 0; i < previews.length; i++) {
    const preview = previews[i]
    const shortAddr = `${preview.address.slice(0, 6)}...${preview.address.slice(-4)}`

    console.log(`${i + 1}. ${shortAddr}`)
    console.log(`   Total P&L: $${preview.realized_pnl_usd.toFixed(2)}`)
    console.log(`   Coverage: ${preview.coverage_pct.toFixed(1)}%`)
    console.log(`   Top 3 Categories:`)

    for (const cat of preview.top_categories) {
      console.log(`      - ${cat.category}: $${cat.realized_pnl_usd.toFixed(2)} (${cat.num_resolved_markets} markets)`)
    }

    console.log('')
  }

  // Write preview file
  const previewPath = resolve(process.cwd(), 'data/wallet_category_preview_top20.json')
  fs.writeFileSync(previewPath, JSON.stringify({ wallets: previews }, null, 2), 'utf-8')
  console.log(`✅ Wrote preview to ${previewPath}\n`)

  await clickhouse.close()
}

async function main() {
  console.log('🔍 MONITORING DIMENSION BUILD JOB')
  console.log('================================================\n')

  // Poll every 10 seconds
  let attempts = 0
  const maxAttempts = 360 // 1 hour max

  while (attempts < maxAttempts) {
    if (isDimensionBuildComplete()) {
      console.log('✅ Dimension build complete! Generating summaries...\n')

      // Give it a second to finish writing files
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Generate summaries
      const marketsSummary = summarizeMarketsDim()
      const eventsSummary = summarizeEventsDim()

      if (marketsSummary && eventsSummary) {
        // Generate top 20 preview
        await generateTop20Preview()

        console.log('✅ ALL SUMMARIES COMPLETE\n')
        process.exit(0)
      } else {
        console.error('❌ Failed to generate summaries\n')
        process.exit(1)
      }
    }

    attempts++
    await new Promise(resolve => setTimeout(resolve, 10000)) // Wait 10 seconds

    if (attempts % 6 === 0) {
      // Show progress every minute
      const logPath = resolve(process.cwd(), 'data/dimension-build.log')
      if (fs.existsSync(logPath)) {
        const log = fs.readFileSync(logPath, 'utf-8')
        const lines = log.split('\n')

        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].includes('Progress:')) {
            console.log(`[${new Date().toLocaleTimeString()}] ${lines[i].trim()}`)
            break
          }
        }
      }
    }
  }

  console.error('❌ Timeout waiting for dimension build to complete\n')
  process.exit(1)
}

main().catch(console.error)
