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
 * - condition_id: condition ID (if available)
 * - coverage_pct: wallet's coverage percentage
 * - pnl_rank: wallet's P&L rank
 * - strategy_id: strategy that was updated
 * - strategy_name: strategy name
 */
function logWatchlistEvent(event: {
  wallet: string
  market_id: string
  condition_id?: string | null
  coverage_pct: number
  pnl_rank: number
  strategy_id: string
  strategy_name: string
}) {
  try {
    const runtimeDir = resolve(process.cwd(), 'runtime')
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true })
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      ...event
    }

    const logLine = JSON.stringify(logEntry) + '\n'
    fs.appendFileSync(WATCHLIST_EVENTS_LOG, logLine, 'utf-8')
  } catch (error) {
    console.error('⚠️  Failed to write to watchlist events log:', error)
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
  })

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
          category: metadata.category,
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

        // Log to JSONL audit file
        logWatchlistEvent({
          wallet: walletAddress,
          market_id: marketId,
          condition_id: metadata.condition_id,
          coverage_pct: walletDetails.coveragePct,
          pnl_rank: walletDetails.rank,
          strategy_id: strategy.strategy_id,
          strategy_name: strategy.strategy_name
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
