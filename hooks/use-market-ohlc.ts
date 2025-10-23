/**
 * React Query Hook for Market OHLC Data
 *
 * Fetches price history from /api/polymarket/ohlc/[marketId]
 */

import { useQuery } from '@tanstack/react-query'

export interface OHLCDataPoint {
  t: number  // Unix timestamp (seconds)
  o: number  // Open price
  h: number  // High price
  l: number  // Low price
  c: number  // Close price
  v: number  // Volume
  bid?: number
  ask?: number
}

export interface UseMarketOHLCParams {
  marketId: string
  interval?: string
  limit?: number
  startTs?: number
  endTs?: number
}

export interface UseMarketOHLCResult {
  data: OHLCDataPoint[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useMarketOHLC(params: UseMarketOHLCParams): UseMarketOHLCResult {
  const { marketId, interval = '1m', limit = 100, startTs, endTs } = params

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['market-ohlc', marketId, interval, limit, startTs, endTs],
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      searchParams.set('interval', interval)
      searchParams.set('limit', limit.toString())
      if (startTs) searchParams.set('startTs', startTs.toString())
      if (endTs) searchParams.set('endTs', endTs.toString())

      const response = await fetch(`/api/polymarket/ohlc/${marketId}?${searchParams}`)

      if (!response.ok) {
        // If table doesn't exist, return empty array instead of throwing
        if (response.status === 500) {
          const errorData = await response.json()
          if (errorData.error?.includes('prices_1m')) {
            return { data: [] }
          }
        }
        throw new Error(`Failed to fetch OHLC data: ${response.status}`)
      }

      return response.json()
    },
    enabled: !!marketId,
    staleTime: 1 * 60 * 1000, // 1 minute
    refetchInterval: 30 * 1000, // Poll every 30 seconds
    retry: false, // Don't retry on database errors
  })

  return {
    data: data?.data || [],
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
