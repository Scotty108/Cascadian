/**
 * Polymarket Utility Functions
 *
 * Helper functions for data transformation, batching, and utilities
 */

import type {
  PolymarketMarket,
  PolymarketEvent,
  PolymarketTag,
  CascadianMarket,
} from '@/types/polymarket';

// ============================================================================
// Array Utilities
// ============================================================================

/**
 * Split array into chunks of specified size
 * Used for batch processing
 *
 * @example
 * chunk([1,2,3,4,5], 2) => [[1,2], [3,4], [5]]
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Promise-based sleep function
 * Used for delays and exponential backoff
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * Used for retry logic
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  const delay = baseDelay * Math.pow(2, attempt);
  return Math.min(delay, maxDelay);
}

// ============================================================================
// Category Extraction (3-Tier System)
// ============================================================================

/**
 * Extract category from Polymarket event tags
 * 3-Tier fallback system (battle-tested on ~1500 markets/hour):
 *
 * Tier 1: Exact tag label matches
 * Tier 2: Keyword contains in tag labels
 * Tier 3: Default to 'Other'
 *
 * Source: Based on production implementation from ingestor
 */
export function extractCategoryFromTags(tags?: PolymarketTag[]): string {
  if (!tags || tags.length === 0) {
    return 'Other';
  }

  // Tier 1: Exact category matches
  const exactCategoryMap: Record<string, string> = {
    'crypto': 'Crypto',
    'cryptocurrency': 'Crypto',
    'politics': 'Politics',
    'sports': 'Sport',
    'entertainment': 'Culture',
    'pop-culture': 'Culture',
    'science': 'Science',
    'business': 'Finance',
    'technology': 'Tech',
  };

  const tagLabels = tags.map(t => t.label.toLowerCase());

  // Check for exact matches first
  for (const tagLabel of tagLabels) {
    if (exactCategoryMap[tagLabel]) {
      return exactCategoryMap[tagLabel];
    }
  }

  // Tier 2: Keyword contains matching
  const keywordCategoryMap: Record<string, string[]> = {
    'Crypto': ['bitcoin', 'ethereum', 'defi', 'nft', 'blockchain', 'solana', 'crypto'],
    'Politics': ['election', 'president', 'congress', 'vote', 'senate', 'government'],
    'Sport': ['nfl', 'nba', 'mlb', 'nhl', 'playoff', 'championship', 'soccer', 'football'],
    'Culture': ['movie', 'film', 'music', 'celebrity', 'album', 'oscar', 'grammy'],
    'Science': ['ai', 'space', 'climate', 'medicine', 'covid', 'vaccine'],
    'Finance': ['stock', 'market', 'ceo', 'ipo', 'earnings', 'fed', 'gdp'],
  };

  // Check if any tag label contains keywords
  for (const [category, keywords] of Object.entries(keywordCategoryMap)) {
    for (const tagLabel of tagLabels) {
      if (keywords.some(keyword => tagLabel.includes(keyword))) {
        return category;
      }
    }
  }

  // Tier 3: Default fallback
  return 'Other';
}

// ============================================================================
// Event → Market Expansion
// ============================================================================

/**
 * Expand Polymarket events to flat array of markets with inherited categories
 *
 * Process:
 * 1. For each event, extract category from event tags (once per event)
 * 2. For each market in event, create market with inherited category
 * 3. Flatten all markets into single array
 *
 * Deduplication: Handled by UPSERT on market_id in database
 *
 * @param events Array of Polymarket events from /events endpoint
 * @returns Flat array of markets with categories
 */
export function expandEventsToMarkets(events: PolymarketEvent[]): Array<PolymarketMarket & { category: string; event_slug: string }> {
  const allMarkets: Array<PolymarketMarket & { category: string; event_slug: string }> = [];

  for (const event of events) {
    // Extract category ONCE per event (efficient)
    const category = extractCategoryFromTags(event.tags);

    // Expand all markets in this event
    for (const market of event.markets) {
      // Market inherits category from parent event
      allMarkets.push({
        ...market,
        category,           // Inherited from event tags
        event_slug: event.slug,  // Link back to parent event
      });
    }
  }

  return allMarkets;
}

// ============================================================================
// Data Transformation
// ============================================================================

/**
 * Transform Polymarket market to Cascadian schema
 * Converts string numbers to actual numbers and handles missing fields
 */
export function transformPolymarketMarket(
  pm: PolymarketMarket
): CascadianMarket {
  // Helper to safely parse JSON strings
  const parseJSON = (str: string | undefined, fallback: any = []) => {
    if (!str) return fallback;
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  };

  // Parse outcomes from JSON string
  const outcomes: string[] = parseJSON(pm.outcomes, ['Yes', 'No']);

  // Parse outcome prices (can be JSON array or comma-separated string)
  const outcomePricesStr = pm.outcome_prices || pm.outcomePrices || pm.outcomePrices || '';
  let outcomePrices: number[] = [];

  if (outcomePricesStr) {
    try {
      // Try parsing as JSON array first
      const parsed = parseJSON(outcomePricesStr, null);
      if (Array.isArray(parsed)) {
        outcomePrices = parsed.map(p => parseFloat(p));
      } else if (typeof outcomePricesStr === 'string' && outcomePricesStr.includes(',')) {
        // Handle comma-separated format like "0.52,0.48"
        outcomePrices = outcomePricesStr.split(',').map(p => parseFloat(p.trim()));
      }
    } catch {
      // If parsing fails, use defaults
      outcomePrices = [0];
    }
  }

  const currentPrice = outcomePrices[0] || 0;

  // Parse numeric fields (handle both snake_case and camelCase)
  const volume24h = pm.volume_24hr || pm.volume24hr
    ? parseFloat(pm.volume_24hr || pm.volume24hr || '0')
    : 0;

  const volumeTotal = pm.volume
    ? parseFloat(pm.volume)
    : 0;

  const liquidity = pm.liquidity
    ? parseFloat(pm.liquidity)
    : 0;

  // Parse dates (handle both field name formats)
  const createdAt = pm.created_at || pm.createdAt
    ? new Date(pm.created_at || pm.createdAt!)
    : new Date();

  // Parse end_date and ensure it satisfies: end_date > created_at
  // Database constraint: closed = TRUE OR end_date IS NULL OR end_date > created_at
  let endDate: Date;
  if (pm.end_date_iso || pm.endDate) {
    endDate = new Date(pm.end_date_iso || pm.endDate!);

    // If market is NOT closed and end_date <= created_at, adjust it
    if (!pm.closed && endDate.getTime() <= createdAt.getTime()) {
      // Set to 1 day after created_at to satisfy constraint
      endDate = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    }
  } else {
    // If no end_date, set to 1 year in the future
    endDate = new Date(createdAt.getTime() + 365 * 24 * 60 * 60 * 1000);
  }

  const updatedAt = pm.updated_at || pm.updatedAt
    ? new Date(pm.updated_at || pm.updatedAt!)
    : new Date();

  // Category is already attached to market from event expansion
  // If not present, fallback to 'Other'
  const category = pm.category || 'Other';

  // Handle active/closed status
  // Database constraint: NOT (active = TRUE AND closed = TRUE)
  // If market is closed, it cannot be active
  const active = pm.closed ? false : pm.active;
  const closed = pm.closed;

  return {
    market_id: pm.id,
    title: pm.question,
    description: pm.description || '',
    category,

    // Pricing
    current_price: currentPrice,
    volume_24h: volume24h,
    volume_total: volumeTotal,
    liquidity: liquidity,

    // Market metadata
    active: active,
    closed: closed,
    end_date: endDate,
    outcomes: outcomes,

    // Slugs and URLs
    slug: pm.slug,
    image_url: pm.image_url || pm.image,

    // Raw data for debugging
    raw_data: pm as unknown as Record<string, unknown>,

    // Timestamps
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

/**
 * Transform array of Polymarket markets
 */
export function transformPolymarketMarkets(
  markets: PolymarketMarket[]
): CascadianMarket[] {
  return markets
    .map(transformPolymarketMarket)
    .filter((market): market is CascadianMarket => market !== null);
}

// ============================================================================
// Data Validation
// ============================================================================

/**
 * Check if market data is valid
 * Returns true if market has required fields
 */
export function isValidMarket(market: unknown): market is PolymarketMarket {
  if (!market || typeof market !== 'object') {
    return false;
  }

  const m = market as Record<string, unknown>;

  return (
    typeof m.id === 'string' &&
    typeof m.question === 'string' &&
    typeof m.active === 'boolean' &&
    typeof m.closed === 'boolean' &&
    typeof m.outcomes === 'string'  // Polymarket returns JSON string, not array
  );
}

/**
 * Filter out invalid markets from array
 */
export function filterValidMarkets(
  markets: unknown[]
): PolymarketMarket[] {
  return markets.filter(isValidMarket);
}

// ============================================================================
// Staleness Checking
// ============================================================================

/**
 * Check if timestamp is stale based on threshold
 */
export function isStaleData(
  timestamp: Date | string | null,
  thresholdMs: number
): boolean {
  if (!timestamp) {
    return true;
  }

  const ts = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const now = new Date();
  const age = now.getTime() - ts.getTime();

  return age > thresholdMs;
}

/**
 * Calculate age of data in seconds
 */
export function getDataAge(timestamp: Date | string | null): number {
  if (!timestamp) {
    return Infinity;
  }

  const ts = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const now = new Date();
  return Math.floor((now.getTime() - ts.getTime()) / 1000);
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Format sync duration for logging
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Format timestamp for logging
 */
export function formatTimestamp(date: Date): string {
  return date.toISOString();
}

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Check if error is retryable based on error type
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  // Check if it's a network error
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset')
    ) {
      return true;
    }
  }

  // Check if it has a status code
  const err = error as { statusCode?: number; status?: number };
  const statusCode = err.statusCode || err.status;

  // Retry on rate limits and server errors
  if (statusCode === 429 || (statusCode && statusCode >= 500)) {
    return true;
  }

  return false;
}

/**
 * Extract error message safely
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}
