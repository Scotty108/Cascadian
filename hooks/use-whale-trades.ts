/**
 * React Query Hook for Whale Trades (Option 2)
 *
 * Fetches large trades from Polymarket CLOB API via our proxy endpoint.
 * Polls for new whale activity every 15 seconds.
 */

'use client'

import { useQuery } from '@tanstack/react-query'

export interface WhaleTrade {
  trade_id: string
  wallet_address: string
  wallet_alias: string
  timestamp: string
  side: 'YES' | 'NO'
  action: 'BUY' | 'SELL'
  shares: number
  price: number
  amount_usd: number
  market_id: string
  raw?: any
}

export interface UseWhaleTradesParams {
  marketId: string
  limit?: number
  minSize?: number // Minimum USD value to be considered a whale trade
  enabled?: boolean
}

export interface UseWhaleTradesResult {
  data: WhaleTrade[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useWhaleTrades({
  marketId,
  limit = 100,
  minSize = 10000,
  enabled = true,
}: UseWhaleTradesParams): UseWhaleTradesResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['whale-trades', marketId, limit, minSize],
    queryFn: async () => {
      if (!marketId) {
        return { data: [], count: 0 }
      }

      const params = new URLSearchParams({
        limit: limit.toString(),
        minSize: minSize.toString(),
      })

      const response = await fetch(`/api/polymarket/whale-trades/${marketId}?${params}`)

      if (!response.ok) {
        // If market doesn't have trades, return empty array
        if (response.status === 404) {
          return { data: [], count: 0 }
        }
        throw new Error(`Failed to fetch whale trades: ${response.status}`)
      }

      return response.json()
    },
    enabled: enabled && !!marketId,
    staleTime: 15 * 1000, // 15 seconds
    refetchInterval: 15 * 1000, // Poll every 15 seconds for new whale activity
    retry: false, // Don't retry on 404s
  })

  return {
    data: data?.data || [],
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
