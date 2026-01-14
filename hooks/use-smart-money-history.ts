/**
 * React Query Hook for Smart Money History Data
 *
 * Fetches historical smart money odds for charting alongside market price.
 */

import { useQuery } from '@tanstack/react-query'

export interface SmartMoneyDataPoint {
  timestamp: number  // Unix ms for chart compatibility
  crowd_odds: number // Percentage (0-100)
  smart_money_odds: number // Percentage (0-100)
  divergence: number // Percentage difference
  smart_wallet_count: number
  smart_holdings_usd: number
}

export interface SmartMoneyHistoryData {
  market_id: string
  history: SmartMoneyDataPoint[]
  current: {
    crowd_odds: number
    smart_money_odds: number
    divergence: number
    smart_wallet_count: number
    smart_holdings_usd: number
    as_of: string
  } | null
  stats: {
    data_points: number
    days_requested: number
    oldest: string | null
    newest: string | null
  }
}

export interface UseSmartMoneyHistoryResult {
  data: SmartMoneyHistoryData | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useSmartMoneyHistory(
  conditionId: string,
  days: number = 30
): UseSmartMoneyHistoryResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['smart-money-history', conditionId, days],
    queryFn: async () => {
      if (!conditionId) return null

      const response = await fetch(
        `/api/markets/${conditionId}/smart-money-history?days=${days}`
      )

      if (!response.ok) {
        if (response.status === 404) {
          return null
        }
        throw new Error(`Failed to fetch smart money history: ${response.status}`)
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch smart money history')
      }

      return result.data as SmartMoneyHistoryData
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
