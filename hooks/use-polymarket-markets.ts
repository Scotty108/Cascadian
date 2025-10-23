'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CascadianMarket, PaginatedResponse } from '@/types/polymarket'

/**
 * Market type expected by the Market Screener UI
 */
interface Market {
  market_id: string
  title: string
  outcome: string
  last_price: number
  price_delta: number
  volume_24h: number
  trades_24h: number
  buyers_24h: number
  sellers_24h: number
  buy_sell_ratio: number
  whale_buy_sell_ratio: number
  whale_pressure: number
  smart_buy_sell_ratio: number
  smart_pressure: number
  momentum: number
  category: string
  sii: number
  volumeHistory?: number[]
}

/**
 * Generate sparkline data based on market momentum
 */
function generateVolumeHistory(volume: number, momentum: number): number[] {
  const base = volume / 8
  const variance = momentum * 100
  return Array.from({ length: 8 }, (_, i) => {
    const trend = (i / 7) * variance
    const noise = (Math.random() - 0.5) * base * 0.2
    return Math.max(0, base + trend + noise)
  })
}

/**
 * Transform CascadianMarket (from API) to Market (for UI)
 *
 * Phase 2: Real trade analytics from CLOB API
 * Phase 3: Will add whale tracking, smart money signals, etc.
 */
function transformToMarket(cascadian: CascadianMarket): Market {
  // Extract analytics data (if available from market_analytics table)
  const analytics = cascadian.analytics

  // Use real momentum from analytics, or default to 0
  const momentum = analytics?.momentum_score || 0

  // Use real price change for delta
  const priceDelta = analytics?.price_change_24h || 0

  // Default SII to 0 for now (Phase 3 will calculate from multiple signals)
  const sii = 0

  // Determine which outcome to display
  // Strategy: Show the outcome with highest probability (like hashdive.com)
  // For binary markets: show the >50% outcome
  // For multi-outcome: show the highest probability outcome
  let outcome = cascadian.outcomes[0] || 'Yes'
  let outcomePrice = cascadian.current_price

  // Try to parse outcome prices from raw_data
  try {
    const rawData = cascadian.raw_data as any
    if (rawData?.outcomePrices) {
      const pricesStr = typeof rawData.outcomePrices === 'string'
        ? rawData.outcomePrices
        : JSON.stringify(rawData.outcomePrices)
      const prices = JSON.parse(pricesStr.replace(/'/g, '"'))

      if (Array.isArray(prices) && prices.length === cascadian.outcomes.length) {
        // Find outcome with highest probability
        const maxPriceIndex = prices.reduce((maxIdx, price, idx, arr) =>
          parseFloat(price) > parseFloat(arr[maxIdx]) ? idx : maxIdx
        , 0)

        outcome = cascadian.outcomes[maxPriceIndex]
        outcomePrice = parseFloat(prices[maxPriceIndex])
      }
    }
  } catch (error) {
    // If parsing fails, fall back to first outcome
    console.warn('Failed to parse outcome prices:', error)
  }

  return {
    market_id: cascadian.market_id,
    title: cascadian.title,
    outcome: outcome,
    last_price: outcomePrice,
    price_delta: priceDelta,
    volume_24h: cascadian.volume_24h,
    trades_24h: analytics?.trades_24h || 0,
    buyers_24h: analytics?.buyers_24h || 0,
    sellers_24h: analytics?.sellers_24h || 0,
    buy_sell_ratio: analytics?.buy_sell_ratio || 1,
    whale_buy_sell_ratio: 1, // Phase 3 signal
    whale_pressure: 0, // Phase 3 signal
    smart_buy_sell_ratio: 1, // Phase 3 signal
    smart_pressure: 0, // Phase 3 signal
    momentum: momentum,
    category: cascadian.category,
    sii: sii,
    volumeHistory: generateVolumeHistory(cascadian.volume_24h, momentum),
  }
}

/**
 * Query parameters for market list endpoint
 */
interface UsePolymarketMarketsParams {
  category?: string
  active?: boolean
  limit?: number
  offset?: number
  sort?: 'volume' | 'liquidity' | 'created_at'
}

/**
 * Fetch Polymarket markets from API
 */
export function usePolymarketMarkets(params?: UsePolymarketMarketsParams) {
  return useQuery({
    queryKey: ['polymarket-markets', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams()

      if (params?.category) searchParams.set('category', params.category)
      if (params?.active !== undefined) searchParams.set('active', params.active.toString())
      if (params?.limit) searchParams.set('limit', params.limit.toString())
      if (params?.offset) searchParams.set('offset', params.offset.toString())
      if (params?.sort) searchParams.set('sort', params.sort)

      // Always fetch analytics data to show trade metrics
      searchParams.set('include_analytics', 'true')

      const response = await fetch(`/api/polymarket/markets?${searchParams}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to fetch markets')
      }

      const json: PaginatedResponse<CascadianMarket> = await response.json()

      // Transform CascadianMarket[] to Market[] for UI
      return {
        markets: json.data.map(transformToMarket),
        total: json.total,
        page: json.page,
        limit: json.limit,
        stale: json.stale,
        last_synced: json.last_synced,
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (matches backend sync interval)
    refetchInterval: 10 * 1000, // Poll every 10 seconds for live updates
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

/**
 * Trigger manual sync of Polymarket data
 */
export function usePolymarketSync() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/polymarket/sync', { method: 'POST' })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Sync failed')
      }

      return response.json()
    },
    onSuccess: () => {
      // Invalidate all market queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ['polymarket-markets'] })
    },
  })
}
