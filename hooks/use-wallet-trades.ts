/**
 * React Query Hook for Wallet Trades
 *
 * Fetches trade history for a wallet
 */

import { useQuery } from '@tanstack/react-query'

export interface WalletTrade {
  trade_id?: string
  id?: string
  market_id?: string
  market?: string
  question?: string
  side?: string // 'YES' or 'NO'
  outcome?: string
  action?: string // 'BUY' or 'SELL'
  type?: string
  shares?: number
  size?: number
  price?: number
  amount?: number
  amount_usd?: number
  timestamp?: string
  created_at?: string
  tx_hash?: string
  // Add more fields as we discover the actual response structure
  [key: string]: any
}

export interface UseWalletTradesParams {
  walletAddress: string
  limit?: number
}

export interface UseWalletTradesResult {
  trades: WalletTrade[]
  totalTrades: number
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useWalletTrades(params: UseWalletTradesParams): UseWalletTradesResult {
  const { walletAddress, limit = 100 } = params

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['wallet-trades', walletAddress, limit],
    queryFn: async () => {
      if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new Error('Invalid wallet address')
      }

      const response = await fetch(
        `/api/polymarket/wallet/${walletAddress}/trades?limit=${limit}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch trades: ${response.status}`)
      }

      return response.json()
    },
    enabled: !!walletAddress && walletAddress.match(/^0x[a-fA-F0-9]{40}$/) !== null,
    staleTime: 60 * 1000, // 1 minute (historical data doesn't change often)
    refetchInterval: 60 * 1000, // Poll every minute
  })

  return {
    trades: data?.data || [],
    totalTrades: data?.count || 0,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
