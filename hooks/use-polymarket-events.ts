/**
 * React Query Hook for Polymarket Events
 *
 * Fetches events from /api/polymarket/events with real-time updates
 */

import { useQuery } from '@tanstack/react-query'

export interface PolymarketEvent {
  id: string
  slug: string
  title: string
  description: string
  category: string
  isMultiOutcome: boolean
  marketCount: number
  volume: number
  liquidity: number
  endDate: string
  markets?: any[]
  tags?: any[]
}

export interface UsePolymarketEventsParams {
  limit?: number
  offset?: number
  closed?: boolean
}

export interface UsePolymarketEventsResult {
  events: PolymarketEvent[]
  total: number
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function usePolymarketEvents(
  params?: UsePolymarketEventsParams
): UsePolymarketEventsResult {
  const { limit = 100, offset = 0, closed = false } = params || {}

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['polymarket-events', { limit, offset, closed }],
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      searchParams.set('limit', limit.toString())
      searchParams.set('offset', offset.toString())
      searchParams.set('closed', closed.toString())

      const response = await fetch(`/api/polymarket/events?${searchParams}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch events: ${response.status}`)
      }

      return response.json()
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 1000, // Poll every 30 seconds
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  return {
    events: data?.data || [],
    total: data?.total || 0,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
