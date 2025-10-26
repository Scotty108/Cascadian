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
}

/**
 * Fetch all markets progressively with caching
 * Uses React Query to cache results across navigation
 */
export function useMarketInsights({ statusFilter }: UseMarketInsightsOptions) {
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 })

  const queryResult = useQuery({
    queryKey: ['market-insights', statusFilter],
    queryFn: async () => {
      const isActive = statusFilter === 'active'
      const allMarkets: Market[] = []
      const marketIdSet = new Set<string>() // Track unique market IDs
      let offset = 0
      const limit = 1000
      let hasMore = true
      let pageCount = 0
      const maxPages = 20
      let consecutiveErrors = 0
      const maxConsecutiveErrors = 3

      while (hasMore && pageCount < maxPages) {
        try {
          const response = await fetch(
            `/api/polymarket/markets?limit=${limit}&offset=${offset}&active=${isActive}`,
            { signal: AbortSignal.timeout(30000) }
          )

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Failed to fetch markets`)
          }

          const data = await response.json()

          if (data.success && data.data) {
            // Deduplicate markets
            const newMarkets = data.data.filter((m: Market) => {
              if (marketIdSet.has(m.market_id)) {
                return false
              }
              marketIdSet.add(m.market_id)
              return true
            })

            if (newMarkets.length > 0) {
              allMarkets.push(...newMarkets)
            }

            pageCount++
            consecutiveErrors = 0

            // Update progress
            setLoadingProgress({ current: allMarkets.length, total: data.total })

            console.log(`[Market Insights Cache] Page ${pageCount}: ${allMarkets.length}/${data.total} markets`)

            // Check if more to fetch
            hasMore = data.data.length === limit && allMarkets.length < data.total

            if (data.data.length < limit) {
              hasMore = false
            }

            offset += limit

            // Small delay between requests
            if (hasMore) {
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          } else {
            throw new Error(data.error || 'Failed to fetch markets')
          }
        } catch (fetchError) {
          consecutiveErrors++
          console.warn(`[Market Insights Cache] Page ${pageCount + 1} failed (error ${consecutiveErrors}/${maxConsecutiveErrors}):`, fetchError)

          // Skip failed pages if we have data
          const isTimeoutOr500 =
            fetchError instanceof Error &&
            (fetchError.message.includes('aborted') ||
             fetchError.message.includes('500') ||
             fetchError.message.includes('timeout'))

          if (allMarkets.length > 0 && isTimeoutOr500 && consecutiveErrors < maxConsecutiveErrors) {
            console.log(`[Market Insights Cache] Skipping page ${pageCount + 1}, continuing...`)
            offset += limit
            pageCount++ // Important: increment page count to avoid infinite loop
            consecutiveErrors = 0 // Reset error counter since we're skipping
            await new Promise(resolve => setTimeout(resolve, 1000))
            continue
          }

          // Stop after too many consecutive errors
          if (consecutiveErrors >= maxConsecutiveErrors) {
            console.log(`[Market Insights Cache] Stopping after ${consecutiveErrors} consecutive errors. Loaded ${allMarkets.length} markets.`)
            hasMore = false
          } else if (allMarkets.length === 0) {
            // If no data loaded yet, throw error
            throw fetchError
          } else {
            // Retry current page
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
      }

      console.log(`[Market Insights Cache] Complete: ${allMarkets.length} markets cached`)
      return allMarkets
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (matches backend sync)
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes after unmount
    refetchOnWindowFocus: false, // Don't refetch on tab switch
    refetchOnMount: false, // Don't refetch if data exists
    refetchOnReconnect: false,
  })

  return {
    ...queryResult,
    markets: queryResult.data || [],
    loadingProgress,
  }
}
