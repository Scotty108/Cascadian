/**
 * Wallet Score Cache
 *
 * Caches wallet intelligence scores to avoid recalculating for every request
 * Scores are expensive to calculate (need to fetch closed positions, calculate metrics)
 */

interface CachedScore {
  score: number
  grade: string
  calculatedAt: number // timestamp
  ttl: number // time to live in ms
}

class WalletScoreCache {
  private cache: Map<string, CachedScore> = new Map()
  private defaultTTL: number = 1000 * 60 * 60 // 1 hour

  /**
   * Get cached score for a wallet
   * Returns null if not cached or expired
   */
  get(walletAddress: string): number | null {
    const cached = this.cache.get(walletAddress.toLowerCase())
    if (!cached) return null

    const now = Date.now()
    const age = now - cached.calculatedAt

    // Check if expired
    if (age > cached.ttl) {
      this.cache.delete(walletAddress.toLowerCase())
      return null
    }

    return cached.score
  }

  /**
   * Set score for a wallet
   */
  set(walletAddress: string, score: number, grade: string, ttl?: number): void {
    this.cache.set(walletAddress.toLowerCase(), {
      score,
      grade,
      calculatedAt: Date.now(),
      ttl: ttl || this.defaultTTL,
    })
  }

  /**
   * Check if wallet has valid cached score
   */
  has(walletAddress: string): boolean {
    return this.get(walletAddress) !== null
  }

  /**
   * Clear expired entries
   */
  clearExpired(): number {
    const now = Date.now()
    let cleared = 0

    for (const [address, cached] of this.cache.entries()) {
      const age = now - cached.calculatedAt
      if (age > cached.ttl) {
        this.cache.delete(address)
        cleared++
      }
    }

    return cleared
  }

  /**
   * Clear all cached scores
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      addresses: Array.from(this.cache.keys()),
    }
  }

  /**
   * Bulk set scores
   */
  setMany(scores: Array<{ address: string; score: number; grade: string }>, ttl?: number): void {
    for (const { address, score, grade } of scores) {
      this.set(address, score, grade, ttl)
    }
  }

  /**
   * Bulk get scores
   */
  getMany(addresses: string[]): Map<string, number | null> {
    const results = new Map<string, number | null>()

    for (const address of addresses) {
      results.set(address, this.get(address))
    }

    return results
  }
}

// Singleton instance
export const walletScoreCache = new WalletScoreCache()

// Periodically clear expired entries (every 10 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cleared = walletScoreCache.clearExpired()
    if (cleared > 0) {
      console.log(`[Wallet Score Cache] Cleared ${cleared} expired entries`)
    }
  }, 1000 * 60 * 10) // 10 minutes
}

/**
 * Helper to get or calculate wallet score
 */
export async function getOrCalculateWalletScore(
  walletAddress: string,
  calculateFn: () => Promise<{ overall: number; grade: string }>
): Promise<number> {
  // Check cache first
  const cached = walletScoreCache.get(walletAddress)
  if (cached !== null) {
    return cached
  }

  // Calculate score
  try {
    const result = await calculateFn()
    walletScoreCache.set(walletAddress, result.overall, result.grade)
    return result.overall
  } catch (error) {
    console.error(`[Wallet Score Cache] Error calculating score for ${walletAddress}:`, error)
    return 0 // Return 0 on error (will be treated as "unknown")
  }
}
