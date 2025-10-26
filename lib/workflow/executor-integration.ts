/**
 * Executor Integration Layer
 *
 * Wires audited P&L, live signals, and escalation into the workflow executor.
 * This module extends the base executor with high conviction wallet monitoring
 * and escalation logic.
 *
 * Usage: Import these functions in the executor startup/execution flow
 */

import type { ExecutionContext } from '@/types/workflow'
import { getHighConvictionWallets } from '@/lib/strategy/high-conviction-wallets'
import {
  subscribeToMarket,
  hasRecentMomentum,
  type MarketSubscriptionCallbacks,
} from '@/lib/strategy/market-subscription'
import { evaluateEscalation, type EscalationLevel } from '@/lib/strategy/escalation'
import { addToWatchlist, updateWatchlistStatus, type WatchlistEntry } from '@/lib/strategy/watchlist-store'
import { createClient } from '@supabase/supabase-js'

/**
 * Enhanced execution context with strategy runtime state
 */
export interface EnhancedExecutionContext extends ExecutionContext {
  // High conviction wallets loaded at startup
  highConvictionWallets?: Array<{
    wallet: string
    realizedPnlUsd: number
    coveragePct: number
    rank: number
  }>

  // Market subscriptions (for cleanup)
  marketSubscriptions?: Map<string, () => void>

  // Strategy ID for database updates
  strategyId?: string
}

/**
 * Initialize strategy runtime
 *
 * Call this when a strategy starts. Loads high conviction wallets
 * and prepares runtime state.
 *
 * @param strategyId - Strategy being started
 * @param context - Execution context to enhance
 * @returns Enhanced context with high conviction wallets
 */
export function initializeStrategyRuntime(
  strategyId: string,
  context: ExecutionContext
): EnhancedExecutionContext {
  console.log(`[Strategy Runtime] Initializing runtime for strategy ${strategyId}`)

  // Load high conviction wallets from audited P&L
  const highConvictionWallets = getHighConvictionWallets()

  console.log(
    `[Strategy Runtime] Loaded ${highConvictionWallets.length} high conviction wallets (coverage ≥2%)`
  )

  // Log top 5 for verification
  if (highConvictionWallets.length > 0) {
    console.log('[Strategy Runtime] Top 5 wallets:')
    highConvictionWallets.slice(0, 5).forEach((w) => {
      console.log(
        `  [${w.rank}] ${w.wallet.substring(0, 10)}... - $${w.realizedPnlUsd.toFixed(2)} (${w.coveragePct.toFixed(2)}% coverage)`
      )
    })
  }

  return {
    ...context,
    strategyId,
    highConvictionWallets,
    marketSubscriptions: new Map(),
  }
}

/**
 * Add market to watchlist with live signal subscription
 *
 * Call this when a high conviction wallet trades a market.
 * Subscribes to live signals and evaluates escalation on events.
 *
 * @param context - Enhanced execution context
 * @param conditionId - Market condition ID
 * @param marketId - Market ID for metadata
 * @param metadata - Market metadata (category, question, etc.)
 * @param triggeredByWallet - Wallet that caused watchlist add
 */
export function addMarketToWatchlist(
  context: EnhancedExecutionContext,
  conditionId: string,
  marketId: string,
  metadata: {
    category?: string
    tags?: string[]
    question?: string
  },
  triggeredByWallet?: string
): void {
  if (!context.strategyId) {
    console.warn('[Strategy Runtime] Cannot add to watchlist: no strategyId in context')
    return
  }

  console.log(`[Strategy Runtime] Adding ${conditionId} to watchlist (triggered by ${triggeredByWallet || 'system'})`)

  // Create watchlist entry
  const entry: WatchlistEntry = {
    condition_id: conditionId,
    market_id: marketId,
    event_id: '', // Will be enriched from dimension tables
    category: metadata.category || 'unknown',
    tags: metadata.tags || [],
    question: metadata.question || 'Unknown market',
    side: 'NO', // Default strategy preference
    reason: triggeredByWallet ? 'smart-flow' : 'system',
    strategyId: context.strategyId,
    status: 'watching',
    addedAt: new Date(),
    updatedAt: new Date(),
    insiderSuspect: false,
    triggeredByWallet,
  }

  // Add to persistent watchlist store
  addToWatchlist(entry)

  // Subscribe to live market signals
  const unsubscribe = subscribeToMarket(conditionId, marketId, {
    onMomentumSpike: (event) => {
      console.log(
        `[Strategy Runtime] Momentum spike on ${conditionId}: ${event.side} ${event.magnitude}%`
      )

      // Evaluate escalation
      const result = evaluateEscalation(context.strategyId!, conditionId, marketId, {
        recentWallets: triggeredByWallet ? [triggeredByWallet] : [],
        preferredSide: event.side,
      })

      handleEscalationResult(context, conditionId, marketId, result)
    },

    onHighScoreWalletFlow: (event) => {
      console.log(
        `[Strategy Runtime] High conviction wallet flow on ${conditionId}: ${event.wallet} (rank ${event.walletRank}) - ${event.side} $${event.size}`
      )

      // Evaluate escalation
      const result = evaluateEscalation(context.strategyId!, conditionId, marketId, {
        recentWallets: [event.wallet],
        preferredSide: event.side,
      })

      handleEscalationResult(context, conditionId, marketId, result)
    },

    onPriceMove: (event) => {
      // Just log for now - can add price-based triggers later
      console.log(
        `[Strategy Runtime] Price update on ${conditionId}: YES ${event.newPriceYes} / NO ${event.newPriceNo}`
      )
    },

    onResolutionClock: (event) => {
      if (event.secondsToClose <= 12 * 60 * 60) {
        // Less than 12 hours
        console.log(
          `[Strategy Runtime] Resolution clock: ${conditionId} closes in ${Math.floor(event.secondsToClose / 3600)}h`
        )
      }
    },
  })

  // Store unsubscribe function for cleanup
  context.marketSubscriptions?.set(conditionId, unsubscribe)

  console.log(`[Strategy Runtime] Subscribed to signals for ${conditionId}`)
}

/**
 * Handle escalation result
 *
 * Internal function to process escalation decisions.
 * Updates watchlist status and sends notifications.
 *
 * @param context - Enhanced execution context
 * @param conditionId - Market condition ID
 * @param marketId - Market ID
 * @param result - Escalation evaluation result
 */
async function handleEscalationResult(
  context: EnhancedExecutionContext,
  conditionId: string,
  marketId: string,
  result: {
    level: EscalationLevel
    reason: string
    metadata: any
  }
): Promise<void> {
  if (!context.strategyId) return

  console.log(`[Strategy Runtime] Escalation for ${conditionId}: ${result.level} - ${result.reason}`)

  switch (result.level) {
    case 'READY_TO_TRADE':
      // Update watchlist status
      updateWatchlistStatus(context.strategyId, conditionId, 'escalate_candidate')

      // Send high priority notification
      await sendEscalationNotification(
        context.strategyId,
        conditionId,
        marketId,
        'ready_to_trade',
        result.reason
      )

      // TODO: Call order sizing and placement
      console.log(`[Strategy Runtime] 🚨 READY_TO_TRADE: ${conditionId}`)
      console.log(`[Strategy Runtime] TODO: Calculate order size and place limit order`)
      console.log(`[Strategy Runtime] Metadata: ${JSON.stringify(result.metadata, null, 2)}`)
      break

    case 'ALERT_ONLY':
      // Send normal priority notification
      await sendEscalationNotification(
        context.strategyId,
        conditionId,
        marketId,
        'alert',
        result.reason
      )

      console.log(`[Strategy Runtime] ⚠️ ALERT: ${conditionId} - ${result.reason}`)
      break

    case 'STAY_WATCHING':
      // No action needed
      break
  }
}

/**
 * Send escalation notification
 *
 * Creates notification in database for dashboard display.
 *
 * @param strategyId - Strategy ID
 * @param conditionId - Market condition ID
 * @param marketId - Market ID
 * @param type - Notification type
 * @param reason - Escalation reason
 */
async function sendEscalationNotification(
  strategyId: string,
  conditionId: string,
  marketId: string,
  type: 'ready_to_trade' | 'alert',
  reason: string
): Promise<void> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Get strategy details for notification
    const { data: strategy } = await supabase
      .from('workflow_sessions')
      .select('name, user_id')
      .eq('id', strategyId)
      .single()

    if (!strategy) return

    const title =
      type === 'ready_to_trade'
        ? `🚨 Trade Signal: ${strategy.name || 'Strategy'}`
        : `⚠️ Market Alert: ${strategy.name || 'Strategy'}`

    const priority = type === 'ready_to_trade' ? 'high' : 'normal'

    await supabase.from('notifications').insert({
      user_id: strategy.user_id,
      workflow_id: strategyId,
      type: 'strategy_signal',
      title,
      message: reason,
      link: `/strategies/${strategyId}?market=${marketId}`,
      priority,
      metadata: {
        condition_id: conditionId,
        market_id: marketId,
        escalation_level: type,
      },
    })
  } catch (error) {
    console.error('[Strategy Runtime] Failed to send escalation notification:', error)
  }
}

/**
 * Cleanup strategy runtime
 *
 * Call this when a strategy stops. Unsubscribes from all markets
 * and cleans up resources.
 *
 * @param context - Enhanced execution context
 */
export function cleanupStrategyRuntime(context: EnhancedExecutionContext): void {
  if (!context.strategyId) return

  console.log(`[Strategy Runtime] Cleaning up runtime for strategy ${context.strategyId}`)

  // Unsubscribe from all market signals
  if (context.marketSubscriptions) {
    for (const [conditionId, unsubscribe] of context.marketSubscriptions) {
      console.log(`[Strategy Runtime] Unsubscribing from ${conditionId}`)
      unsubscribe()
    }
    context.marketSubscriptions.clear()
  }

  console.log(`[Strategy Runtime] Cleanup complete for strategy ${context.strategyId}`)
}
