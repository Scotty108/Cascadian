/**
 * Market Subscription Interface
 *
 * Stub module for subscribing to live market signals.
 * These interfaces will be plugged into real-time data feeds later.
 *
 * Signals covered:
 * - Price ticks / spread changes
 * - Momentum (directional moves)
 * - Large trades from high-score wallets
 * - Time-to-resolution countdown
 * - News / rule changes (future)
 *
 * Status: STUB IMPLEMENTATION
 * All callbacks currently just log. Real-time feeds will be added later.
 */

export interface PriceMoveEvent {
  condition_id: string
  market_id: string
  newPriceYes: number
  newPriceNo: number
  spread: number
  depth: {
    bidSize: number
    askSize: number
  }
  timestamp: Date
}

export interface MomentumEvent {
  condition_id: string
  market_id: string
  side: 'YES' | 'NO'
  magnitude: number // Percentage move in short timeframe
  volumeSpike: boolean
  timestamp: Date
}

export interface HighScoreWalletFlowEvent {
  condition_id: string
  market_id: string
  wallet: string
  walletRank: number
  side: 'YES' | 'NO'
  size: number // USD value
  timestamp: Date
}

export interface ResolutionClockEvent {
  condition_id: string
  market_id: string
  secondsToClose: number
  timestamp: Date
}

export interface RuleChangeEvent {
  condition_id: string
  market_id: string
  changeType: 'text' | 'resolution_source' | 'end_date'
  oldValue: string
  newValue: string
  timestamp: Date
}

export interface MarketSubscriptionCallbacks {
  onPriceMove?: (event: PriceMoveEvent) => void
  onMomentumSpike?: (event: MomentumEvent) => void
  onHighScoreWalletFlow?: (event: HighScoreWalletFlowEvent) => void
  onResolutionClock?: (event: ResolutionClockEvent) => void
  onRuleChange?: (event: RuleChangeEvent) => void
}

/**
 * Subscribe to live market signals
 *
 * STUB: Currently just logs subscription. Will be replaced with:
 * - WebSocket connection to price feed
 * - Orderbook monitor
 * - Wallet flow tracker
 * - Resolution time monitor
 *
 * @param conditionId - Market condition to monitor
 * @param marketId - Market ID for metadata
 * @param callbacks - Event handlers
 * @returns Unsubscribe function
 */
export function subscribeToMarket(
  conditionId: string,
  marketId: string,
  callbacks: MarketSubscriptionCallbacks
): () => void {
  console.log(`[SUBSCRIPTION STUB] Subscribing to market ${conditionId} (${marketId})`)

  // Log which callbacks are active
  if (callbacks.onPriceMove) {
    console.log(`  ✓ onPriceMove callback registered`)
  }
  if (callbacks.onMomentumSpike) {
    console.log(`  ✓ onMomentumSpike callback registered`)
  }
  if (callbacks.onHighScoreWalletFlow) {
    console.log(`  ✓ onHighScoreWalletFlow callback registered`)
  }
  if (callbacks.onResolutionClock) {
    console.log(`  ✓ onResolutionClock callback registered`)
  }
  if (callbacks.onRuleChange) {
    console.log(`  ✓ onRuleChange callback registered`)
  }

  // TODO: Real implementation will:
  // 1. Connect to Polymarket WebSocket for price ticks
  // 2. Monitor orderbook depth changes
  // 3. Watch for trades from high conviction wallets
  // 4. Track time remaining until market closes
  // 5. Detect rule text changes via polling

  // Return unsubscribe function
  return () => {
    console.log(`[SUBSCRIPTION STUB] Unsubscribing from market ${conditionId}`)
  }
}

/**
 * Check if market has recent momentum
 *
 * STUB: Returns false until real data feed is connected.
 * Will query recent price history to detect directional moves.
 *
 * @param conditionId - Market to check
 * @param side - Side to check momentum for
 * @param thresholdPct - Minimum price move % to consider momentum
 * @returns true if momentum detected
 */
export function hasRecentMomentum(
  conditionId: string,
  side: 'YES' | 'NO',
  thresholdPct: number = 5
): boolean {
  console.log(
    `[MOMENTUM STUB] Checking momentum for ${conditionId} (side: ${side}, threshold: ${thresholdPct}%)`
  )

  // TODO: Query price history from:
  // - Polymarket API /markets/{id}/prices endpoint
  // - Calculate % change over last 1h, 6h, 24h
  // - Return true if any timeframe exceeds threshold

  return false
}

/**
 * Get seconds until market resolves
 *
 * STUB: Returns null until market metadata is loaded.
 * Will query market end_date from dimension tables.
 *
 * @param conditionId - Market to check
 * @returns Seconds until close, or null if unknown
 */
export function getSecondsToResolution(conditionId: string): number | null {
  console.log(`[RESOLUTION CLOCK STUB] Checking time remaining for ${conditionId}`)

  // TODO: Query markets_dim or Polymarket API for end_date
  // - Calculate: (end_date - now) in seconds
  // - Return null if market already resolved or end_date unknown

  return null
}
