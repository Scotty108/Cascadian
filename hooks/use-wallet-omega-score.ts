/**
 * React Query Hook for Wallet Omega Score
 *
 * Fetches wallet performance metrics using Omega ratio
 */

import { useQuery } from '@tanstack/react-query'

export interface WalletOmegaScore {
  wallet_address: string
  omega_ratio: number
  omega_momentum: number
  total_positions: number
  closed_positions: number
  total_pnl: number
  total_gains: number
  total_losses: number
  win_rate: number
  avg_gain: number
  avg_loss: number
  momentum_direction: 'improving' | 'declining' | 'stable'
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F'
  meets_minimum_trades: boolean
  calculated_at: string
}

export interface UseWalletOmegaScoreParams {
  walletAddress: string
  fresh?: boolean
}

export interface UseWalletOmegaScoreResult {
  data: WalletOmegaScore | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useWalletOmegaScore(params: UseWalletOmegaScoreParams): UseWalletOmegaScoreResult {
  const { walletAddress, fresh = false } = params

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['wallet-omega-score', walletAddress, fresh],
    queryFn: async () => {
      if (!walletAddress) {
        return null
      }

      const response = await fetch(
        `/api/wallets/${walletAddress}/score${fresh ? '?fresh=true' : ''}`
      )

      if (!response.ok) {
        if (response.status === 404) {
          // Wallet not scored yet
          return null
        }
        throw new Error(`Failed to fetch Omega score: ${response.status}`)
      }

      const result = await response.json()
      return result
    },
    enabled: !!walletAddress,
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
