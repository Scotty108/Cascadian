/**
 * React Query Hook for Smart Money Breakdown Data
 *
 * Fetches detailed smart money analysis including:
 * - Entry timeline
 * - Top positions
 * - P&L status
 * - Conviction metrics
 */

import { useQuery } from '@tanstack/react-query'

export interface EntryMonth {
  month: string
  wallets: number
  total_usd: number
  avg_entry_price: number
  min_entry: number
  max_entry: number
}

export interface TopPosition {
  wallet_id: string
  tier: string
  side: string
  shares: number
  cost_usd: number
  avg_entry_price: number
  opened_at: string
  fills_count: number
  unrealized_pnl: number
  roi_percent: number
}

export interface SmartMoneyBreakdown {
  market_id: string
  summary: {
    total_wallets: number
    smart_wallets: number
    smart_yes_wallets: number
    smart_no_wallets: number
    total_open_interest_usd: number
    smart_invested_usd: number
    smart_yes_usd: number
    smart_no_usd: number
    smart_money_odds: number
    crowd_odds: number
    divergence: number
  }
  entry_timeline: EntryMonth[]
  top_positions: TopPosition[]
  pnl_status: {
    avg_entry_price: number
    current_price: number
    unrealized_pnl_usd: number
    unrealized_roi_percent: number
    status: 'winning' | 'losing' | 'breakeven'
    exit_count: number
    hold_rate_percent: number
  }
  conviction: {
    score: number
    level: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
    factors: string[]
  }
}

export interface UseSmartMoneyBreakdownResult {
  data: SmartMoneyBreakdown | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useSmartMoneyBreakdown(
  conditionId: string | undefined
): UseSmartMoneyBreakdownResult {
  const cleanId = conditionId?.replace(/^0x/i, '').toLowerCase() || ''

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['smart-money-breakdown', cleanId],
    queryFn: async () => {
      if (!cleanId) return null

      const response = await fetch(
        `/api/markets/${cleanId}/smart-money-breakdown`
      )

      if (!response.ok) {
        if (response.status === 404) {
          return null
        }
        throw new Error(`Failed to fetch smart money breakdown: ${response.status}`)
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch smart money breakdown')
      }

      return result.data as SmartMoneyBreakdown
    },
    enabled: !!cleanId && cleanId.length === 64,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 2 * 60 * 1000, // Refetch every 2 minutes
    refetchOnWindowFocus: true,
  })

  return {
    data: data || null,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
