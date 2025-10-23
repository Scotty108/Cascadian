/**
 * React Query Hook for Wallet Positions
 *
 * Fetches current open positions for a wallet with PnL data
 */

import { useQuery } from '@tanstack/react-query'

export interface WalletPosition {
  market_id?: string
  market?: string
  question?: string
  side?: string
  outcome?: string
  size?: number
  shares?: number
  entryPrice?: number
  entry_price?: number
  currentPrice?: number
  current_price?: number
  unrealizedPnL?: number
  unrealized_pnl?: number
  value?: number
  // Add more fields as we discover the actual response structure
  [key: string]: any
}

export interface UseWalletPositionsResult {
  positions: WalletPosition[]
  totalValue: number
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useWalletPositions(walletAddress: string): UseWalletPositionsResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['wallet-positions', walletAddress],
    queryFn: async () => {
      if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new Error('Invalid wallet address')
      }

      const response = await fetch(`/api/polymarket/wallet/${walletAddress}/positions`)

      if (!response.ok) {
        throw new Error(`Failed to fetch positions: ${response.status}`)
      }

      return response.json()
    },
    enabled: !!walletAddress && walletAddress.match(/^0x[a-fA-F0-9]{40}$/) !== null,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 30 * 1000, // Poll every 30 seconds for live updates
  })

  // Calculate total value from positions
  const totalValue = (data?.data || []).reduce((sum: number, pos: WalletPosition) => {
    return sum + (pos.value || pos.unrealizedPnL || pos.unrealized_pnl || 0)
  }, 0)

  return {
    positions: data?.data || [],
    totalValue,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
