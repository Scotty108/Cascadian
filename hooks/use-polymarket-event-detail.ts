/**
 * React Query Hook for Polymarket Event Detail
 *
 * Fetches a single event by ID/slug from /api/polymarket/events/[id]
 */

import { useQuery } from '@tanstack/react-query'

export interface PolymarketEventDetail {
  id: string
  slug: string
  title: string
  description: string
  category: string
  isMultiOutcome: boolean
  marketCount: number
  volume: number
  volume24hr?: number
  liquidity: number
  liquidityClob?: number
  endDate: string
  startDate?: string
  createdAt?: string
  markets?: Array<{
    id: string
    question: string
    active: boolean
    closed: boolean
    outcomes: string[]
    outcomePrices: string
    clobTokenIds?: string
    conditionId?: string
    description?: string
    image?: string
    slug?: string
  }>
  tags?: Array<{
    id: string
    label: string
    slug: string
  }>
  enableOrderBook?: boolean
  restricted?: boolean
  archived?: boolean
}

export interface UsePolymarketEventDetailResult {
  event: PolymarketEventDetail | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function usePolymarketEventDetail(
  eventId: string
): UsePolymarketEventDetailResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['polymarket-event-detail', eventId],
    queryFn: async () => {
      const response = await fetch(`/api/polymarket/events/${eventId}`)

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Event not found')
        }
        throw new Error(`Failed to fetch event: ${response.status}`)
      }

      return response.json()
    },
    enabled: !!eventId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 1000, // Poll every 30 seconds
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  return {
    event: data?.data || null,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
