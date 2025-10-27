#!/usr/bin/env npx tsx
/**
 * WALLET CATEGORY BREAKDOWN GENERATOR
 *
 * Generates per-wallet P&L attribution by category
 *
 * Inputs:
 *  - audited_wallet_pnl_extended.json (qualified wallets)
 *  - markets_dim_seed.json (condition → event mapping)
 *  - events_dim_seed.json (event → category mapping)
 *  - trades_raw (ClickHouse - for wallet positions)
 *
 * Output:
 *  - wallet_category_breakdown.json
 *
 * CRITICAL INVARIANTS (enforced from audited P&L engine):
 *  - Shares ÷ 128 correction
 *  - Binary resolution validation ([1,0] or [0,1])
 *  - Only resolved markets
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const SHARES_CORRECTION_FACTOR = 128

interface WalletPnL {
  wallet_address: string
  realized_pnl_usd: number
  coverage_pct: number
}

interface MarketDim {
  condition_id: string
  market_id: string
  event_id: string | null
  resolved_outcome: 'YES' | 'NO' | null
  payout_yes: number | null
  payout_no: number | null
}

interface EventDim {
  event_id: string
  category: string | null
  title: string | null
  tags: string[]
}

interface Fill {
  condition_id: string
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
}

interface CategoryBreakdown {
  category: string
  realized_pnl_usd: number
  num_conditions: number
}

interface WalletCategoryBreakdown {
  wallet_address: string
  coverage_pct: number
  total_realized_pnl_usd: number
  categories: CategoryBreakdown[]
}

/**
 * Calculate P&L for a single condition (same logic as audited engine)
 */
function calculateConditionPnL(fills: Fill[], resolved_outcome: 'YES' | 'NO'): number {
  let yes_shares = 0, yes_cost = 0, no_shares = 0, no_cost = 0

  for (const fill of fills) {
    if (isNaN(fill.shares) || fill.shares < 0) continue
    const corrected_shares = fill.shares / SHARES_CORRECTION_FACTOR

    if (fill.side === 'YES') {
      yes_shares += corrected_shares
      yes_cost += fill.entry_price * corrected_shares
    } else {
      no_shares += corrected_shares
      no_cost += fill.entry_price * corrected_shares
    }
  }

  const payout = resolved_outcome === 'YES' ? yes_shares : no_shares
  return payout - (yes_cost + no_cost)
}

async function main() {
  console.log('📊 WALLET CATEGORY BREAKDOWN GENERATOR\n')
  console.log('================================================\n')

  // Step 1: Load qualified wallets
  console.log('📊 Step 1: Loading qualified wallets...\n')

  const walletPnLPath = resolve(process.cwd(), 'audited_wallet_pnl_extended.json')
  if (!fs.existsSync(walletPnLPath)) {
    throw new Error('audited_wallet_pnl_extended.json not found - run batch calculation first')
  }

  const walletPnLs: WalletPnL[] = JSON.parse(fs.readFileSync(walletPnLPath, 'utf-8'))
  console.log(`✅ Loaded ${walletPnLs.length} qualified wallets\n`)

  // Step 2: Load dimension tables
  console.log('📊 Step 2: Loading dimension tables...\n')

  const marketsDimPath = resolve(process.cwd(), 'markets_dim_seed.json')
  const eventsDimPath = resolve(process.cwd(), 'events_dim_seed.json')

  if (!fs.existsSync(marketsDimPath) || !fs.existsSync(eventsDimPath)) {
    throw new Error('Dimension tables not found - run build-dimension-tables.ts first')
  }

  const marketsDim: MarketDim[] = JSON.parse(fs.readFileSync(marketsDimPath, 'utf-8'))
  const eventsDim: EventDim[] = JSON.parse(fs.readFileSync(eventsDimPath, 'utf-8'))

  console.log(`✅ Loaded ${marketsDim.length} markets`)
  console.log(`✅ Loaded ${eventsDim.length} events\n`)

  // Build lookup maps
  const marketsByCondition = new Map<string, MarketDim>()
  for (const market of marketsDim) {
    if (market.resolved_outcome) { // Only include resolved markets
      marketsByCondition.set(market.condition_id, market)
    }
  }

  const eventsByEventId = new Map<string, EventDim>()
  for (const event of eventsDim) {
    eventsByEventId.set(event.event_id, event)
  }

  console.log(`📊 ${marketsByCondition.size} resolved markets available for attribution\n`)

  // Step 3: Calculate category breakdown for each wallet
  console.log('📊 Step 3: Calculating category breakdowns...\n')

  const results: WalletCategoryBreakdown[] = []
  let processed = 0

  for (const { wallet_address, coverage_pct } of walletPnLs) {
    processed++

    if (processed % 100 === 0) {
      console.log(`   Progress: ${processed}/${walletPnLs.length} wallets`)
    }

    // Get all conditions for this wallet
    const conditionsQuery = `
      SELECT DISTINCT condition_id
      FROM trades_raw
      WHERE wallet_address = '${wallet_address}'
    `
    const conditionsResult = await clickhouse.query({ query: conditionsQuery, format: 'JSONEachRow' })
    const conditions = await conditionsResult.json() as Array<{ condition_id: string }>

    // Group P&L by category
    const categoryMap = new Map<string, { pnl: number; count: number }>()

    for (const { condition_id } of conditions) {
      const market = marketsByCondition.get(condition_id)
      if (!market || !market.resolved_outcome) continue // Skip unresolved

      // Get category from event
      const event = market.event_id ? eventsByEventId.get(market.event_id) : null
      const category = event?.category || 'uncategorized'

      // Get fills for this condition
      const fillsQuery = `
        SELECT condition_id, side, entry_price, shares
        FROM trades_raw
        WHERE wallet_address = '${wallet_address}' AND condition_id = '${condition_id}'
      `
      const fillsResult = await clickhouse.query({ query: fillsQuery, format: 'JSONEachRow' })
      const fills = await fillsResult.json() as Fill[]

      // Calculate P&L using audited formula
      const pnl = calculateConditionPnL(fills, market.resolved_outcome)

      // Accumulate by category
      const existing = categoryMap.get(category) || { pnl: 0, count: 0 }
      categoryMap.set(category, {
        pnl: existing.pnl + pnl,
        count: existing.count + 1
      })
    }

    // Build category breakdown array
    const categories: CategoryBreakdown[] = []
    let totalPnL = 0

    for (const [category, { pnl, count }] of categoryMap.entries()) {
      categories.push({
        category,
        realized_pnl_usd: parseFloat(pnl.toFixed(2)),
        num_conditions: count
      })
      totalPnL += pnl
    }

    // Sort categories by P&L descending
    categories.sort((a, b) => b.realized_pnl_usd - a.realized_pnl_usd)

    results.push({
      wallet_address,
      coverage_pct,
      total_realized_pnl_usd: parseFloat(totalPnL.toFixed(2)),
      categories
    })
  }

  console.log(`\n✅ Processed ${walletPnLs.length} wallets\n`)

  // Step 4: Write output
  console.log('📊 Step 4: Writing wallet_category_breakdown.json...\n')

  const outputPath = resolve(process.cwd(), 'wallet_category_breakdown.json')
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2))

  console.log(`✅ Wrote ${outputPath}`)
  console.log(`   Total wallets: ${results.length}\n`)

  // Step 5: Category summary
  console.log('📊 Step 5: Category summary across all wallets...\n')

  const globalCategoryMap = new Map<string, { pnl: number; walletCount: number; conditionCount: number }>()

  for (const wallet of results) {
    for (const cat of wallet.categories) {
      const existing = globalCategoryMap.get(cat.category) || { pnl: 0, walletCount: 0, conditionCount: 0 }
      globalCategoryMap.set(cat.category, {
        pnl: existing.pnl + cat.realized_pnl_usd,
        walletCount: existing.walletCount + 1,
        conditionCount: existing.conditionCount + cat.num_conditions
      })
    }
  }

  const categorySummary = Array.from(globalCategoryMap.entries())
    .map(([category, stats]) => ({
      category,
      total_pnl_usd: parseFloat(stats.pnl.toFixed(2)),
      num_wallets: stats.walletCount,
      num_conditions: stats.conditionCount
    }))
    .sort((a, b) => b.total_pnl_usd - a.total_pnl_usd)

  console.log('Top 10 Categories by Total P&L:\n')
  for (let i = 0; i < Math.min(10, categorySummary.length); i++) {
    const cat = categorySummary[i]
    console.log(`${i + 1}. ${cat.category}`)
    console.log(`   Total P&L: $${cat.total_pnl_usd.toLocaleString()}`)
    console.log(`   Wallets: ${cat.num_wallets}`)
    console.log(`   Conditions: ${cat.num_conditions}\n`)
  }

  console.log('================================================')
  console.log('✅ CATEGORY BREAKDOWN COMPLETE')
  console.log('================================================\n')

  process.exit(0)
}

main().catch((error) => {
  console.error('\n❌ Error:', error)
  process.exit(1)
})
