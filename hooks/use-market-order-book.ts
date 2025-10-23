/**
 * React Query Hook for Market Order Book Data
 *
 * Fetches order book from /api/polymarket/order-book/[marketId]
 */

import { useQuery } from '@tanstack/react-query'

export interface OrderBookEntry {
  price: number
  size: number
}

export interface OrderBookData {
  bids: OrderBookEntry[]
  asks: OrderBookEntry[]
  spread: number | null
  timestamp: number
  marketId: string
}

export interface UseMarketOrderBookResult {
  data: OrderBookData | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useMarketOrderBook(marketId: string): UseMarketOrderBookResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['market-order-book', marketId],
    queryFn: async () => {
      const response = await fetch(`/api/polymarket/order-book/${marketId}`)

      if (!response.ok) {
        // If market doesn't have an order book, return null
        if (response.status === 404) {
          return { data: null }
        }
        throw new Error(`Failed to fetch order book: ${response.status}`)
      }

      return response.json()
    },
    enabled: !!marketId,
    staleTime: 10 * 1000, // 10 seconds - order books change frequently
    refetchInterval: 5 * 1000, // Poll every 5 seconds for live order book
    retry: false, // Don't retry on 404s
  })

  return {
    data: data?.data || null,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
