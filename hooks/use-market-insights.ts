'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useCallback } from 'react'

interface Market {
  market_id: string
  title: string
  description: string
  category: string
  current_price: number
  volume_24h: number
  volume_total: number
  liquidity: number
  active: boolean
  closed: boolean
  end_date: string
  outcomes: string[]
  slug: string
  image_url?: string
  created_at: string
  updated_at: string
  event_id?: string
  event_slug?: string
  event_title?: string
  raw_data?: {
    event_id?: string
    event_title?: string
    event_slug?: string
    icon?: string
    [key: string]: any
  }
}

interface UseMarketInsightsOptions {
  statusFilter: 'active' | 'closed'
  limit?: number
  offset?: number
}

/**
 * Fetch markets with pagination and caching
 * Uses React Query to cache results across navigation
 * Data source: ClickHouse (pm_market_metadata)
 */
export function useMarketInsights({ statusFilter, limit = 1000, offset = 0 }: UseMarketInsightsOptions) {
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 })

  const queryResult = useQuery({
    queryKey: ['market-insights', statusFilter, limit, offset],
    queryFn: async () => {
      const isActive = statusFilter === 'active'

      try {
        // Use new ClickHouse-backed API
        const response = await fetch(
          `/api/markets?limit=${limit}&offset=${offset}&active=${isActive}`,
          { signal: AbortSignal.timeout(30000) }
        )

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to fetch markets`)
        }

        const data = await response.json()

        if (data.success && data.data) {
          // Update progress
          setLoadingProgress({ current: data.data.length, total: data.total })

          console.log(`[Market Insights] Loaded ${data.data.length} markets from ClickHouse (${offset}-${offset + data.data.length} of ${data.total})`)

          return {
            markets: data.data,
            total: data.total,
            page: data.page,
            limit: data.limit,
          }
        } else {
          throw new Error(data.error || 'Failed to fetch markets')
        }
      } catch (fetchError) {
        console.warn(`[Market Insights] Failed to fetch:`, fetchError)
        throw fetchError
      }
    },
    staleTime: 10 * 60 * 1000, // 10 minutes - data doesn't change often
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes after unmount
    refetchOnWindowFocus: false, // Don't refetch on tab switch
    refetchOnMount: false, // Don't refetch if data exists
    refetchOnReconnect: false,
    placeholderData: (prev: any) => prev, // Smooth pagination
    structuralSharing: false, // Faster for large arrays
  })

  return {
    ...queryResult,
    markets: queryResult.data?.markets || [],
    total: queryResult.data?.total || 0,
    page: queryResult.data?.page || 1,
    limit: queryResult.data?.limit || limit,
    loadingProgress,
  }
}
