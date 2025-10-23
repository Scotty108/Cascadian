/**
 * React Query Hook for Wallet Activity
 *
 * Fetches user activity log/timeline
 */

import { useQuery } from '@tanstack/react-query'

export interface WalletActivityItem {
  activity_id?: string
  id?: string
  type?: string
  action?: string
  market_id?: string
  market?: string
  question?: string
  details?: string
  description?: string
  timestamp?: string
  created_at?: string
  // Add more fields as we discover the actual response structure
  [key: string]: any
}

export interface UseWalletActivityParams {
  walletAddress: string
  limit?: number
}

export interface UseWalletActivityResult {
  activity: WalletActivityItem[]
  totalActivity: number
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useWalletActivity(params: UseWalletActivityParams): UseWalletActivityResult {
  const { walletAddress, limit = 50 } = params

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['wallet-activity', walletAddress, limit],
    queryFn: async () => {
      if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new Error('Invalid wallet address')
      }

      const response = await fetch(
        `/api/polymarket/wallet/${walletAddress}/activity?limit=${limit}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch activity: ${response.status}`)
      }

      return response.json()
    },
    enabled: !!walletAddress && walletAddress.match(/^0x[a-fA-F0-9]{40}$/) !== null,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 60 * 1000, // Poll every minute
  })

  return {
    activity: data?.data || [],
    totalActivity: data?.count || 0,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
