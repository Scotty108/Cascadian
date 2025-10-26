/**
 * React Query Hook for Top Performing Wallets
 *
 * Fetches top wallets by Tier 1 metrics with sorting and filtering
 */

import { useQuery } from '@tanstack/react-query'

export type TimeWindow = '30d' | '90d' | '180d' | 'lifetime'
export type SortMetric = 'omega' | 'pnl' | 'win_rate' | 'ev_per_bet' | 'resolved_bets'

export interface WalletMetrics {
  wallet_address: string
  window: TimeWindow
  omega_gross: number
  omega_net: number
  net_pnl_usd: number
  hit_rate: number                 // Win rate (0-1)
  avg_win_usd: number
  avg_loss_usd: number
  ev_per_bet_mean: number
  resolved_bets: number
  win_loss_ratio: number           // avg_win / avg_loss
  total_volume_usd: number
}

export interface UseTopWalletsParams {
  window?: TimeWindow
  sortBy?: SortMetric
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
  minTrades?: number               // Minimum trades to qualify
  enabled?: boolean
}

export interface UseTopWalletsResult {
  data: WalletMetrics[]
  total: number
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useTopWallets(params: UseTopWalletsParams = {}): UseTopWalletsResult {
  const {
    window = 'lifetime',
    sortBy = 'omega',
    sortOrder = 'desc',
    limit = 50,
    offset = 0,
    minTrades = 10,
    enabled = true
  } = params

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['top-wallets', window, sortBy, sortOrder, limit, offset, minTrades],
    queryFn: async () => {
      // TODO: Replace with real API endpoint when ready
      const useMockData = false

      if (useMockData) {
        // Mock data for development
        await new Promise(resolve => setTimeout(resolve, 800)) // Simulate network delay

        const mockWallets: WalletMetrics[] = Array.from({ length: limit }, (_, i) => {
          const baseOmega = 3.5 - (i * 0.05)
          const basePnL = 50000 - (i * 1000)

          return {
            wallet_address: `0x${Math.random().toString(16).substr(2, 40)}`,
            window,
            omega_gross: baseOmega + 0.2,
            omega_net: baseOmega,
            net_pnl_usd: basePnL + (Math.random() * 5000 - 2500),
            hit_rate: 0.65 - (i * 0.003),
            avg_win_usd: 800 + Math.random() * 400,
            avg_loss_usd: 450 + Math.random() * 200,
            ev_per_bet_mean: 50 - (i * 2),
            resolved_bets: 100 + Math.floor(Math.random() * 500),
            win_loss_ratio: 1.8 - (i * 0.02),
            total_volume_usd: 100000 + Math.floor(Math.random() * 50000),
          }
        })

        // Sort by selected metric
        const sorted = mockWallets.sort((a, b) => {
          let aVal: number, bVal: number

          switch (sortBy) {
            case 'omega':
              aVal = a.omega_net
              bVal = b.omega_net
              break
            case 'pnl':
              aVal = a.net_pnl_usd
              bVal = b.net_pnl_usd
              break
            case 'win_rate':
              aVal = a.hit_rate
              bVal = b.hit_rate
              break
            case 'ev_per_bet':
              aVal = a.ev_per_bet_mean
              bVal = b.ev_per_bet_mean
              break
            case 'resolved_bets':
              aVal = a.resolved_bets
              bVal = b.resolved_bets
              break
            default:
              aVal = a.omega_net
              bVal = b.omega_net
          }

          return sortOrder === 'desc' ? bVal - aVal : aVal - bVal
        })

        return {
          wallets: sorted,
          total: 1000 + Math.floor(Math.random() * 500)  // Mock total count
        }
      }

      // Real API call (when endpoint is ready)
      const queryParams = new URLSearchParams({
        window,
        sortBy,
        sortOrder,
        limit: limit.toString(),
        offset: offset.toString(),
        minTrades: minTrades.toString(),
      })

      const response = await fetch(`/api/wallets/top?${queryParams}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch top wallets: ${response.status}`)
      }

      const result = await response.json()
      return result
    },
    enabled,
    staleTime: 60 * 1000,           // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  })

  return {
    data: data?.wallets || [],
    total: data?.total || 0,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
