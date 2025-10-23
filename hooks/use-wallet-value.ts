/**
 * React Query Hook for Wallet Total Value
 *
 * Fetches total USDC value of wallet holdings
 */

import { useQuery } from '@tanstack/react-query'

export interface UseWalletValueResult {
  value: number
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useWalletValue(walletAddress: string): UseWalletValueResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['wallet-value', walletAddress],
    queryFn: async () => {
      if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new Error('Invalid wallet address')
      }

      const response = await fetch(`/api/polymarket/wallet/${walletAddress}/value`)

      if (!response.ok) {
        throw new Error(`Failed to fetch wallet value: ${response.status}`)
      }

      return response.json()
    },
    enabled: !!walletAddress && walletAddress.match(/^0x[a-fA-F0-9]{40}$/) !== null,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 30 * 1000, // Poll every 30 seconds for live portfolio value
  })

  // Extract value from response (handle different possible formats)
  let value = 0
  if (data?.data) {
    if (typeof data.data === 'number') {
      value = data.data
    } else if (typeof data.data === 'object' && data.data.value) {
      value = data.data.value
    } else if (typeof data.data === 'object' && data.data.total) {
      value = data.data.total
    }
  }

  return {
    value,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
