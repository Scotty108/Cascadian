/**
 * Whale Activity Hook - Position Change Tracking (Option 1)
 *
 * Tracks large position changes by comparing holder snapshots over time.
 * Detects when whales make significant moves without needing blockchain indexing.
 */

'use client'

import { useState, useEffect, useRef } from 'react'
import { useMarketHolders, MarketHolder } from './use-market-holders'

export interface WhaleActivity {
  wallet_address: string
  wallet_alias: string
  timestamp: string
  action: 'BUY' | 'SELL'
  side: 'YES' | 'NO'
  shares_change: number
  estimated_value: number
  current_position: number
  previous_position: number
}

export interface UseWhaleActivityPositionTrackingParams {
  conditionId?: string
  marketId?: string
  minTradeSize?: number // Minimum USD value to be considered a whale trade
  pollInterval?: number // How often to check for changes (ms)
}

export interface UseWhaleActivityPositionTrackingResult {
  activities: WhaleActivity[]
  isLoading: boolean
  error: Error | null
}

interface HolderSnapshot {
  timestamp: number
  holders: Map<string, { shares: number; side: 'YES' | 'NO'; alias: string }>
}

export function useWhaleActivityPositionTracking({
  conditionId,
  marketId,
  minTradeSize = 10000, // $10k minimum
  pollInterval = 30000, // 30 seconds
}: UseWhaleActivityPositionTrackingParams): UseWhaleActivityPositionTrackingResult {
  const [activities, setActivities] = useState<WhaleActivity[]>([])
  const previousSnapshot = useRef<HolderSnapshot | null>(null)

  // Fetch holder data
  const { data: holdersData, isLoading, error } = useMarketHolders({
    conditionId,
    marketId,
    limit: 100,
    minBalance: 1,
  })

  useEffect(() => {
    if (!holdersData || isLoading) return

    const currentTimestamp = Date.now()

    // Build current snapshot
    const currentSnapshot = new Map<string, { shares: number; side: 'YES' | 'NO'; alias: string }>()

    // Process all holders (YES and NO)
    const allHolders = [
      ...(holdersData.yes || []),
      ...(holdersData.no || [])
    ]

    allHolders.forEach((holder: MarketHolder) => {
      const address = holder.wallet_address || holder.address || holder.wallet || ''
      const alias = holder.wallet_alias || holder.alias || holder.nickname || address.slice(0, 8)
      const shares = holder.position_shares || holder.shares || holder.size || 0

      // Determine side with proper type narrowing
      let side: 'YES' | 'NO' = 'YES'
      if (holder.outcome_side === 'YES' || holder.outcome_side === 'NO') {
        side = holder.outcome_side
      } else if (holder.side === 'YES' || holder.side === 'NO') {
        side = holder.side
      } else {
        side = holdersData?.yes?.includes(holder) ? 'YES' : 'NO'
      }

      if (address && shares > 0) {
        currentSnapshot.set(address, { shares, side, alias })
      }
    })

    // Compare with previous snapshot to detect changes
    if (previousSnapshot.current) {
      const newActivities: WhaleActivity[] = []

      // Check each wallet in current snapshot
      currentSnapshot.forEach((current, address) => {
        const previous = previousSnapshot.current!.holders.get(address)

        if (previous) {
          // Wallet existed before - check for position change
          const sharesChange = current.shares - previous.shares
          const absChange = Math.abs(sharesChange)

          // Estimate USD value (assuming avg price of 0.50 for estimation)
          // In production, you'd use actual market price
          const estimatedValue = absChange * 0.50

          if (estimatedValue >= minTradeSize && sharesChange !== 0) {
            // Significant position change detected!
            newActivities.push({
              wallet_address: address,
              wallet_alias: current.alias,
              timestamp: new Date(currentTimestamp).toISOString(),
              action: sharesChange > 0 ? 'BUY' : 'SELL',
              side: current.side,
              shares_change: Math.abs(sharesChange),
              estimated_value: estimatedValue,
              current_position: current.shares,
              previous_position: previous.shares,
            })
          }
        } else {
          // New wallet - large initial position is a whale buy
          const estimatedValue = current.shares * 0.50

          if (estimatedValue >= minTradeSize) {
            newActivities.push({
              wallet_address: address,
              wallet_alias: current.alias,
              timestamp: new Date(currentTimestamp).toISOString(),
              action: 'BUY',
              side: current.side,
              shares_change: current.shares,
              estimated_value: estimatedValue,
              current_position: current.shares,
              previous_position: 0,
            })
          }
        }
      })

      // Check for wallets that exited completely
      previousSnapshot.current.holders.forEach((previous, address) => {
        if (!currentSnapshot.has(address)) {
          const estimatedValue = previous.shares * 0.50

          if (estimatedValue >= minTradeSize) {
            newActivities.push({
              wallet_address: address,
              wallet_alias: previous.alias,
              timestamp: new Date(currentTimestamp).toISOString(),
              action: 'SELL',
              side: previous.side,
              shares_change: previous.shares,
              estimated_value: estimatedValue,
              current_position: 0,
              previous_position: previous.shares,
            })
          }
        }
      })

      // Add new activities to the list (keep last 50)
      if (newActivities.length > 0) {
        setActivities(prev => [...newActivities, ...prev].slice(0, 50))
      }
    }

    // Update snapshot
    previousSnapshot.current = {
      timestamp: currentTimestamp,
      holders: currentSnapshot,
    }
  }, [holdersData, isLoading, minTradeSize])

  return {
    activities,
    isLoading,
    error: error || null,
  }
}
