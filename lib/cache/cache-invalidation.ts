/**
 * Cache Invalidation System
 *
 * Invalidates cache when Polymarket sync completes
 * Notifies clients via timestamp tracking
 */

import { clearCache } from './memory-cache'

let lastSyncTimestamp = Date.now()

/**
 * Call this when Polymarket sync completes
 */
export function invalidateCacheOnSync() {
  console.log('[Cache Invalidation] Clearing cache after sync')
  clearCache()
  lastSyncTimestamp = Date.now()
}

/**
 * Get last sync timestamp
 * Clients can poll this lightweight endpoint instead of full data
 */
export function getLastSyncTimestamp(): number {
  return lastSyncTimestamp
}

/**
 * Check if client data is stale
 */
export function isClientDataStale(clientTimestamp: number): boolean {
  return clientTimestamp < lastSyncTimestamp
}
