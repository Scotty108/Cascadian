/**
 * Watchlist Auto-Population Service
 *
 * Automatically populates strategy watchlists when trusted wallets (coverage ≥2%)
 * open positions in allowed categories.
 *
 * Core Product Loop Step 3:
 * trusted wallets + escalation rules → watchlist entries
 *
 * Escalation Rules:
 * - Wallet must be in signal set (coverage ≥2%)
 * - Market must be in allowed category (from dimension tables, when available)
 * - Market must meet minimum thresholds (volume, liquidity)
 * - Deduplication: Don't add if already watching
 *
 * Future Enhancements (when dimension tables available):
 * - Category filtering (only add markets in allowed categories)
 * - Wallet performance by category (prefer top performers)
 * - Market quality score (from markets_dim_seed.json)
 *
 * KILL SWITCH:
 * - Requires AUTONOMOUS_TRADING_ENABLED=true to write to watchlists
 * - Default: false (safe for production)
 * - Set in .env.local
 */

import { createClient } from '@supabase/supabase-js'
import { isSignalWallet, getSignalWalletByAddress } from '@/lib/data/wallet-signal-set'
import * as fs from 'fs'
import { resolve } from 'path'
import { getCanonicalCategoryForEvent } from '@/lib/category/canonical-category'

/**
 * TypeScript interfaces for resolution data type safety
 */

/**
 * Individual resolution entry with all required fields
 */
export interface ResolutionEntry {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO' | null
  payout_yes: 0 | 1 | null
  payout_no: 0 | 1 | null
  resolved_at: string | null
}

/**
 * Complete resolution data structure with metadata and resolutions array
 */
export interface ResolutionData {
  total_conditions: number
  resolved_conditions: number
  last_updated: string
  resolutions: ResolutionEntry[]
}

/**
 * Normalized resolution outcome format for processing
 */
export interface NormalizedResolution {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO' | null
  payout_yes: 0 | 1 | null
  payout_no: 0 | 1 | null
}

/**
 * Environment variable configuration with safe defaults
 */
const DEFAULT_MARKET_ID = process.env.DEFAULT_MARKET_ID || '0x0000000000000000000000000000000000000000000000000000000000000000'
const DEFAULT_CONDITION_IDS = process.env.DEFAULT_CONDITION_IDS
  ? process.env.DEFAULT_CONDITION_IDS.split(',').map(id => id.trim())
  : []
const FALLBACK_WATCHLIST_SIZE = parseInt(process.env.FALLBACK_WATCHLIST_SIZE || '10', 10)

/**
 * Validate resolution data structure
 *
 * Checks:
 * - data.resolutions exists and is an array
 * - Array is non-empty
 * - resolved_conditions >= 3000 (logs warning if below threshold)
 *
 * @param data - Resolution data to validate
 * @returns true if valid, false if invalid
 */
export function validateResolutionData(data: any): data is ResolutionData {
  // Check that data.resolutions exists
  if (!data || typeof data !== 'object') {
    console.error('Invalid resolution data structure: data is not an object')
    return false
  }

  if (!data.resolutions) {
    console.error('Invalid resolution data structure: missing resolutions array')
    return false
  }

  // Check that resolutions is an array
  if (!Array.isArray(data.resolutions)) {
    console.error('Invalid resolution data structure: resolutions is not an array')
    return false
  }

  // Check that array is non-empty
  if (data.resolutions.length === 0) {
    console.error('Invalid resolution data structure: resolutions array is empty')
    return false
  }

  // Validate resolved_conditions threshold (warning, not error)
  const MIN_RESOLUTION_THRESHOLD = 3000
  if (data.resolved_conditions < MIN_RESOLUTION_THRESHOLD) {
    console.warn(
      `⚠️  Resolution count (${data.resolved_conditions}) is below expected threshold (${MIN_RESOLUTION_THRESHOLD}). Data may be incomplete.`
    )
  }

  return true
}

/**
 * Load resolution data from file with error handling
 *
 * @returns Resolution data if successful, null if error occurs
 */
export function loadResolutionData(): ResolutionData | null {
  try {
    const dataPath = resolve(process.cwd(), 'data/expanded_resolution_map.json')

    // Check if file exists
    if (!fs.existsSync(dataPath)) {
      console.warn('⚠️  Resolution data file not found:', dataPath)
      return null
    }

    // Read and parse file
    const fileContent = fs.readFileSync(dataPath, 'utf-8')
    const data = JSON.parse(fileContent)

    // Validate structure
    if (!validateResolutionData(data)) {
      console.error('⚠️  Resolution data file has invalid structure')
      return null
    }

    return data
  } catch (error) {
    // Handle file read errors or JSON parse errors
    if (error instanceof SyntaxError) {
      console.error('⚠️  Failed to parse resolution data JSON:', error.message)
    } else {
      console.error('⚠️  Failed to load resolution data:', error)
    }
    return null
  }
}

/**
 * Get fallback watchlist when resolution data is unavailable
 *
 * Returns empty array to ensure service never crashes.
 * Logs warning so operators know fallback was used.
 *
 * @param strategyId - Strategy ID for logging context
 * @returns Empty array (graceful degradation)
 */
export function getFallbackWatchlist(strategyId: string): any[] {
  console.warn(`⚠️  Using fallback watchlist for strategy ${strategyId} - resolution data unavailable`)

  // Could optionally return default markets if configured
  if (DEFAULT_MARKET_ID && DEFAULT_CONDITION_IDS.length > 0) {
    console.log(`ℹ️  Default market/condition configuration available but not implemented yet`)
  }

  // For now, return empty array (safe default)
  return []
}

/**
 * Process resolutions from validated resolution data
 *
 * Iterates over data.resolutions array and:
 * - Validates required fields exist
 * - Skips entries with missing required fields (logs warning)
 * - Maps to normalized outcome format
 *
 * @param data - Resolution data with resolutions array
 * @returns Array of normalized resolutions
 */
export function processResolutions(data: any): NormalizedResolution[] {
  // Validate structure first
  if (!validateResolutionData(data)) {
    console.error('⚠️  Cannot process resolutions: invalid data structure')
    return []
  }

  const normalizedResolutions: NormalizedResolution[] = []

  // Iterate over resolutions array (not Object.entries)
  data.resolutions.forEach((entry: any, index: number) => {
    // Null check for each resolution entry
    if (!entry || typeof entry !== 'object') {
      console.warn(`⚠️  Skipping resolution entry at index ${index}: entry is null or not an object`)
      return
    }

    // Validate required fields exist
    if (!entry.condition_id || !entry.market_id) {
      console.warn(
        `⚠️  Skipping resolution entry with missing required fields at index ${index}:`,
        {
          has_condition_id: !!entry.condition_id,
          has_market_id: !!entry.market_id,
          has_resolved_outcome: entry.resolved_outcome !== undefined,
        }
      )
      return
    }

    // Map to normalized format
    normalizedResolutions.push({
      condition_id: entry.condition_id,
      market_id: entry.market_id,
      resolved_outcome: entry.resolved_outcome,
      payout_yes: entry.payout_yes,
      payout_no: entry.payout_no,
    })
  })

  console.log(
    `✅ Processed ${normalizedResolutions.length} resolutions from ${data.resolutions.length} total entries`
  )

  return normalizedResolutions
}

// Cache for markets dimension data (loaded once on first use)
let marketsDimCache: Map<string, {
  market_id: string
  event_id: string | null
  category: string | null
  tags: string[]
  title: string
}> | null = null

let eventsDimCache: Map<string, {
  event_id: string
  category: string
  title: string
}> | null = null

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// KILL SWITCH: Must be explicitly enabled to auto-populate watchlists
const AUTONOMOUS_TRADING_ENABLED = process.env.AUTONOMOUS_TRADING_ENABLED === 'true'

// JSONL audit log path
const WATCHLIST_EVENTS_LOG = resolve(process.cwd(), 'runtime/watchlist_events.log')

/**
 * Write a watchlist event to JSONL audit log
 *
 * Each line is a JSON object with:
 * - timestamp: ISO datetime
 * - wallet: wallet address
 * - market_id: market ID
 * - condition_id: condition ID (null if not available)
 * - strategy_id: strategy that was updated
 * - strategy_name: strategy name
 * - category: market category from dimension tables (null if not available)
 * - canonical_category: product-level category bucket (e.g. "Politics / Geopolitics", "Macro / Economy")
 * - tags: market tags array from dimension tables (empty array if not available)
 * - raw_tags: all tag labels from event (for detailed filtering/analysis)
 * - triggering_wallet_coverage_pct: wallet's coverage percentage (descriptive field name)
 * - triggering_wallet_rank: wallet's P&L rank (descriptive field name)
 * - coverage_pct: (legacy field name, same as triggering_wallet_coverage_pct)
 * - pnl_rank: (legacy field name, same as triggering_wallet_rank)
 *
 * Example use case:
 * "This got added to the watchlist because Wallet X (rank #3, 19% coverage)
 *  bet NO on an Earnings/Equities market."
 */
function logWatchlistEvent(event: {
  wallet: string
  market_id: string
  condition_id?: string | null
  coverage_pct: number
  pnl_rank: number
  strategy_id: string
  strategy_name: string
  category?: string | null
  canonical_category?: string
  tags?: string[]
  raw_tags?: string[]
}) {
  try {
    const runtimeDir = resolve(process.cwd(), 'runtime')
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true })
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      wallet: event.wallet,
      market_id: event.market_id,
      condition_id: event.condition_id || null,
      strategy_id: event.strategy_id,
      strategy_name: event.strategy_name,
      // Category data from dimension tables (may be null/empty)
      category: event.category || null,
      canonical_category: event.canonical_category || 'Uncategorized',
      tags: event.tags || [],
      raw_tags: event.raw_tags || [],
      // Wallet context with descriptive field names
      triggering_wallet_coverage_pct: event.coverage_pct,
      triggering_wallet_rank: event.pnl_rank,
      // Keep old field names for backwards compatibility
      coverage_pct: event.coverage_pct,
      pnl_rank: event.pnl_rank
    }

    const logLine = JSON.stringify(logEntry) + '\n'
    fs.appendFileSync(WATCHLIST_EVENTS_LOG, logLine, 'utf-8')
  } catch (error) {
    console.error('⚠️  Failed to write to watchlist events log:', error)
  }
}

/**
 * Load markets dimension data from data/ directory
 * Caches result for performance
 */
function loadMarketsDim(): Map<string, {
  market_id: string
  event_id: string | null
  category: string | null
  tags: string[]
  title: string
}> {
  if (marketsDimCache) return marketsDimCache

  try {
    const dataPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
    if (!fs.existsSync(dataPath)) {
      console.warn('⚠️  markets_dim_seed.json not found, category enrichment disabled')
      marketsDimCache = new Map()
      return marketsDimCache
    }

    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
    marketsDimCache = new Map()

    for (const market of data.markets || []) {
      marketsDimCache.set(market.market_id, {
        market_id: market.market_id,
        event_id: market.event_id,
        category: market.category,
        tags: market.tags || [],
        title: market.title
      })
    }

    console.log(`✅ Loaded ${marketsDimCache.size} markets from dimension table`)
    return marketsDimCache
  } catch (error) {
    console.error('Error loading markets_dim_seed.json:', error)
    marketsDimCache = new Map()
    return marketsDimCache
  }
}

/**
 * Load events dimension data from data/ directory
 * Caches result for performance
 */
function loadEventsDim(): Map<string, {
  event_id: string
  category: string
  title: string
}> {
  if (eventsDimCache) return eventsDimCache

  try {
    const dataPath = resolve(process.cwd(), 'data/events_dim_seed.json')
    if (!fs.existsSync(dataPath)) {
      console.warn('⚠️  events_dim_seed.json not found')
      eventsDimCache = new Map()
      return eventsDimCache
    }

    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
    eventsDimCache = new Map()

    for (const event of data.events || []) {
      eventsDimCache.set(event.event_id, {
        event_id: event.event_id,
        category: event.category,
        title: event.title
      })
    }

    console.log(`✅ Loaded ${eventsDimCache.size} events from dimension table`)
    return eventsDimCache
  } catch (error) {
    console.error('Error loading events_dim_seed.json:', error)
    eventsDimCache = new Map()
    return eventsDimCache
  }
}

/**
 * Get enriched metadata for a market including canonical category and tags
 * Looks up from markets dimension table, falls back to events dimension
 * Uses canonical category mapper to convert Polymarket tags to product categories
 */
function getMarketEnrichment(marketId: string): {
  event_id: string | null
  category: string | null
  canonical_category: string
  tags: string[]
  raw_tags: string[]
  event_title: string | null
} {
  const marketsDim = loadMarketsDim()
  const eventsDim = loadEventsDim()

  const marketData = marketsDim.get(marketId)

  if (marketData) {
    // Look up event details if we have event_id
    let eventTitle = null
    let category = marketData.category
    let canonical_category = 'Uncategorized'
    let raw_tags: string[] = []

    if (marketData.event_id) {
      const eventData = eventsDim.get(marketData.event_id)
      if (eventData) {
        eventTitle = eventData.title
        // Prefer event category if market category is missing
        if (!category && eventData.category) {
          category = eventData.category
        }

        // Get canonical category from event using mapper
        const canonicalResult = getCanonicalCategoryForEvent({
          category: eventData.category,
          tags: []
        })
        canonical_category = canonicalResult.canonical_category
        raw_tags = canonicalResult.raw_tags
      }
    }

    return {
      event_id: marketData.event_id,
      category: category,
      canonical_category,
      tags: marketData.tags,
      raw_tags,
      event_title: eventTitle
    }
  }

  // Market not found in dimension table
  return {
    event_id: null,
    category: null,
    canonical_category: 'Uncategorized',
    tags: [],
    raw_tags: [],
    event_title: null
  }
}

/**
 * Check if autonomous trading is enabled
 * @returns true if AUTONOMOUS_TRADING_ENABLED=true in environment
 */
export function isAutonomousTradingEnabled(): boolean {
  return AUTONOMOUS_TRADING_ENABLED
}

export interface WatchlistEntry {
  strategy_id: string
  market_id: string
  condition_id?: string
  side: 'YES' | 'NO'
  reason: string
  added_at: string
  metadata: {
    triggered_by_wallet: string
    wallet_coverage_pct: number
    wallet_realized_pnl_usd: number
    market_title?: string
    category?: string
    [key: string]: any
  }
}

/**
 * Check if a market should be added to strategy watchlist
 *
 * Escalation criteria:
 * - Wallet is in signal set (coverage ≥2%)
 * - Market is not already in watchlist
 * - Category is allowed (when dimension tables available)
 * - Market meets quality thresholds (optional)
 */
async function shouldAddToWatchlist(
  supabase: any,
  strategyId: string,
  marketId: string,
  walletAddress: string
): Promise<{ add: boolean; reason?: string }> {
  // 1. Check if wallet is in signal set
  if (!isSignalWallet(walletAddress)) {
    return { add: false, reason: 'Wallet not in signal set' }
  }

  // 2. Check if market already in watchlist
  const { data: existing } = await supabase
    .from('strategy_watchlists')
    .select('id')
    .eq('strategy_id', strategyId)
    .eq('market_id', marketId)
    .single()

  if (existing) {
    return { add: false, reason: 'Market already in watchlist' }
  }

  // TODO: When dimension tables available:
  // 3. Check if market category is allowed
  // 4. Check market quality score
  // 5. Check wallet performance in this category

  return { add: true }
}

/**
 * Add a market to strategy watchlist
 */
async function addToWatchlist(
  supabase: any,
  entry: WatchlistEntry
): Promise<boolean> {
  const { error } = await supabase.from('strategy_watchlists').insert({
    strategy_id: entry.strategy_id,
    market_id: entry.market_id,
    condition_id: entry.metadata.condition_id,
    side: entry.side,
    reason: entry.reason,
    added_at: entry.added_at,
    status: 'watching',
    metadata: entry.metadata,
  } as any)

  if (error) {
    console.error(`Error adding ${entry.market_id} to watchlist:`, error)
    return false
  }

  return true
}

/**
 * Process position entry and auto-populate watchlists
 *
 * Called when a wallet opens a new position.
 * Checks all active strategies to see if they should watch this market.
 *
 * KILL SWITCH: Only runs if AUTONOMOUS_TRADING_ENABLED=true
 *
 * @param walletAddress - Wallet that entered position
 * @param marketId - Market ID
 * @param marketTitle - Market title
 * @param side - YES or NO
 * @param metadata - Additional market data
 */
export async function processPositionEntry(
  walletAddress: string,
  marketId: string,
  marketTitle: string,
  side: 'YES' | 'NO',
  metadata: Record<string, any> = {}
) {
  // KILL SWITCH: Do not auto-populate unless explicitly enabled
  if (!AUTONOMOUS_TRADING_ENABLED) {
    console.log(
      `⚠️  Auto-populate disabled (AUTONOMOUS_TRADING_ENABLED=${AUTONOMOUS_TRADING_ENABLED})`
    )
    return { added: 0, strategies: [], disabled: true }
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  // Get wallet details from signal set
  const walletDetails = getSignalWalletByAddress(walletAddress)
  if (!walletDetails) {
    return { added: 0, strategies: [] }
  }

  // Enrich with category, tags, and event data from dimension tables
  const enrichment = getMarketEnrichment(marketId)

  // Get all active strategies
  const { data: strategies, error } = await supabase
    .from('strategy_definitions')
    .select('strategy_id, strategy_name, execution_mode')
    .eq('is_active', true)

  if (error || !strategies || strategies.length === 0) {
    return { added: 0, strategies: [] }
  }

  const addedTo: string[] = []

  // Check each strategy
  for (const strategy of strategies) {
    const { add, reason } = await shouldAddToWatchlist(
      supabase,
      strategy.strategy_id,
      marketId,
      walletAddress
    )

    if (add) {
      const entry: WatchlistEntry = {
        strategy_id: strategy.strategy_id,
        market_id: marketId,
        condition_id: metadata.condition_id,
        side,
        reason: `Signal wallet entered position: ${walletAddress.slice(0, 10)}...`,
        added_at: new Date().toISOString(),
        metadata: {
          triggered_by_wallet: walletAddress,
          wallet_coverage_pct: walletDetails.coveragePct,
          wallet_realized_pnl_usd: walletDetails.realizedPnlUsd,
          wallet_rank: walletDetails.rank,
          market_title: marketTitle,
          // Category and tags from dimension tables (first-class fields)
          category: enrichment.category || metadata.category,
          tags: enrichment.tags.length > 0 ? enrichment.tags : metadata.tags,
          event_id: enrichment.event_id,
          event_title: enrichment.event_title,
          auto_added: true,
          ...metadata,
        },
      }

      const success = await addToWatchlist(supabase, entry)
      if (success) {
        addedTo.push(strategy.strategy_name)
        console.log(
          `✅ Added ${marketId.slice(0, 20)}... to ${strategy.strategy_name} (triggered by ${walletAddress.slice(0, 10)}...)`
        )

        // Log to JSONL audit file with canonical category and raw tags
        logWatchlistEvent({
          wallet: walletAddress,
          market_id: marketId,
          condition_id: metadata.condition_id,
          coverage_pct: walletDetails.coveragePct,
          pnl_rank: walletDetails.rank,
          strategy_id: strategy.strategy_id,
          strategy_name: strategy.strategy_name,
          category: enrichment.category,
          canonical_category: enrichment.canonical_category,
          tags: enrichment.tags,
          raw_tags: enrichment.raw_tags
        })
      }
    }
  }

  return {
    added: addedTo.length,
    strategies: addedTo,
  }
}

/**
 * Batch process multiple position entries
 * (called after monitoring run completes)
 */
export async function processPositionEntries(
  entries: Array<{
    walletAddress: string
    marketId: string
    marketTitle: string
    side: 'YES' | 'NO'
    metadata?: Record<string, any>
  }>
) {
  const results = []

  for (const entry of entries) {
    const result = await processPositionEntry(
      entry.walletAddress,
      entry.marketId,
      entry.marketTitle,
      entry.side,
      entry.metadata
    )
    results.push(result)
  }

  const totalAdded = results.reduce((sum, r) => sum + r.added, 0)
  const uniqueStrategies = new Set(results.flatMap((r) => r.strategies))

  return {
    totalAdded,
    strategiesUpdated: uniqueStrategies.size,
    results,
  }
}

/**
 * Get watchlist entry with wallet context
 */
export async function getWatchlistEntriesWithWalletContext(strategyId: string) {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data, error } = await supabase
    .from('strategy_watchlists')
    .select('*')
    .eq('strategy_id', strategyId)
    .order('added_at', { ascending: false })

  if (error) {
    console.error('Error fetching watchlist entries:', error)
    return []
  }

  // Enrich with wallet details
  return (data || []).map((entry) => {
    const walletAddress = entry.metadata?.triggered_by_wallet
    const wallet = walletAddress
      ? getSignalWalletByAddress(walletAddress)
      : null

    return {
      ...entry,
      wallet_details: wallet
        ? {
            address: wallet.address,
            rank: wallet.rank,
            realized_pnl_usd: wallet.realizedPnlUsd,
            coverage_pct: wallet.coveragePct,
          }
        : null,
    }
  })
}

/**
 * Remove markets from watchlist when signal wallet exits
 * (optional - may want to keep watching even after wallet exits)
 */
export async function processPositionExit(
  walletAddress: string,
  marketId: string
) {
  // TODO: Decide if we should remove from watchlist or just mark as "wallet exited"
  // For now, keep watching - strategy might still want to monitor
  console.log(
    `ℹ️  Signal wallet ${walletAddress.slice(0, 10)}... exited ${marketId.slice(0, 20)}...`
  )

  // Option 1: Remove from watchlist
  // await supabase.from('strategy_watchlists').delete()...

  // Option 2: Add exit metadata
  // await supabase.from('strategy_watchlists').update({ metadata: { ...metadata, wallet_exited: true } })...

  return { removed: 0 }
}

/**
 * Get statistics for auto-populated watchlist entries
 */
export async function getAutoPopulationStats() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data, error } = await supabase
    .from('strategy_watchlists')
    .select('strategy_id, metadata')

  if (error) {
    console.error('Error fetching watchlist stats:', error)
    return null
  }

  const autoAdded = data?.filter((e) => e.metadata?.auto_added === true) || []
  const manualAdded = data?.filter((e) => !e.metadata?.auto_added) || []

  const wallets = new Set(
    autoAdded.map((e) => e.metadata?.triggered_by_wallet).filter(Boolean)
  )

  return {
    total: data?.length || 0,
    autoAdded: autoAdded.length,
    manualAdded: manualAdded.length,
    triggeredByWallets: wallets.size,
  }
}
