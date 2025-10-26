/**
 * React Query Hook for Smart Money SII (Smart Investor Index)
 *
 * Fetches Market SII showing which side the smart money is on
 */

import { useQuery } from '@tanstack/react-query'

export interface SmartMoneySII {
  market_id: string
  market_question?: string

  // YES side
  yes_top_wallets: string[]
  yes_avg_omega: number
  yes_total_volume: number
  yes_wallet_count: number

  // NO side
  no_top_wallets: string[]
  no_avg_omega: number
  no_total_volume: number
  no_wallet_count: number

  // Signal
  smart_money_side: 'YES' | 'NO' | 'NEUTRAL'
  omega_differential: number
  signal_strength: number // 0-1
  confidence_score: number // 0-1

  // Timestamps
  calculated_at: string
}

export interface UseSmartMoneySIIParams {
  marketId: string
  fresh?: boolean
}

export interface UseSmartMoneySIIResult {
  data: SmartMoneySII | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useSmartMoneySII(params: UseSmartMoneySIIParams): UseSmartMoneySIIResult {
  const { marketId, fresh = false } = params

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['smart-money-sii', marketId, fresh],
    queryFn: async () => {
      if (!marketId) {
        return null
      }

      const response = await fetch(
        `/api/markets/${marketId}/sii${fresh ? '?fresh=true' : ''}`
      )

      if (!response.ok) {
        if (response.status === 404) {
          // SII not available for this market
          return null
        }
        throw new Error(`Failed to fetch Smart Money SII: ${response.status}`)
      }

      const result = await response.json()
      return result
    },
    enabled: !!marketId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: fresh ? undefined : 60 * 60 * 1000, // Refresh every hour (unless fresh)
  })

  return {
    data: data || null,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
