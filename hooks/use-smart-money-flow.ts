/**
 * Hook to fetch smart money flow analysis for a market
 */

import { useState, useEffect } from 'react'
import type { SmartMoneyFlow } from '@/lib/smart-money-flow'

interface SmartMoneyFlowResponse {
  flow: SmartMoneyFlow | null
  recommendation: {
    action: 'STRONG_YES' | 'LEAN_YES' | 'NEUTRAL' | 'LEAN_NO' | 'STRONG_NO'
    reason: string
    confidence: 'high' | 'medium' | 'low'
  } | null
  isLoading: boolean
  error: Error | null
}

export function useSmartMoneyFlow(marketId: string | null): SmartMoneyFlowResponse {
  const [flow, setFlow] = useState<SmartMoneyFlow | null>(null)
  const [recommendation, setRecommendation] = useState<SmartMoneyFlowResponse['recommendation']>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!marketId) {
      setIsLoading(false)
      return
    }

    async function fetchSmartMoneyFlow() {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/polymarket/market/${marketId}/smart-money`)

        if (!response.ok) {
          throw new Error(`Failed to fetch smart money flow: ${response.statusText}`)
        }

        const data = await response.json()

        if (data.success && data.data) {
          setFlow(data.data)
          setRecommendation(data.data.recommendation || null)
        } else {
          throw new Error(data.error || 'Unknown error')
        }
      } catch (err) {
        console.error('Error fetching smart money flow:', err)
        setError(err instanceof Error ? err : new Error('Unknown error'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchSmartMoneyFlow()
  }, [marketId])

  return { flow, recommendation, isLoading, error }
}
