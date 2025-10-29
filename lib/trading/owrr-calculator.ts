/**
 * OWRRCalculator - Smart Money Consensus Calculator
 *
 * Wraps lib/metrics/owrr.ts with:
 * - In-memory caching (5 minute TTL)
 * - Retry logic for ClickHouse failures
 * - Fallback to last known OWRR if calculation fails
 * - Graceful error handling
 *
 * @module lib/trading/owrr-calculator
 */

import { calculateOWRR, type OWRRResult } from '@/lib/metrics/owrr';

// ============================================================================
// Types
// ============================================================================

interface CachedOWRR {
  result: OWRRResult;
  timestamp: number;
}

// ============================================================================
// OWRRCalculator Class
// ============================================================================

export class OWRRCalculator {
  private cache: Map<string, CachedOWRR> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY_MS = 1000;

  constructor() {
    console.log('[OWRRCalculator] Initialized with 5min cache TTL');

    // Clean up stale cache entries every 10 minutes
    setInterval(() => this.cleanupCache(), 10 * 60 * 1000);
  }

  /**
   * Calculate OWRR for a market with caching and retry logic
   */
  async calculate(marketId: string, category: string): Promise<OWRRResult> {
    const cacheKey = `${marketId}:${category}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      console.log(`[OWRRCalculator] Cache hit for ${marketId} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
      return cached.result;
    }

    // Calculate with retry logic
    for (let attempt = 1; attempt <= this.RETRY_ATTEMPTS; attempt++) {
      try {
        console.log(`[OWRRCalculator] Calculating OWRR for ${marketId} (attempt ${attempt}/${this.RETRY_ATTEMPTS})`);

        const result = await calculateOWRR(marketId, category);

        // Cache result
        this.cache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        });

        console.log(`[OWRRCalculator] OWRR calculated: slider=${result.slider}, confidence=${result.confidence}`);

        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[OWRRCalculator] Attempt ${attempt}/${this.RETRY_ATTEMPTS} failed:`, errorMsg);

        // If last attempt, fallback to cache or neutral
        if (attempt === this.RETRY_ATTEMPTS) {
          if (cached) {
            console.warn(`[OWRRCalculator] Using stale cache for ${marketId} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
            return cached.result;
          }

          console.warn(`[OWRRCalculator] Returning neutral OWRR for ${marketId} (no cache available)`);
          return this.getNeutralOWRR(category);
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS * attempt));
      }
    }

    // Fallback (should never reach here due to loop logic)
    return this.getNeutralOWRR(category);
  }

  /**
   * Get neutral OWRR when calculation fails and no cache available
   */
  private getNeutralOWRR(category: string): OWRRResult {
    return {
      owrr: 0.5,
      slider: 50,
      yes_score: 0,
      no_score: 0,
      yes_qualified: 0,
      no_qualified: 0,
      yes_avg_omega: 0,
      no_avg_omega: 0,
      yes_avg_risk: 0,
      no_avg_risk: 0,
      category,
      confidence: 'insufficient_data',
      breakdown: {
        yes_votes: [],
        no_votes: [],
      },
    };
  }

  /**
   * Clean up stale cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL_MS * 2) {
        // Remove entries older than 2x TTL
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[OWRRCalculator] Cache cleanup: removed ${removed} stale entries`);
    }
  }

  /**
   * Clear all cache entries (for testing)
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[OWRRCalculator] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ key: string; age_seconds: number; slider: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, cached]) => ({
      key,
      age_seconds: Math.round((now - cached.timestamp) / 1000),
      slider: cached.result.slider,
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }
}
