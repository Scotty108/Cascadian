/**
 * Wallet Specialists Analytics
 *
 * Identifies top wallets and their category specializations
 * Used for investor demos and product analytics
 */

import { resolve } from 'path'
import * as fs from 'fs'
import { getCanonicalCategoryForEvent } from '@/lib/category/canonical-category'
import { getWalletCategoryBreakdown } from '@/lib/analytics/wallet-category-breakdown'
import { getWalletResolutionAccuracy, generateResolutionBlurb } from '@/lib/analytics/wallet-resolution-accuracy'

export interface WalletSpecialist {
  wallet_address: string
  realized_pnl_usd: number
  coverage_pct: number
  top_category: string
  top_category_pnl_usd: number | null
  top_category_num_markets: number | null
  blurb: string

  // Resolution accuracy (conviction accuracy - were they right at resolution?)
  resolution_accuracy_overall_pct: number | null
  resolution_markets_tracked: number | null
  resolution_accuracy_top_category_pct: number | null
  resolution_top_category: string | null
  resolution_markets_tracked_in_top_category: number | null
  resolution_blurb: string
}

interface MarketDim {
  condition_id: string
  market_id: string
  event_id: string | null
  question: string
}

interface EventDim {
  event_id: string
  category: string | null
  tags: Array<{ label: string }>
}

interface CategoryBreakdown {
  canonical_category: string
  pnl_usd: number
  num_markets: number
}

/**
 * Load enriched markets with canonical categories
 */
function loadEnrichedMarkets(): Map<string, { canonical_category: string; raw_tags: string[] }> {
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')

  const markets: MarketDim[] = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
  const events: EventDim[] = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))

  // Build event lookup
  const eventsMap = new Map<string, EventDim>()
  for (const event of events) {
    eventsMap.set(event.event_id, event)
  }

  // Build condition_id → canonical_category map
  const enrichedMap = new Map<string, { canonical_category: string; raw_tags: string[] }>()

  for (const market of markets) {
    let canonical_category = 'Uncategorized'
    let raw_tags: string[] = []

    if (market.event_id) {
      const event = eventsMap.get(market.event_id)
      if (event) {
        const result = getCanonicalCategoryForEvent({
          category: event.category,
          tags: event.tags || []
        })
        canonical_category = result.canonical_category
        raw_tags = result.raw_tags
      }
    }

    enrichedMap.set(market.condition_id, { canonical_category, raw_tags })
  }

  return enrichedMap
}

// Removed: Old modeled generateCategoryBreakdown()
// Now using real ClickHouse data via getWalletCategoryBreakdown()

/**
 * Generate blurb for a wallet
 *
 * Uses real per-category P&L from ClickHouse when available.
 * Falls back to generic phrasing when ClickHouse is unavailable.
 */
function generateBlurb(specialist: WalletSpecialist): string {
  const shortAddr = `${specialist.wallet_address.slice(0, 6)}...${specialist.wallet_address.slice(-4)}`
  const pnl = (specialist.realized_pnl_usd / 1000).toFixed(1)
  const coverage = specialist.coverage_pct.toFixed(0)

  let specialization = ''
  if (specialist.top_category === 'Politics / Geopolitics') {
    specialization = 'geopolitical specialist'
  } else if (specialist.top_category === 'Macro / Economy') {
    specialization = 'macro trader'
  } else if (specialist.top_category === 'Earnings / Business') {
    specialization = 'earnings trader'
  } else if (specialist.top_category === 'Crypto / DeFi') {
    specialization = 'crypto specialist'
  } else if (specialist.top_category === 'Sports') {
    specialization = 'sports bettor'
  } else if (specialist.top_category === 'Uncategorized') {
    specialization = 'trader'
  } else {
    specialization = `${specialist.top_category} specialist`
  }

  // When ClickHouse data is available, mention the category specialization
  if (specialist.top_category_pnl_usd !== null && specialist.top_category !== 'Uncategorized') {
    return `Wallet ${shortAddr} has $${pnl}K realized P&L with most of it coming from ${specialist.top_category}, and ~${coverage}% coverage, so this wallet looks like a ${specialization}.`
  }

  // Fallback: graceful degradation when ClickHouse is unavailable
  return `Wallet ${shortAddr} has $${pnl}K realized P&L with ~${coverage}% coverage and looks like a ${specialization}.`
}

/**
 * Get top 20 wallet specialists
 *
 * Returns wallets ranked by realized P&L with their category specializations
 * Uses real ClickHouse data for per-category P&L when available
 */
export async function getTopWalletSpecialists(): Promise<WalletSpecialist[]> {
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

  const specialists: WalletSpecialist[] = []

  for (let i = 0; i < top20.length; i++) {
    const wallet = top20[i]
    const walletAddress = wallet.wallet_address || wallet.address
    const totalPnl = wallet.realized_pnl_usd || wallet.realizedPnlUsd
    const coverage = wallet.coverage_pct || wallet.coveragePct

    // Get real category breakdown from ClickHouse
    // Falls back to null if ClickHouse unavailable (graceful degradation)
    const breakdown = await getWalletCategoryBreakdown(walletAddress)

    // Get resolution accuracy from ClickHouse
    const resolutionAccuracy = await getWalletResolutionAccuracy(walletAddress)

    const specialist: WalletSpecialist = {
      wallet_address: walletAddress,
      realized_pnl_usd: totalPnl,
      coverage_pct: coverage,
      top_category: breakdown?.top_category || 'Uncategorized',
      top_category_pnl_usd: breakdown?.top_category_pnl_usd || null,
      top_category_num_markets: breakdown?.top_category_num_markets || null,
      blurb: '', // Will be filled below

      // Resolution accuracy fields
      resolution_accuracy_overall_pct: resolutionAccuracy?.overall_pct || null,
      resolution_markets_tracked: resolutionAccuracy?.markets_tracked || null,
      resolution_accuracy_top_category_pct: resolutionAccuracy?.top_category_pct || null,
      resolution_top_category: resolutionAccuracy?.top_category || null,
      resolution_markets_tracked_in_top_category: resolutionAccuracy?.top_category_markets || null,
      resolution_blurb: generateResolutionBlurb(resolutionAccuracy)
    }

    // Generate blurb
    specialist.blurb = generateBlurb(specialist)

    specialists.push(specialist)
  }

  return specialists
}

/**
 * Get specialist info for a specific wallet
 */
export function getWalletSpecialistInfo(walletAddress: string): WalletSpecialist | null {
  const specialists = getTopWalletSpecialists()
  return specialists.find(s => s.wallet_address.toLowerCase() === walletAddress.toLowerCase()) || null
}
