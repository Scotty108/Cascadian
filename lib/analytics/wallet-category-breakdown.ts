/**
 * Wallet Category Breakdown
 *
 * Computes real per-category P&L for wallets using ClickHouse data
 * Joins trades → markets → events → canonical categories
 */

import { createClient } from '@clickhouse/client'
import { resolve } from 'path'
import * as fs from 'fs'
import { getCanonicalCategoryForEvent } from '@/lib/category/canonical-category'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
})

interface MarketDim {
  condition_id: string
  market_id: string
  event_id: string | null
}

interface EventDim {
  event_id: string
  category: string | null
  tags: Array<{ label: string }>
}

// Cache dimension data
let marketsCache: Map<string, MarketDim> | null = null
let eventsCache: Map<string, EventDim> | null = null

/**
 * Load dimension data from files
 */
function loadDimensionData() {
  if (marketsCache && eventsCache) {
    return { marketsCache, eventsCache }
  }

  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')

  // Load markets
  marketsCache = new Map()
  if (fs.existsSync(marketsPath)) {
    const markets: MarketDim[] = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
    for (const market of markets) {
      marketsCache.set(market.condition_id, market)
    }
  }

  // Load events
  eventsCache = new Map()
  if (fs.existsSync(eventsPath)) {
    const events: EventDim[] = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))
    for (const event of events) {
      eventsCache.set(event.event_id, event)
    }
  }

  return { marketsCache, eventsCache }
}

/**
 * Get category breakdown for a wallet from ClickHouse
 *
 * Returns the top category by P&L with real numbers
 * Returns null if ClickHouse unavailable or wallet has no data
 */
export async function getWalletCategoryBreakdown(
  walletAddress: string
): Promise<{
  top_category: string
  top_category_pnl_usd: number
  top_category_num_markets: number
} | null> {
  try {
    // Query ClickHouse for resolved P&L per condition
    const query = `
      SELECT
        condition_id,
        SUM(realized_pnl_usd) AS pnl_usd
      FROM trades_raw
      WHERE wallet_address = {wallet:String}
        AND is_resolved = 1
      GROUP BY condition_id
    `

    const resultSet = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      query_params: { wallet: walletAddress },
    })

    const rows = (await resultSet.json()) as Array<{
      condition_id: string
      pnl_usd: string
    }>

    if (rows.length === 0) {
      return null
    }

    // Load dimension data
    const { marketsCache, eventsCache } = loadDimensionData()

    // Map each condition to canonical category
    const categoryAggregates = new Map<
      string,
      { pnl: number; markets: Set<string> }
    >()

    for (const row of rows) {
      const conditionId = row.condition_id
      const pnl = parseFloat(row.pnl_usd)

      // Look up market
      const market = marketsCache.get(conditionId)
      if (!market || !market.event_id) {
        // No event association, bucket as Uncategorized
        if (!categoryAggregates.has('Uncategorized')) {
          categoryAggregates.set('Uncategorized', { pnl: 0, markets: new Set() })
        }
        const agg = categoryAggregates.get('Uncategorized')!
        agg.pnl += pnl
        agg.markets.add(conditionId)
        continue
      }

      // Look up event
      const event = eventsCache.get(market.event_id)
      if (!event) {
        // Event not found, bucket as Uncategorized
        if (!categoryAggregates.has('Uncategorized')) {
          categoryAggregates.set('Uncategorized', { pnl: 0, markets: new Set() })
        }
        const agg = categoryAggregates.get('Uncategorized')!
        agg.pnl += pnl
        agg.markets.add(conditionId)
        continue
      }

      // Get canonical category
      const canonicalResult = getCanonicalCategoryForEvent({
        category: event.category,
        tags: event.tags || [],
      })

      const category = canonicalResult.canonical_category

      // Aggregate
      if (!categoryAggregates.has(category)) {
        categoryAggregates.set(category, { pnl: 0, markets: new Set() })
      }
      const agg = categoryAggregates.get(category)!
      agg.pnl += pnl
      agg.markets.add(conditionId)
    }

    // Find top category by P&L
    let topCategory = 'Uncategorized'
    let topPnl = -Infinity
    let topMarketCount = 0

    for (const [category, agg] of categoryAggregates.entries()) {
      if (agg.pnl > topPnl) {
        topCategory = category
        topPnl = agg.pnl
        topMarketCount = agg.markets.size
      }
    }

    if (topPnl === -Infinity) {
      return null
    }

    return {
      top_category: topCategory,
      top_category_pnl_usd: topPnl,
      top_category_num_markets: topMarketCount,
    }
  } catch (error) {
    console.error('Failed to get wallet category breakdown:', error)
    return null // Degrade gracefully
  }
}

/**
 * Close ClickHouse connection
 */
export async function closeClickHouse() {
  await clickhouse.close()
}
