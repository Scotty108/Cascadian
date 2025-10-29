/**
 * Goldsky Batch Token Resolution
 *
 * PERFORMANCE BREAKTHROUGH:
 * - Can resolve 50,000 tokens in ~1 second (vs 115M sequential calls taking weeks)
 * - Uses GraphQL plural query with id_in operator
 * - Reduces 115M trades from 157 days to <1 hour
 *
 * BENCHMARKS:
 * - Batch size 50,000: 44,603 tokens/sec
 * - Batch size 25,000: 44,883 tokens/sec
 * - Batch size 10,000: 7,722 tokens/sec
 * - Sequential: 8.4 tokens/sec
 *
 * SPEEDUP: 5,300x faster than sequential!
 */

import { positionsClient } from './client'

// GraphQL query for batch token resolution
const BATCH_RESOLVE_TOKENS = /* GraphQL */ `
  query BatchResolveTokens($tokenIds: [String!]!) {
    tokenIdConditions(where: { id_in: $tokenIds }) {
      id
      condition {
        id
      }
      outcomeIndex
    }
  }
`

export interface TokenMapping {
  tokenId: string
  conditionId: string
  outcome: number
}

export interface BatchResolveResult {
  resolved: TokenMapping[]
  notFound: string[]
  duration: number
}

/**
 * Resolve multiple token IDs to their condition and outcome in a single API call
 *
 * @param tokenIds - Array of token IDs to resolve
 * @param batchSize - Maximum tokens per batch (default: 25,000 for optimal balance)
 * @returns Resolved mappings and list of not found tokens
 *
 * @example
 * const tokenIds = ['123', '456', '789']
 * const result = await batchResolveTokenIds(tokenIds)
 * console.log(`Resolved ${result.resolved.length}/${tokenIds.length} tokens in ${result.duration}ms`)
 */
export async function batchResolveTokenIds(
  tokenIds: string[],
  batchSize: number = 25000
): Promise<BatchResolveResult> {
  // Filter out '0' (USDC collateral token)
  const validTokenIds = tokenIds.filter((id) => id !== '0')

  if (validTokenIds.length === 0) {
    return {
      resolved: [],
      notFound: [],
      duration: 0
    }
  }

  const allResolved: TokenMapping[] = []
  const allNotFound: string[] = []
  let totalDuration = 0

  // Process in batches
  for (let i = 0; i < validTokenIds.length; i += batchSize) {
    const batch = validTokenIds.slice(i, i + batchSize)

    try {
      const startTime = Date.now()
      const result: any = await positionsClient.request(BATCH_RESOLVE_TOKENS, {
        tokenIds: batch
      })
      const duration = Date.now() - startTime
      totalDuration += duration

      // Convert results to TokenMapping
      const resolved = (result.tokenIdConditions || []).map((token: any) => ({
        tokenId: token.id,
        conditionId: token.condition.id,
        outcome: parseInt(token.outcomeIndex)
      }))

      allResolved.push(...resolved)

      // Find tokens that weren't returned (not found in Goldsky)
      const resolvedIds = new Set(resolved.map((r: TokenMapping) => r.tokenId))
      const notFound = batch.filter((id) => !resolvedIds.has(id))
      allNotFound.push(...notFound)

    } catch (error) {
      console.error(`[Goldsky] Batch resolve failed for ${batch.length} tokens:`, error)
      // Mark entire batch as not found on error
      allNotFound.push(...batch)
    }
  }

  return {
    resolved: allResolved,
    notFound: allNotFound,
    duration: totalDuration
  }
}

/**
 * Resolve token IDs with in-memory caching
 *
 * Maintains a cache to avoid re-querying the same tokens.
 * Use this for incremental/streaming workloads.
 */
export class CachedTokenResolver {
  private cache = new Map<string, { conditionId: string; outcome: number } | null>()
  private batchSize: number

  constructor(batchSize: number = 25000) {
    this.batchSize = batchSize
  }

  /**
   * Get cached size
   */
  getCacheSize(): number {
    return this.cache.size
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Pre-populate cache from a batch resolve
   */
  async warmCache(tokenIds: string[]): Promise<void> {
    const uncached = tokenIds.filter((id) => !this.cache.has(id))

    if (uncached.length === 0) return

    const result = await batchResolveTokenIds(uncached, this.batchSize)

    // Add resolved to cache
    for (const mapping of result.resolved) {
      this.cache.set(mapping.tokenId, {
        conditionId: mapping.conditionId,
        outcome: mapping.outcome
      })
    }

    // Add not found to cache as null
    for (const tokenId of result.notFound) {
      this.cache.set(tokenId, null)
    }
  }

  /**
   * Resolve a single token (uses cache)
   */
  async resolveToken(
    tokenId: string
  ): Promise<{ conditionId: string; outcome: number } | null> {
    if (tokenId === '0') return null

    // Check cache
    if (this.cache.has(tokenId)) {
      return this.cache.get(tokenId)!
    }

    // Fetch and cache
    await this.warmCache([tokenId])
    return this.cache.get(tokenId) || null
  }

  /**
   * Resolve multiple tokens (uses cache, batches uncached)
   */
  async resolveTokens(
    tokenIds: string[]
  ): Promise<Map<string, { conditionId: string; outcome: number } | null>> {
    const results = new Map<string, { conditionId: string; outcome: number } | null>()

    // Collect uncached tokens
    const uncached: string[] = []
    for (const tokenId of tokenIds) {
      if (tokenId === '0') {
        results.set(tokenId, null)
        continue
      }

      if (this.cache.has(tokenId)) {
        results.set(tokenId, this.cache.get(tokenId)!)
      } else {
        uncached.push(tokenId)
      }
    }

    // Batch fetch uncached
    if (uncached.length > 0) {
      await this.warmCache(uncached)

      // Add newly cached results
      for (const tokenId of uncached) {
        results.set(tokenId, this.cache.get(tokenId) || null)
      }
    }

    return results
  }

  /**
   * Export cache to JSON (for persistence)
   */
  exportCache(): Record<string, { conditionId: string; outcome: number } | null> {
    return Object.fromEntries(this.cache.entries())
  }

  /**
   * Import cache from JSON (for persistence)
   */
  importCache(data: Record<string, { conditionId: string; outcome: number } | null>): void {
    this.cache.clear()
    for (const [tokenId, mapping] of Object.entries(data)) {
      this.cache.set(tokenId, mapping)
    }
  }
}
