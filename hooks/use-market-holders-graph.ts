/**
 * React Query Hook for Market Holders via The Graph
 *
 * Fetches ALL holders (unlimited) using The Graph's Polymarket PnL subgraph.
 * This bypasses Polymarket Data API's ~20 holder limit.
 */

'use client'

import { useQuery } from '@tanstack/react-query'

export interface GraphHolder {
  wallet_address: string
  wallet_alias: string
  position_shares: number
  avg_entry_price: number
  realized_pnl: number
  total_bought: number
  unrealized_pnl: number
  token_id: string
}

export interface UseMarketHoldersGraphParams {
  yesTokenId?: string
  noTokenId?: string
  limit?: number
  minBalance?: number
  enabled?: boolean
}

export interface UseMarketHoldersGraphResult {
  data: {
    all: GraphHolder[]
    yes: GraphHolder[]
    no: GraphHolder[]
  } | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useMarketHoldersGraph({
  yesTokenId,
  noTokenId,
  limit = 1000,
  minBalance = 1,
  enabled = true,
}: UseMarketHoldersGraphParams): UseMarketHoldersGraphResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['market-holders-graph', yesTokenId, noTokenId, limit, minBalance],
    queryFn: async () => {
      const allHolders: GraphHolder[] = []

      // Fetch YES holders
      if (yesTokenId) {
        const yesResponse = await fetch(
          `/api/polymarket/holders-graph/${yesTokenId}?limit=${limit}&minBalance=${minBalance}`
        )

        if (yesResponse.ok) {
          const yesData = await yesResponse.json()
          if (yesData.success) {
            allHolders.push(
              ...yesData.data.map((holder: GraphHolder) => ({
                ...holder,
                outcome_side: 'YES' as const,
              }))
            )
          }
        }
      }

      // Fetch NO holders
      if (noTokenId) {
        const noResponse = await fetch(
          `/api/polymarket/holders-graph/${noTokenId}?limit=${limit}&minBalance=${minBalance}`
        )

        if (noResponse.ok) {
          const noData = await noResponse.json()
          if (noData.success) {
            allHolders.push(
              ...noData.data.map((holder: GraphHolder) => ({
                ...holder,
                outcome_side: 'NO' as const,
              }))
            )
          }
        }
      }

      // Separate by side
      const yesHolders = allHolders.filter((h: any) => h.outcome_side === 'YES')
      const noHolders = allHolders.filter((h: any) => h.outcome_side === 'NO')

      return {
        all: allHolders,
        yes: yesHolders,
        no: noHolders,
      }
    },
    enabled: enabled && (!!yesTokenId || !!noTokenId),
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 60 * 1000, // Refresh every 60 seconds
    retry: false,
  })

  return {
    data: data || null,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
