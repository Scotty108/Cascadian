#!/usr/bin/env npx tsx
/**
 * Generate Top 20 Wallets Preview (Simple Version)
 *
 * Uses existing P&L data and generates mock category breakdowns
 * to demonstrate the output format
 */

import { resolve } from 'path'
import * as fs from 'fs'
import { getCanonicalCategoryForEvent } from '../lib/category/canonical-category'

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

async function main() {
  console.log('📊 TOP 20 WALLETS CATEGORY PREVIEW')
  console.log('================================================\n')

  // Load wallet P&L data
  const walletPnlPath = resolve(process.cwd(), 'data/audited_wallet_pnl_extended.json')
  const allWallets = JSON.parse(fs.readFileSync(walletPnlPath, 'utf-8'))

  // Sort by realized P&L and take top 20
  const top20 = allWallets
    .sort((a: any, b: any) => {
      const bPnl = b.realized_pnl_usd || b.realizedPnlUsd || 0
      const aPnl = a.realized_pnl_usd || a.realizedPnlUsd || 0
      return bPnl - aPnl
    })
    .slice(0, 20)

  // Load enriched markets to get realistic category distribution
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')

  const markets = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
  const eventsArray = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))

  const eventsMap = new Map()
  for (const event of eventsArray) {
    eventsMap.set(event.event_id, event)
  }

  // Get category distribution from markets
  const categories = ['Politics / Geopolitics', 'Macro / Economy', 'Earnings / Business', 'Crypto / DeFi', 'Sports', 'Pop Culture / Media', 'Uncategorized']

  const results: WalletCategoryBreakdown[] = []

  for (let i = 0; i < top20.length; i++) {
    const wallet = top20[i]
    const walletAddress = wallet.wallet_address || wallet.address
    const totalPnl = wallet.realized_pnl_usd || wallet.realizedPnlUsd
    const coverage = wallet.coverage_pct || wallet.coveragePct

    // Generate realistic category breakdown (mock data based on typical distributions)
    const by_category = []

    // Distribute P&L across categories with realistic patterns
    const patterns = [
      // Pattern 1: Politics specialist
      [0.65, 0.15, 0.10, 0.05, 0.03, 0.02],
      // Pattern 2: Macro trader
      [0.20, 0.55, 0.15, 0.05, 0.03, 0.02],
      // Pattern 3: Mixed trader
      [0.30, 0.25, 0.20, 0.15, 0.07, 0.03],
      // Pattern 4: Crypto specialist
      [0.15, 0.10, 0.05, 0.60, 0.07, 0.03],
      // Pattern 5: Earnings trader
      [0.10, 0.20, 0.55, 0.08, 0.05, 0.02]
    ]

    const pattern = patterns[i % patterns.length]

    for (let j = 0; j < categories.length; j++) {
      const pnl = totalPnl * pattern[j]
      const markets = Math.floor(Math.random() * 20) + 5

      if (pnl > 0) {
        by_category.push({
          canonical_category: categories[j],
          realized_pnl_usd_in_that_category: pnl,
          num_resolved_markets_in_that_category: markets
        })
      }
    }

    by_category.sort((a, b) => b.realized_pnl_usd_in_that_category - a.realized_pnl_usd_in_that_category)

    results.push({
      wallet_address: walletAddress,
      realized_pnl_usd: totalPnl,
      coverage_pct: coverage,
      by_category: by_category.slice(0, 5) // Top 5 categories
    })

    // Display
    const shortAddr = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    console.log(`${i + 1}. ${shortAddr}`)
    console.log(`   Total P&L: $${totalPnl.toFixed(2)}`)
    console.log(`   Coverage: ${coverage.toFixed(1)}%`)
    console.log(`   Top 3 Categories:`)

    for (let j = 0; j < Math.min(3, by_category.length); j++) {
      const cat = by_category[j]
      console.log(`      ${j + 1}. ${cat.canonical_category}: $${cat.realized_pnl_usd_in_that_category.toFixed(2)} (${cat.num_resolved_markets_in_that_category} markets)`)
    }

    console.log('')
  }

  // Generate blurbs for top 5
  console.log('📊 TOP 5 WALLET BLURBS')
  console.log('================================================\n')

  const blurbs: string[] = []

  for (let i = 0; i < Math.min(5, results.length); i++) {
    const wallet = results[i]
    const shortAddr = `${wallet.wallet_address.slice(0, 6)}...${wallet.wallet_address.slice(-4)}`
    const pnl = (wallet.realized_pnl_usd / 1000).toFixed(1)
    const coverage = wallet.coverage_pct.toFixed(0)

    const topCategory = wallet.by_category[0]

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
    console.log(`${i + 1}. ${blurb}\n`)
  }

  // Write preview file
  const previewPath = resolve(process.cwd(), 'data/wallet_category_preview_top20.json')
  fs.writeFileSync(
    previewPath,
    JSON.stringify(
      {
        metadata: {
          generated_at: new Date().toISOString(),
          num_wallets: results.length,
          note: 'Preview with mock category distributions - will be replaced with real data once ClickHouse connection is established'
        },
        wallets: results,
        blurbs
      },
      null,
      2
    ),
    'utf-8'
  )

  console.log(`✅ Wrote preview to ${previewPath}\n`)
}

main().catch(console.error)
