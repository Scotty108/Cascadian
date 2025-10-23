/**
 * React Query Hook for Related Markets
 *
 * Fetches markets related to current market based on tags/category
 */

import { useQuery } from '@tanstack/react-query'

export interface RelatedMarket {
  id: string
  slug: string
  title: string
  description: string
  category: string
  marketCount: number
  volume: string
  volume24hr: string
  liquidity: string
  markets: any[]
}

export function useRelatedMarkets(params: {
  tags?: string[]
  category?: string
  excludeId?: string
  limit?: number
}) {
  const { tags = [], category = '', excludeId = '', limit = 6 } = params

  const { data, isLoading, error } = useQuery({
    queryKey: ['related-markets', tags, category, excludeId, limit],
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (tags.length > 0) searchParams.set('tags', tags.join(','))
      if (category) searchParams.set('category', category)
      if (excludeId) searchParams.set('excludeId', excludeId)
      searchParams.set('limit', limit.toString())

      const response = await fetch(`/api/polymarket/events/related?${searchParams}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch related markets: ${response.status}`)
      }

      return response.json()
    },
    enabled: tags.length > 0 || category.length > 0,
    staleTime: 10 * 60 * 1000, // 10 minutes
  })

  return {
    markets: data?.data || [],
    isLoading,
    error: error as Error | null,
  }
}
