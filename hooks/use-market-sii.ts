/**
 * React Query Hook for Market SII (Signal Intelligence Index)
 *
 * Fetches real-time SII calculation based on holder distribution
 */

import { useQuery } from '@tanstack/react-query'

export interface SIIData {
  market_id: string
  condition_id: string
  sii_score: number  // 0-100
  holder_count: number
  total_shares: number
  avg_whale_score: number
  top_holder_score: number
  top_holders: Array<{
    wallet_alias: string
    shares: number
    whale_score: number
    market_share_pct: number
  }>
  interpretation: string
}

export interface UseMarketSIIParams {
  marketId: string
  conditionId: string
}

export interface UseMarketSIIResult {
  data: SIIData | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useMarketSII(params: UseMarketSIIParams): UseMarketSIIResult {
  const { marketId, conditionId } = params

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['market-sii', marketId, conditionId],
    queryFn: async () => {
      if (!marketId || !conditionId) {
        return null
      }

      const response = await fetch(
        `/api/markets/${marketId}/sii?conditionId=${conditionId}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch SII: ${response.status}`)
      }

      const result = await response.json()
      return result.data
    },
    enabled: !!marketId && !!conditionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 60 * 1000, // Refresh every minute
  })

  return {
    data: data || null,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
