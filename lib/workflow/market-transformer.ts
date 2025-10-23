/**
 * MARKET TRANSFORMER
 *
 * Transforms Polymarket data from database format (CascadianMarket)
 * to workflow-friendly format for node execution.
 *
 * Handles:
 * - Field mapping (market_id → id, title → question, etc.)
 * - Analytics integration
 * - Date formatting
 * - Price normalization
 */

import type { CascadianMarket } from '@/types/polymarket'

/**
 * Workflow-friendly market format
 * Simpler structure optimized for bot logic
 */
export interface WorkflowMarket {
  id: string
  question: string
  category: string
  currentPrice: number
  volume: number
  volume24h: number
  liquidity: number
  endsAt: Date
  outcomes: string[]
  active: boolean
  closed: boolean

  // Analytics (if available)
  analytics?: {
    trades24h?: number
    buyers24h?: number
    sellers24h?: number
    buySellRatio?: number
    momentum?: number
  }

  // Metadata
  slug: string
  imageUrl?: string
}

/**
 * Transform CascadianMarket to WorkflowMarket
 */
export function transformMarketForWorkflow(market: CascadianMarket): WorkflowMarket {
  return {
    id: market.market_id,
    question: market.title,
    category: market.category,
    currentPrice: market.current_price,
    volume: market.volume_total,
    volume24h: market.volume_24h,
    liquidity: market.liquidity,
    endsAt: market.end_date,
    outcomes: market.outcomes,
    active: market.active,
    closed: market.closed,

    // Analytics (if available)
    analytics: market.analytics
      ? {
          trades24h: market.analytics.trades_24h,
          buyers24h: market.analytics.buyers_24h,
          sellers24h: market.analytics.sellers_24h,
          buySellRatio: market.analytics.buy_sell_ratio,
          momentum: market.analytics.momentum_score,
        }
      : undefined,

    // Metadata
    slug: market.slug,
    imageUrl: market.image_url,
  }
}

/**
 * Transform array of CascadianMarkets
 */
export function transformMarketsForWorkflow(markets: CascadianMarket[]): WorkflowMarket[] {
  return markets.map(transformMarketForWorkflow)
}

/**
 * Get stub/mock market data for testing and fallback
 */
export function getStubMarkets(): WorkflowMarket[] {
  return [
    {
      id: 'market-1',
      question: 'Will Bitcoin hit $100k by end of 2025?',
      category: 'Crypto',
      currentPrice: 0.65,
      volume: 450000,
      volume24h: 125000,
      liquidity: 50000,
      endsAt: new Date('2025-12-31'),
      outcomes: ['Yes', 'No'],
      active: true,
      closed: false,
      slug: 'btc-100k-2025',
    },
    {
      id: 'market-2',
      question: 'Will Democrats win the 2026 midterms?',
      category: 'Politics',
      currentPrice: 0.52,
      volume: 750000,
      volume24h: 250000,
      liquidity: 100000,
      endsAt: new Date('2026-11-03'),
      outcomes: ['Yes', 'No'],
      active: true,
      closed: false,
      slug: 'democrats-2026-midterms',
    },
    {
      id: 'market-3',
      question: 'Will AI exceed human performance in coding by 2026?',
      category: 'Technology',
      currentPrice: 0.45,
      volume: 200000,
      volume24h: 75000,
      liquidity: 30000,
      endsAt: new Date('2026-12-31'),
      outcomes: ['Yes', 'No'],
      active: true,
      closed: false,
      slug: 'ai-coding-2026',
    },
  ]
}
