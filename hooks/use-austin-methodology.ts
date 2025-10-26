/**
 * React Hook for Austin Methodology
 *
 * Easy integration with React components for category analysis
 */

import { useState, useEffect, useCallback } from 'react'
import type { CategoryAnalysis } from '@/lib/metrics/austin-methodology'

interface UseAustinMethodologyOptions {
  window?: '24h' | '7d' | '30d' | 'lifetime'
  limit?: number
  autoFetch?: boolean
}

interface UseAustinMethodologyResult {
  categories: CategoryAnalysis[]
  winnableCategories: CategoryAnalysis[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Hook to fetch and manage category analysis
 */
export function useAustinMethodology(
  options: UseAustinMethodologyOptions = {}
): UseAustinMethodologyResult {
  const { window = '30d', limit = 20, autoFetch = true } = options

  const [categories, setCategories] = useState<CategoryAnalysis[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCategories = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // TODO: Toggle this to false when ClickHouse has data
      const useMockData = false

      if (useMockData) {
        // Mock data for development
        await new Promise(resolve => setTimeout(resolve, 800)) // Simulate network delay

        const mockCategories: CategoryAnalysis[] = [
          {
            category: 'Politics',
            categoryRank: 1,
            eliteWalletCount: 342,
            medianOmegaOfElites: 3.2,
            meanCLVOfElites: 0.045,
            avgEVPerHour: 18.5,
            totalVolumeUsd: 2500000,
            avgMarketLiquidity: 125000,
            activeMarketCount: 45,
            topMarkets: [
              { marketId: '0x1', question: 'Will Trump win 2024?', volume24h: 450000, liquidity: 225000, eliteParticipation: 0.65, avgEliteOmega: 3.5 },
              { marketId: '0x2', question: 'Biden approval > 45%?', volume24h: 320000, liquidity: 180000, eliteParticipation: 0.58, avgEliteOmega: 3.2 },
            ],
            topSpecialists: [],
            isWinnableGame: true,
            winnabilityScore: 92,
            calculatedAt: new Date(),
          },
          {
            category: 'Sports',
            categoryRank: 2,
            eliteWalletCount: 218,
            medianOmegaOfElites: 2.8,
            meanCLVOfElites: 0.038,
            avgEVPerHour: 14.2,
            totalVolumeUsd: 1800000,
            avgMarketLiquidity: 95000,
            activeMarketCount: 67,
            topMarkets: [],
            topSpecialists: [],
            isWinnableGame: true,
            winnabilityScore: 85,
            calculatedAt: new Date(),
          },
          {
            category: 'Crypto',
            categoryRank: 3,
            eliteWalletCount: 156,
            medianOmegaOfElites: 2.4,
            meanCLVOfElites: 0.032,
            avgEVPerHour: 11.8,
            totalVolumeUsd: 1200000,
            avgMarketLiquidity: 75000,
            activeMarketCount: 89,
            topMarkets: [],
            topSpecialists: [],
            isWinnableGame: true,
            winnabilityScore: 76,
            calculatedAt: new Date(),
          },
          {
            category: 'Business',
            categoryRank: 4,
            eliteWalletCount: 89,
            medianOmegaOfElites: 2.1,
            meanCLVOfElites: 0.025,
            avgEVPerHour: 9.5,
            totalVolumeUsd: 650000,
            avgMarketLiquidity: 45000,
            activeMarketCount: 34,
            topMarkets: [],
            topSpecialists: [],
            isWinnableGame: false,
            winnabilityScore: 68,
            calculatedAt: new Date(),
          },
          {
            category: 'Entertainment',
            categoryRank: 5,
            eliteWalletCount: 67,
            medianOmegaOfElites: 1.9,
            meanCLVOfElites: 0.019,
            avgEVPerHour: 7.2,
            totalVolumeUsd: 420000,
            avgMarketLiquidity: 32000,
            activeMarketCount: 56,
            topMarkets: [],
            topSpecialists: [],
            isWinnableGame: false,
            winnabilityScore: 55,
            calculatedAt: new Date(),
          },
        ]

        setCategories(mockCategories)
        return
      }

      // Real API call
      const response = await fetch(
        `/api/austin/categories?window=${window}&limit=${limit}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch categories: ${response.statusText}`)
      }

      const data = await response.json()
      setCategories(data.categories || [])
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      console.error('[useAustinMethodology] Error:', err)
    } finally {
      setLoading(false)
    }
  }, [window, limit])

  useEffect(() => {
    if (autoFetch) {
      fetchCategories()
    }
  }, [autoFetch, fetchCategories])

  const winnableCategories = categories.filter((c) => c.isWinnableGame)

  return {
    categories,
    winnableCategories,
    loading,
    error,
    refresh: fetchCategories,
  }
}

/**
 * Hook to fetch specific category analysis
 */
export function useCategoryAnalysis(
  category: string | null,
  options: {
    window?: '24h' | '7d' | '30d' | 'lifetime'
    includeMarkets?: boolean
    includeSpecialists?: boolean
  } = {}
) {
  const {
    window = '30d',
    includeMarkets = true,
    includeSpecialists = true,
  } = options

  const [analysis, setAnalysis] = useState<CategoryAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalysis = useCallback(async () => {
    if (!category) {
      setAnalysis(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        window,
        includeMarkets: includeMarkets.toString(),
        includeSpecialists: includeSpecialists.toString(),
      })

      const response = await fetch(
        `/api/austin/categories/${encodeURIComponent(category)}?${params}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch category: ${response.statusText}`)
      }

      const data = await response.json()
      setAnalysis(data.analysis || null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      console.error('[useCategoryAnalysis] Error:', err)
    } finally {
      setLoading(false)
    }
  }, [category, window, includeMarkets, includeSpecialists])

  useEffect(() => {
    fetchAnalysis()
  }, [fetchAnalysis])

  return {
    analysis,
    loading,
    error,
    refresh: fetchAnalysis,
  }
}

/**
 * Hook to get category recommendation
 */
export function useCategoryRecommendation(preferredCategories?: string[]) {
  const [recommendation, setRecommendation] = useState<CategoryAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRecommendation = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (preferredCategories && preferredCategories.length > 0) {
        params.set('preferred', preferredCategories.join(','))
      }

      const response = await fetch(`/api/austin/recommend?${params}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch recommendation: ${response.statusText}`)
      }

      const data = await response.json()
      setRecommendation(data.recommendation || null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      console.error('[useCategoryRecommendation] Error:', err)
    } finally {
      setLoading(false)
    }
  }, [preferredCategories])

  useEffect(() => {
    fetchRecommendation()
  }, [fetchRecommendation])

  return {
    recommendation,
    loading,
    error,
    refresh: fetchRecommendation,
  }
}
