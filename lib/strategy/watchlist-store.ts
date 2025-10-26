/**
 * Watchlist Store
 *
 * In-memory state for markets a strategy is currently watching.
 * Supports persistence to JSON for dashboard and recovery.
 *
 * No production database writes. This is runtime state only.
 */

import * as fs from 'fs'
import * as path from 'path'

export type WatchlistStatus =
  | 'watching'
  | 'escalate_candidate'
  | 'entered_position'
  | 'exited'

export interface WatchlistEntry {
  // Market identification
  condition_id: string
  market_id: string
  event_id: string

  // Market metadata
  category: string
  tags: string[]
  question: string

  // Strategy context
  side: 'YES' | 'NO' // Side we care about
  reason: string // e.g. "smart-flow", "news", "arb"
  strategyId: string

  // State
  status: WatchlistStatus
  addedAt: Date
  updatedAt: Date

  // Insider/suspicious flag (placeholder)
  insiderSuspect: boolean

  // Signal context (optional)
  triggeredByWallet?: string // Wallet that caused us to watch this
  timeToResolution?: number // Seconds until market closes
}

// In-memory store per strategy
const watchlists = new Map<string, Map<string, WatchlistEntry>>()

/**
 * Add market to watchlist
 */
export function addToWatchlist(entry: WatchlistEntry): void {
  let strategyWatchlist = watchlists.get(entry.strategyId)

  if (!strategyWatchlist) {
    strategyWatchlist = new Map()
    watchlists.set(entry.strategyId, strategyWatchlist)
  }

  strategyWatchlist.set(entry.condition_id, {
    ...entry,
    addedAt: entry.addedAt || new Date(),
    updatedAt: new Date(),
  })

  // Persist to JSON
  dumpWatchlistToFile(entry.strategyId)
}

/**
 * Update watchlist entry status
 */
export function updateWatchlistStatus(
  strategyId: string,
  conditionId: string,
  newStatus: WatchlistStatus
): void {
  const strategyWatchlist = watchlists.get(strategyId)

  if (!strategyWatchlist) {
    console.warn(`Strategy ${strategyId} has no watchlist`)
    return
  }

  const entry = strategyWatchlist.get(conditionId)

  if (!entry) {
    console.warn(`Condition ${conditionId} not in watchlist for strategy ${strategyId}`)
    return
  }

  entry.status = newStatus
  entry.updatedAt = new Date()

  // Persist to JSON
  dumpWatchlistToFile(strategyId)
}

/**
 * Update watchlist entry fields
 */
export function updateWatchlistEntry(
  strategyId: string,
  conditionId: string,
  updates: Partial<WatchlistEntry>
): void {
  const strategyWatchlist = watchlists.get(strategyId)

  if (!strategyWatchlist) {
    console.warn(`Strategy ${strategyId} has no watchlist`)
    return
  }

  const entry = strategyWatchlist.get(conditionId)

  if (!entry) {
    console.warn(`Condition ${conditionId} not in watchlist for strategy ${strategyId}`)
    return
  }

  Object.assign(entry, updates, { updatedAt: new Date() })

  // Persist to JSON
  dumpWatchlistToFile(strategyId)
}

/**
 * List all watchlist entries for a strategy
 */
export function listWatchlist(strategyId: string): WatchlistEntry[] {
  const strategyWatchlist = watchlists.get(strategyId)

  if (!strategyWatchlist) {
    return []
  }

  return Array.from(strategyWatchlist.values())
}

/**
 * Get specific watchlist entry
 */
export function getWatchlistEntry(
  strategyId: string,
  conditionId: string
): WatchlistEntry | null {
  const strategyWatchlist = watchlists.get(strategyId)

  if (!strategyWatchlist) {
    return null
  }

  return strategyWatchlist.get(conditionId) || null
}

/**
 * Clear watchlist for a strategy
 */
export function clearWatchlist(strategyId: string): void {
  watchlists.delete(strategyId)

  // Delete persisted file
  const filePath = path.join(
    process.cwd(),
    `watchlist-${strategyId}.json`
  )

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

/**
 * Persist watchlist to JSON file
 *
 * Used for dashboard display and recovery after restart.
 */
function dumpWatchlistToFile(strategyId: string): void {
  const entries = listWatchlist(strategyId)

  const filePath = path.join(
    process.cwd(),
    `watchlist-${strategyId}.json`
  )

  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2))
}

/**
 * Load watchlist from JSON file
 *
 * Used for recovery after restart.
 */
export function loadWatchlistFromFile(strategyId: string): void {
  const filePath = path.join(
    process.cwd(),
    `watchlist-${strategyId}.json`
  )

  if (!fs.existsSync(filePath)) {
    return
  }

  const entries: WatchlistEntry[] = JSON.parse(
    fs.readFileSync(filePath, 'utf-8')
  )

  const strategyWatchlist = new Map<string, WatchlistEntry>()

  for (const entry of entries) {
    strategyWatchlist.set(entry.condition_id, {
      ...entry,
      addedAt: new Date(entry.addedAt),
      updatedAt: new Date(entry.updatedAt),
    })
  }

  watchlists.set(strategyId, strategyWatchlist)
}
