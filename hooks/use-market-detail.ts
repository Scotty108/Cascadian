/**
 * React Query Hook for Market Detail Data
 *
 * Fetches detailed information for a single market from /api/polymarket/markets/[id]
 */

import { useQuery } from '@tanstack/react-query'

export interface PolymarketMarket {
  id: string
  question: string
  conditionId?: string
  description?: string
  category: string
  image?: string
  icon?: string
  outcomes: string[]
  outcomePrices: string[]
  volume: string
  volume24hr: string
  liquidity: string
  clobTokenIds: string[]
  active: boolean
  closed: boolean
  archived: boolean
  new: boolean
  featured: boolean
  enableOrderBook: boolean
  orderPriceMinTickSize: number
  orderMinSize: number
  startDate?: string
  endDate?: string
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  tags?: Array<{ label: string; slug: string }>
  groupItemTitle?: string
  groupItemThreshold?: string
}

export interface UseMarketDetailResult {
  market: PolymarketMarket | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useMarketDetail(marketId: string): UseMarketDetailResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['market-detail', marketId],
    queryFn: async () => {
      const response = await fetch(`/api/polymarket/markets/${marketId}`)

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Market not found')
        }
        throw new Error(`Failed to fetch market: ${response.status}`)
      }

      return response.json()
    },
    enabled: !!marketId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 1000, // Poll every 30 seconds
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  return {
    market: data?.data || null,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
