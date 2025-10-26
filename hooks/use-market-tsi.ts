/**
 * React Query Hook for Market TSI (True Strength Index)
 *
 * Fetches TSI momentum signals and conviction scores for a market
 */

import { useQuery } from '@tanstack/react-query'

export type TSISignal = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

export interface MarketTSI {
  market_id: string
  tsi_fast: number                      // Fast TSI value (-100 to +100)
  tsi_slow: number                      // Slow TSI value (-100 to +100)
  crossover_signal: TSISignal           // Current signal type
  crossover_timestamp: string | null    // When signal fired
  directional_conviction: number        // 0-1 conviction score
  elite_consensus_pct: number           // % of elite wallets on this side
  category_specialist_pct: number       // % of specialists on this side
  omega_weighted_consensus: number      // Omega-weighted vote
  meets_entry_threshold: boolean        // conviction >= 0.9
  signal_strength: 'STRONG' | 'MODERATE' | 'WEAK'
  updated_at: string
}

export interface UseMarketTSIParams {
  marketId: string
  enabled?: boolean
  refreshInterval?: number  // milliseconds, defaults to 10s
}

export interface UseMarketTSIResult {
  data: MarketTSI | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useMarketTSI(params: UseMarketTSIParams): UseMarketTSIResult {
  const { marketId, enabled = true, refreshInterval = 10000 } = params

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['market-tsi', marketId],
    queryFn: async () => {
      if (!marketId) {
        return null
      }

      // TODO: Replace with real API endpoint when ready
      // For now, return mock data for development
      const useMockData = false

      if (useMockData) {
        // Mock data for development
        await new Promise(resolve => setTimeout(resolve, 500)) // Simulate network delay

        const mockSignals: TSISignal[] = ['BULLISH', 'BEARISH', 'NEUTRAL']
        const signal = mockSignals[Math.floor(Math.random() * mockSignals.length)]
        const conviction = Math.random()

        return {
          market_id: marketId,
          tsi_fast: Math.random() * 200 - 100,
          tsi_slow: Math.random() * 200 - 100,
          crossover_signal: signal,
          crossover_timestamp: signal !== 'NEUTRAL' ? new Date().toISOString() : null,
          directional_conviction: conviction,
          elite_consensus_pct: Math.random(),
          category_specialist_pct: Math.random(),
          omega_weighted_consensus: Math.random(),
          meets_entry_threshold: conviction >= 0.9,
          signal_strength: conviction >= 0.9 ? 'STRONG' : conviction >= 0.7 ? 'MODERATE' : 'WEAK',
          updated_at: new Date().toISOString(),
        } as MarketTSI
      }

      // Real API call (when endpoint is ready)
      const response = await fetch(`/api/signals/tsi/${marketId}`)

      if (!response.ok) {
        if (response.status === 404) {
          return null
        }
        throw new Error(`Failed to fetch TSI signal: ${response.status}`)
      }

      const result = await response.json()
      return result
    },
    enabled: enabled && !!marketId,
    staleTime: 5000,                    // Consider data stale after 5s
    refetchInterval: refreshInterval,   // Auto-refresh every 10s (live signals)
  })

  return {
    data: data || null,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
