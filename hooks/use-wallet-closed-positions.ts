/**
 * React Query Hook for Wallet Closed Positions
 *
 * Fetches settled positions with realized PnL
 */

import { useQuery } from '@tanstack/react-query'

export interface WalletClosedPosition {
  position_id?: string
  id?: string
  market_id?: string
  market?: string
  question?: string
  side?: string
  outcome?: string
  size?: number
  shares?: number
  entryPrice?: number
  entry_price?: number
  exitPrice?: number
  exit_price?: number
  realizedPnL?: number
  realized_pnl?: number
  profit?: number
  opened_at?: string
  closed_at?: string
  // Add more fields as we discover the actual response structure
  [key: string]: any
}

export interface UseWalletClosedPositionsParams {
  walletAddress: string
  limit?: number
}

export interface UseWalletClosedPositionsResult {
  closedPositions: WalletClosedPosition[]
  totalRealizedPnL: number
  winRate: number
  totalClosed: number
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useWalletClosedPositions(
  params: UseWalletClosedPositionsParams
): UseWalletClosedPositionsResult {
  const { walletAddress, limit = 100 } = params

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['wallet-closed-positions', walletAddress, limit],
    queryFn: async () => {
      if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new Error('Invalid wallet address')
      }

      const response = await fetch(
        `/api/polymarket/wallet/${walletAddress}/closed-positions?limit=${limit}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch closed positions: ${response.status}`)
      }

      return response.json()
    },
    enabled: !!walletAddress && walletAddress.match(/^0x[a-fA-F0-9]{40}$/) !== null,
    staleTime: 5 * 60 * 1000, // 5 minutes (historical data)
  })

  const positions = data?.data || []

  // Calculate total realized PnL
  const totalRealizedPnL = positions.reduce((sum: number, pos: WalletClosedPosition) => {
    return sum + (pos.realizedPnL || pos.realized_pnl || pos.profit || 0)
  }, 0)

  // Calculate win rate
  const winners = positions.filter((pos: WalletClosedPosition) => {
    const pnl = pos.realizedPnL || pos.realized_pnl || pos.profit || 0
    return pnl > 0
  }).length

  const winRate = positions.length > 0 ? (winners / positions.length) * 100 : 0

  return {
    closedPositions: positions,
    totalRealizedPnL,
    winRate,
    totalClosed: data?.count || positions.length,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
