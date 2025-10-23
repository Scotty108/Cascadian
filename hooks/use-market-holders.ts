/**
 * React Query Hook for Market Holders
 *
 * Fetches top holders for a specific market using Polymarket Data-API
 */

'use client'

import { useQuery } from '@tanstack/react-query'

export interface MarketHolder {
  address?: string
  wallet?: string
  wallet_address?: string
  alias?: string
  wallet_alias?: string
  nickname?: string
  size?: number
  shares?: number
  position_shares?: number
  position_size?: number
  value?: number
  percentage?: number
  percent_of_supply?: number
  outcome_index?: number
  outcome_side?: 'YES' | 'NO'
  side?: string
  profile_image?: string
  bio?: string
  display_username?: boolean
  token_id?: string
  // Add more fields as we discover the actual response structure
  [key: string]: any
}

export interface HoldersData {
  all: MarketHolder[]
  yes: MarketHolder[]
  no: MarketHolder[]
}

export interface UseMarketHoldersParams {
  marketId?: string // clobTokenId for Data-API
  conditionId?: string // Legacy support
  limit?: number
  minBalance?: number
}

export interface UseMarketHoldersResult {
  data: HoldersData | null
  holders: MarketHolder[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
  endpoint?: string // Which endpoint format worked
}

export function useMarketHolders(params: UseMarketHoldersParams): UseMarketHoldersResult {
  const { marketId, conditionId, limit = 100, minBalance = 1 } = params

  // Use marketId (clobTokenId) if provided, otherwise fall back to conditionId
  const id = marketId || conditionId

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['market-holders', id, limit, minBalance],
    queryFn: async () => {
      if (!id) {
        return {
          success: false,
          data: [],
          count: 0
        }
      }

      // Try new Data-API endpoint first
      if (marketId) {
        const response = await fetch(`/api/polymarket/market/${marketId}/holders?limit=${limit}`)

        if (response.ok) {
          return response.json()
        }
      }

      // Fall back to legacy endpoint if using conditionId
      if (conditionId) {
        const searchParams = new URLSearchParams()
        searchParams.set('conditionId', conditionId)
        searchParams.set('limit', limit.toString())
        searchParams.set('minBalance', minBalance.toString())

        const response = await fetch(`/api/polymarket/holders?${searchParams}`)

        if (!response.ok) {
          // If holders not available, return empty arrays
          if (response.status === 404) {
            return {
              success: true,
              data: {
                all: [],
                yes: [],
                no: [],
              },
              count: 0
            }
          }
          throw new Error(`Failed to fetch holders: ${response.status}`)
        }
        return response.json()
      }

      return {
        success: true,
        data: [],
        count: 0
      }
    },
    enabled: !!id,
    staleTime: 2 * 60 * 1000, // 2 minutes - holders don't change that frequently
    refetchInterval: 60 * 1000, // Poll every 60 seconds
    retry: false, // Don't retry on 404 errors
  })

  // Handle both legacy and new response formats
  let holdersData: HoldersData = {
    all: [],
    yes: [],
    no: [],
  }

  if (data?.data) {
    if (Array.isArray(data.data)) {
      // New format: array of holders
      holdersData.all = data.data
      // Separate by side if available
      holdersData.yes = data.data.filter((h: MarketHolder) =>
        h.side === 'YES' || h.outcome_side === 'YES'
      )
      holdersData.no = data.data.filter((h: MarketHolder) =>
        h.side === 'NO' || h.outcome_side === 'NO'
      )
    } else if (data.data.all) {
      // Legacy format: object with all/yes/no
      holdersData = data.data
    }
  }

  return {
    data: holdersData,
    holders: holdersData.all,
    isLoading,
    error: error as Error | null,
    refetch,
    endpoint: data?.endpoint, // Log which endpoint worked
  }
}
