/**
 * In-Memory LRU Cache for API responses
 *
 * No external dependencies needed - runs entirely in Node.js memory
 * Can be upgraded to Redis later for multi-instance deployments
 */

import { LRUCache } from 'lru-cache'

interface CacheOptions {
  max?: number  // Max items in cache
  ttl?: number  // Time to live in milliseconds
}

// Create cache instance
const cache = new LRUCache<string, any>({
  max: 1000,  // Store up to 1000 different cache entries
  ttl: 30 * 1000,  // Default 30 seconds TTL
  updateAgeOnGet: false,  // Don't refresh TTL on access
  updateAgeOnHas: false,
})

/**
 * Get cached data
 */
export function getCached<T>(key: string): T | null {
  const cached = cache.get(key)
  if (cached) {
    console.log(`[Cache] HIT: ${key}`)
    return cached as T
  }
  console.log(`[Cache] MISS: ${key}`)
  return null
}

/**
 * Set cached data with optional custom TTL
 */
export function setCached<T>(key: string, data: T, ttl?: number): void {
  cache.set(key, data, { ttl })
  console.log(`[Cache] SET: ${key} (TTL: ${ttl || 30000}ms)`)
}

/**
 * Delete cached data
 */
export function deleteCached(key: string): void {
  cache.delete(key)
  console.log(`[Cache] DELETE: ${key}`)
}

/**
 * Clear entire cache
 */
export function clearCache(): void {
  cache.clear()
  console.log('[Cache] CLEARED all entries')
}

/**
 * Get cache stats
 */
export function getCacheStats() {
  return {
    size: cache.size,
    maxSize: cache.max,
    calculatedSize: cache.calculatedSize,
  }
}

/**
 * Wrapper function for caching async operations
 *
 * Usage:
 * const data = await withCache('my-key', () => fetchData(), 60000)
 */
export async function withCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttl?: number
): Promise<T> {
  // Try cache first
  const cached = getCached<T>(key)
  if (cached !== null) {
    return cached
  }

  // Execute function
  const result = await fn()

  // Cache result
  setCached(key, result, ttl)

  return result
}
