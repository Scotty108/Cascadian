/**
 * React Query Hook for Smart Money Signals
 *
 * Fetches historical smart money data with signal detection for charting.
 */

import { useQuery } from '@tanstack/react-query'

export interface SmartMoneySignalPoint {
  timestamp: number
  crowd_odds: number
  smart_money_odds: number
  divergence: number
  wallet_count: number
  total_usd: number
  flow_24h: number
  signal_type: string | null
  signal_action: 'BET_YES' | 'BET_NO' | null
  signal_is_fade: boolean
  expected_roi: number | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null
}

export interface SignalSummary {
  count: number
  action: 'BET_YES' | 'BET_NO'
  is_fade: boolean
  expected_roi: number
  first_seen: number
  last_seen: number
}

export interface SmartMoneySignalsData {
  market_id: string
  category: string
  history: SmartMoneySignalPoint[]
  current: SmartMoneySignalPoint | null
  signals: {
    total_occurrences: number
    by_type: Record<string, SignalSummary>
    has_active_signal: boolean
  }
  stats: {
    data_points: number
    days_requested: number
    oldest: string | null
    newest: string | null
  }
}

export interface UseSmartMoneySignalsResult {
  data: SmartMoneySignalsData | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useSmartMoneySignals(
  conditionId: string,
  days: number = 30
): UseSmartMoneySignalsResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['smart-money-signals', conditionId, days],
    queryFn: async () => {
      if (!conditionId) return null

      const response = await fetch(
        `/api/markets/${conditionId}/smart-money-signals?days=${days}`
      )

      if (!response.ok) {
        if (response.status === 404) {
          return null
        }
        throw new Error(`Failed to fetch smart money signals: ${response.status}`)
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch smart money signals')
      }

      return result.data as SmartMoneySignalsData
    },
    enabled: !!conditionId && conditionId.length === 64,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 60 * 1000, // Poll every minute
    refetchOnWindowFocus: true,
  })

  return {
    data: data || null,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
