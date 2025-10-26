/**
 * Polymarket API Configuration
 *
 * Central configuration for Polymarket Gamma API integration
 */

// ============================================================================
// API Configuration
// ============================================================================

/**
 * Polymarket Gamma API base URL
 */
export const POLYMARKET_API_URL =
  process.env.POLYMARKET_API_URL || 'https://gamma-api.polymarket.com';

/**
 * API endpoints
 */
export const ENDPOINTS = {
  MARKETS: '/markets',
  EVENTS: '/events',
  MARKET_DETAIL: (id: string) => `/markets/${id}`,
  TRADES: '/trades',
  ORDERBOOK: (id: string) => `/markets/${id}/book`,
} as const;

// ============================================================================
// Rate Limiting & Retry Configuration
// ============================================================================

/**
 * Rate limit configuration
 * Polymarket API: ~60 requests/minute
 */
export const RATE_LIMIT = {
  MAX_REQUESTS_PER_MINUTE: 60,
  SAFE_REQUESTS_PER_MINUTE: 50,  // Leave buffer
  MIN_REQUEST_INTERVAL_MS: 1200,  // ~50 req/min
} as const;

/**
 * Retry configuration with exponential backoff
 */
export const RETRY_CONFIG = {
  MAX_RETRIES: 4,
  BASE_DELAY_MS: 1000,  // Start at 1 second
  MAX_DELAY_MS: 16000,  // Cap at 16 seconds
  EXPONENTIAL_BASE: 2,  // Double each time: 1s, 2s, 4s, 8s
} as const;

/**
 * Timeout configuration
 */
export const TIMEOUT_CONFIG = {
  DEFAULT_TIMEOUT_MS: 5000,  // 5 seconds
  LONG_TIMEOUT_MS: 10000,    // 10 seconds for large requests
} as const;

// ============================================================================
// Sync Configuration
// ============================================================================

/**
 * Sync behavior configuration
 */
export const SYNC_CONFIG = {
  BATCH_SIZE: 500,  // Markets per batch for UPSERT
  STALENESS_THRESHOLD_MS: 5 * 60 * 1000,  // 5 minutes
  MAX_MARKETS_PER_SYNC: 25000,  // Safety limit (increased to handle all ~20k markets)
  PARALLEL_FETCH_LIMIT: 5,  // Max concurrent API requests
} as const;

/**
 * Mutex configuration (in-memory for Phase 1)
 */
export const MUTEX_CONFIG = {
  SYNC_LOCK_KEY: 'polymarket_sync_lock',
  MAX_LOCK_DURATION_MS: 600000,  // 10 minutes max sync time (increased for full ~20k market sync)
} as const;

// ============================================================================
// Data Freshness
// ============================================================================

/**
 * Data freshness thresholds
 */
export const FRESHNESS_CONFIG = {
  MARKETS_LIST_TTL_MS: 30 * 1000,  // 30 seconds
  MARKET_DETAIL_TTL_MS: 10 * 1000,  // 10 seconds
  SYNC_INTERVAL_MS: 5 * 60 * 1000,  // 5 minutes
} as const;

// ============================================================================
// Default Query Parameters
// ============================================================================

/**
 * Default parameters for market queries
 */
export const DEFAULT_QUERY_PARAMS = {
  limit: 100,
  offset: 0,
  active: true,
  closed: false,
  sort: 'volume' as const,
} as const;
