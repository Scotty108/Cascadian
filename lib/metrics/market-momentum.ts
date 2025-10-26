/**
 * Market Momentum Calculation
 *
 * Tracks price momentum for YES/NO sides of markets.
 * Used by strategy builder to create triggers based on market movement.
 *
 * Austin's Requirements:
 * - Track momentum for the market itself (YES/NO price changes)
 * - Allow strategy builder nodes to trigger on momentum thresholds
 * - Example: "Trigger when YES momentum > 10% in 1 hour"
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface MarketMomentum {
  market_id: string
  title: string

  // Current prices
  yes_price: number
  no_price: number

  // Momentum calculations (% change)
  momentum_1h_yes: number | null
  momentum_1h_no: number | null
  momentum_24h_yes: number | null
  momentum_24h_no: number | null
  momentum_7d_yes: number | null
  momentum_7d_no: number | null

  // Directional signals
  yes_direction: 'up' | 'down' | 'stable'
  no_direction: 'up' | 'down' | 'stable'

  // Strength indicators
  momentum_strength: 'strong' | 'moderate' | 'weak'

  // Timestamp
  calculated_at: Date
}

export interface MomentumTrigger {
  market_id: string
  side: 'YES' | 'NO'
  threshold: number // e.g., 0.1 for 10%
  timeframe: '1h' | '24h' | '7d'
  direction: 'up' | 'down' | 'either'
}

/**
 * Calculate momentum (% price change) over a time period
 */
function calculateMomentum(currentPrice: number, previousPrice: number | null): number | null {
  if (previousPrice === null || previousPrice === 0) {
    return null
  }

  return (currentPrice - previousPrice) / previousPrice
}

/**
 * Determine direction based on momentum
 */
function getDirection(momentum: number | null): 'up' | 'down' | 'stable' {
  if (momentum === null) return 'stable'
  if (momentum > 0.02) return 'up' // >2% is "up"
  if (momentum < -0.02) return 'down' // <-2% is "down"
  return 'stable'
}

/**
 * Determine momentum strength
 */
function getMomentumStrength(momentum: number | null): 'strong' | 'moderate' | 'weak' {
  if (momentum === null) return 'weak'
  const absMomentum = Math.abs(momentum)

  if (absMomentum > 0.1) return 'strong' // >10%
  if (absMomentum > 0.05) return 'moderate' // >5%
  return 'weak'
}

interface PriceSnapshot {
  yes_price: number
  no_price: number
  timestamp: Date
}

interface PriceHistory {
  current: PriceSnapshot | null
  history_1h: PriceSnapshot | null
  history_24h: PriceSnapshot | null
  history_7d: PriceSnapshot | null
}

/**
 * Fetch current and historical prices for a market
 * Note: This assumes we have price history in the database
 * If not, we'll need to add a market_price_history table
 */
async function fetchMarketPriceHistory(marketId: string): Promise<PriceHistory> {
  // Fetch current market data
  const { data: market, error } = await supabase
    .from('markets')
    .select('market_id, title, yes_price, no_price, updated_at')
    .eq('market_id', marketId)
    .single()

  if (error || !market) {
    throw new Error(`Market ${marketId} not found`)
  }

  // TODO: Fetch historical prices from market_price_history table
  // For now, we'll return nulls for historical data
  // This table needs to be created to track price over time

  return {
    current: {
      yes_price: market.yes_price,
      no_price: market.no_price,
      timestamp: new Date(market.updated_at),
    },
    history_1h: null,
    history_24h: null,
    history_7d: null,
  }
}

/**
 * Calculate market momentum for YES/NO sides
 */
export async function calculateMarketMomentum(marketId: string): Promise<MarketMomentum | null> {
  try {
    const priceData = await fetchMarketPriceHistory(marketId)

    if (!priceData.current) {
      return null
    }

    // Fetch market info
    const { data: market } = await supabase
      .from('markets')
      .select('market_id, title, yes_price, no_price')
      .eq('market_id', marketId)
      .single()

    if (!market) return null

    const currentYesPrice = market.yes_price || 0.5
    const currentNoPrice = market.no_price || 0.5

    // Calculate momentum (will be null until we have price history)
    const momentum_1h_yes = calculateMomentum(currentYesPrice, priceData.history_1h?.yes_price || null)
    const momentum_1h_no = calculateMomentum(currentNoPrice, priceData.history_1h?.no_price || null)
    const momentum_24h_yes = calculateMomentum(currentYesPrice, priceData.history_24h?.yes_price || null)
    const momentum_24h_no = calculateMomentum(currentNoPrice, priceData.history_24h?.no_price || null)
    const momentum_7d_yes = calculateMomentum(currentYesPrice, priceData.history_7d?.yes_price || null)
    const momentum_7d_no = calculateMomentum(currentNoPrice, priceData.history_7d?.no_price || null)

    // Use 24h momentum for direction/strength if available, else use current prices
    const primaryMomentum = momentum_24h_yes !== null ? momentum_24h_yes : 0

    return {
      market_id: marketId,
      title: market.title,
      yes_price: currentYesPrice,
      no_price: currentNoPrice,
      momentum_1h_yes,
      momentum_1h_no,
      momentum_24h_yes,
      momentum_24h_no,
      momentum_7d_yes,
      momentum_7d_no,
      yes_direction: getDirection(momentum_24h_yes),
      no_direction: getDirection(momentum_24h_no),
      momentum_strength: getMomentumStrength(primaryMomentum),
      calculated_at: new Date(),
    }
  } catch (error) {
    console.error(`[Momentum] Failed to calculate for market ${marketId}:`, error)
    return null
  }
}

/**
 * Check if a market meets momentum trigger criteria
 * This is what the strategy builder will use
 */
export function checkMomentumTrigger(
  momentum: MarketMomentum,
  trigger: MomentumTrigger
): boolean {
  // Select the appropriate momentum value based on side and timeframe
  let momentumValue: number | null = null

  if (trigger.side === 'YES') {
    if (trigger.timeframe === '1h') momentumValue = momentum.momentum_1h_yes
    else if (trigger.timeframe === '24h') momentumValue = momentum.momentum_24h_yes
    else if (trigger.timeframe === '7d') momentumValue = momentum.momentum_7d_yes
  } else {
    if (trigger.timeframe === '1h') momentumValue = momentum.momentum_1h_no
    else if (trigger.timeframe === '24h') momentumValue = momentum.momentum_24h_no
    else if (trigger.timeframe === '7d') momentumValue = momentum.momentum_7d_no
  }

  if (momentumValue === null) return false

  // Check if momentum meets threshold
  if (trigger.direction === 'up') {
    return momentumValue >= trigger.threshold
  } else if (trigger.direction === 'down') {
    return momentumValue <= -trigger.threshold
  } else {
    // 'either' - check if absolute momentum exceeds threshold
    return Math.abs(momentumValue) >= trigger.threshold
  }
}

/**
 * Get markets with strong momentum (for discovery/screening)
 */
export async function getMarketsWithStrongMomentum(
  minMomentum: number = 0.1, // 10% default
  limit: number = 20
): Promise<MarketMomentum[]> {
  // Fetch active markets
  const { data: markets } = await supabase
    .from('markets')
    .select('market_id')
    .eq('active', true)
    .limit(100) // Check top 100 active markets

  if (!markets) return []

  // Calculate momentum for each
  const momentumResults = await Promise.all(
    markets.map((m) => calculateMarketMomentum(m.market_id))
  )

  // Filter for strong momentum
  const strongMomentum = momentumResults.filter((m): m is MarketMomentum => {
    if (!m) return false
    const yes24h = m.momentum_24h_yes || 0
    const no24h = m.momentum_24h_no || 0
    return Math.abs(yes24h) >= minMomentum || Math.abs(no24h) >= minMomentum
  })

  // Sort by strongest momentum
  strongMomentum.sort((a, b) => {
    const aMax = Math.max(Math.abs(a.momentum_24h_yes || 0), Math.abs(a.momentum_24h_no || 0))
    const bMax = Math.max(Math.abs(b.momentum_24h_yes || 0), Math.abs(b.momentum_24h_no || 0))
    return bMax - aMax
  })

  return strongMomentum.slice(0, limit)
}

/**
 * Strategy Builder Example Usage:
 *
 * const trigger: MomentumTrigger = {
 *   market_id: '123456',
 *   side: 'YES',
 *   threshold: 0.1,  // 10%
 *   timeframe: '1h',
 *   direction: 'up'
 * }
 *
 * const momentum = await calculateMarketMomentum('123456')
 * if (momentum && checkMomentumTrigger(momentum, trigger)) {
 *   // Execute strategy action
 *   console.log('Momentum trigger met! YES price up >10% in 1h')
 * }
 */

/**
 * Note: To make this fully functional, we need to:
 * 1. Create a market_price_history table in Supabase
 * 2. Run a cron job to snapshot prices every hour/day
 * 3. Store: market_id, timestamp, yes_price, no_price
 *
 * Migration SQL:
 *
 * CREATE TABLE market_price_history (
 *   id BIGSERIAL PRIMARY KEY,
 *   market_id TEXT NOT NULL,
 *   yes_price DECIMAL(10, 6),
 *   no_price DECIMAL(10, 6),
 *   timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   FOREIGN KEY (market_id) REFERENCES markets(market_id)
 * );
 *
 * CREATE INDEX idx_market_price_history_market_time
 *   ON market_price_history(market_id, timestamp DESC);
 */
