/**
 * Escalation Logic
 *
 * Determines when a watchlist market should escalate to trade-ready status.
 *
 * Escalation levels:
 * - STAY_WATCHING: Normal monitoring (no action)
 * - ALERT_ONLY: Interesting but not ready (send notification)
 * - READY_TO_TRADE: All conditions met (prepare order)
 *
 * Current rule (hardcoded for MVP):
 * - High conviction wallet involvement + momentum event = READY_TO_TRADE
 * - Only one of the above = ALERT_ONLY
 * - Neither = STAY_WATCHING
 */

import { isHighConvictionWallet } from './high-conviction-wallets'
import { hasRecentMomentum } from './market-subscription'

export type EscalationLevel = 'STAY_WATCHING' | 'ALERT_ONLY' | 'READY_TO_TRADE'

export interface EscalationResult {
  level: EscalationLevel
  reason: string
  metadata: {
    hasHighConvictionWallet: boolean
    hasMomentum: boolean
    walletInvolved?: string
    momentumSide?: 'YES' | 'NO'
  }
}

/**
 * Evaluate escalation level for a watchlist market
 *
 * @param strategyId - Strategy evaluating this market
 * @param conditionId - Market condition ID
 * @param marketId - Market ID for lookups
 * @param context - Additional context
 * @returns Escalation result with level and reason
 *
 * Usage in executor:
 * ```
 * const result = evaluateEscalation(strategyId, conditionId, marketId, {
 *   recentWallets: ['0xabc...'],
 *   preferredSide: 'NO'
 * })
 *
 * if (result.level === 'READY_TO_TRADE') {
 *   // TODO: Size position and prepare order
 * }
 * ```
 */
export function evaluateEscalation(
  strategyId: string,
  conditionId: string,
  marketId: string,
  context: {
    recentWallets?: string[] // Wallets that recently traded this market
    preferredSide?: 'YES' | 'NO' // Side strategy prefers
    timeToResolution?: number // Seconds until market closes
  } = {}
): EscalationResult {
  // Check for high conviction wallet involvement
  const hasHighConvictionWallet = context.recentWallets?.some((wallet) =>
    isHighConvictionWallet(wallet)
  ) || false

  const walletInvolved = context.recentWallets?.find((wallet) =>
    isHighConvictionWallet(wallet)
  )

  // Check for momentum (stub returns false until real feed)
  const hasMomentum = hasRecentMomentum(
    conditionId,
    context.preferredSide || 'NO',
    5 // 5% threshold
  )

  // Escalation decision tree
  if (hasHighConvictionWallet && hasMomentum) {
    return {
      level: 'READY_TO_TRADE',
      reason: 'High conviction wallet + momentum event detected',
      metadata: {
        hasHighConvictionWallet: true,
        hasMomentum: true,
        walletInvolved,
        momentumSide: context.preferredSide,
      },
    }
  }

  if (hasHighConvictionWallet || hasMomentum) {
    return {
      level: 'ALERT_ONLY',
      reason: hasHighConvictionWallet
        ? 'High conviction wallet detected (waiting for momentum)'
        : 'Momentum detected (waiting for high conviction wallet)',
      metadata: {
        hasHighConvictionWallet,
        hasMomentum,
        walletInvolved: hasHighConvictionWallet ? walletInvolved : undefined,
        momentumSide: hasMomentum ? context.preferredSide : undefined,
      },
    }
  }

  return {
    level: 'STAY_WATCHING',
    reason: 'Normal monitoring (no escalation triggers)',
    metadata: {
      hasHighConvictionWallet: false,
      hasMomentum: false,
    },
  }
}

/**
 * Placeholder for future order sizing logic
 *
 * TODO: Implement order sizing based on:
 * - Max % of bankroll (e.g. 5% per trade)
 * - Kelly criterion for position size
 * - Current exposure across all positions
 * - Market liquidity (from orderbook depth)
 *
 * @param strategyId - Strategy placing order
 * @param marketId - Market to size
 * @param bankrollUsd - Total available capital
 * @returns Order size in USD
 */
export function calculateOrderSize(
  strategyId: string,
  marketId: string,
  bankrollUsd: number
): number {
  // TODO: Implement sizing logic
  // For now, return 0 to block accidental orders
  return 0
}

/**
 * Placeholder for order placement intent
 *
 * TODO: This is where actual order placement will live:
 * - Pick size based on calculateOrderSize()
 * - Place limit orders only (never market orders for strategy)
 * - Record intent in database before placing
 * - Wait for fill confirmation
 * - Update strategy state
 *
 * @param strategyId - Strategy placing order
 * @param marketId - Market to trade
 * @param side - YES or NO
 * @param sizeUsd - Order size in USD
 * @returns Order ID or error
 */
export async function placeStrategyOrder(
  strategyId: string,
  marketId: string,
  side: 'YES' | 'NO',
  sizeUsd: number
): Promise<{ success: false; error: string }> {
  // TODO: Implement order placement
  // 1. Validate strategy has sufficient balance
  // 2. Calculate limit price (never market orders)
  // 3. Record intent: INSERT INTO strategy_trade_intents
  // 4. Place order via trading module
  // 5. Wait for fill or timeout
  // 6. Update intent status
  // 7. Return result

  return {
    success: false,
    error: 'Order placement not yet implemented - placeholder only',
  }
}
