/**
 * React Query Hook for Market OHLC Data
 *
 * Fetches price history from /api/polymarket/ohlc/[marketId]
 *
 * By default, fetches ALL available historical data (interval="max")
 * which provides ~30 days of price history with 700+ data points
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
  interval?: string  // Default: "max" (all available data ~30 days)
  fidelity?: number  // Optional: data resolution in minutes
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
  const { marketId, interval = 'max', fidelity, startTs, endTs } = params

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['market-ohlc', marketId, interval, fidelity, startTs, endTs],
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      searchParams.set('interval', interval)
      if (fidelity) searchParams.set('fidelity', fidelity.toString())
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
