/**
 * Polymarket API Types
 *
 * Type definitions for Polymarket Gamma API responses and transformations
 */

// ============================================================================
// Raw Polymarket API Response Types
// ============================================================================

/**
 * Market data from Polymarket Gamma API
 * Note: All numeric values are returned as strings and need parsing
 */
export interface PolymarketMarket {
  id: string;
  question: string;
  description: string;
  condition_id: string;
  slug: string;

  // Outcomes (API returns JSON strings, not arrays!)
  outcomes: string;  // JSON string like "[\"Yes\", \"No\"]"
  outcome_prices?: string;  // JSON string like "[\"0.52\", \"0.48\"]" or "0.52,0.48"
  outcomePrices?: string;  // Alternative field name used by API

  // Market state
  active: boolean;
  closed: boolean;
  end_date_iso?: string;
  endDate?: string;  // Alternative field name

  // Volume and liquidity (all strings)
  volume?: string;
  volume_24hr?: string;
  volume24hr?: string;  // Alternative field name
  liquidity?: string;

  // Metadata
  category?: string;
  tags?: string[];  // May be array or JSON string
  image?: string;  // Alternative field name
  image_url?: string;
  created_at?: string;
  createdAt?: string;  // Alternative field name
  updated_at?: string;
  updatedAt?: string;  // Alternative field name
}

/**
 * Market detail with additional fields
 */
export interface PolymarketMarketDetail extends PolymarketMarket {
  // Additional detail fields
  orderbook?: OrderbookData;
  recent_trades?: PolymarketTrade[];
}

/**
 * Polymarket Tag structure (used in events)
 */
export interface PolymarketTag {
  id: string;
  label: string;  // Display name like "Politics", "Sports", "Crypto"
  slug: string;   // URL-friendly like "politics", "sports", "crypto"
}

/**
 * Polymarket Event structure (contains nested markets)
 * Events are the primary data source - they have tags/categories
 * Markets inherit categories from their parent event
 */
export interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  description?: string;

  // Category data (source of truth)
  category?: string;
  tags?: PolymarketTag[];

  // Nested markets
  markets: PolymarketMarket[];

  // Event metadata
  active: boolean;
  closed: boolean;
  startDate?: string;
  endDate?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Order book data from Polymarket
 */
export interface OrderbookData {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: string;
}

export interface OrderbookLevel {
  price: string;
  size: string;
}

/**
 * Trade data from Polymarket
 */
export interface PolymarketTrade {
  id: string;
  market_id: string;
  outcome: string;
  price: string;
  amount: string;
  side: 'buy' | 'sell';
  timestamp: string;
  maker_address?: string;
  taker_address?: string;
}

// ============================================================================
// Market Analytics Types (from CLOB API)
// ============================================================================

/**
 * Trade analytics aggregated from CLOB API
 * Calculated metrics: trade counts, buyer/seller ratios, momentum, etc.
 */
export interface MarketAnalytics {
  market_id: string;
  condition_id: string;

  // Trade counts (24h window)
  trades_24h: number;
  buyers_24h: number;
  sellers_24h: number;

  // Volume metrics (24h window)
  buy_volume_24h: number;
  sell_volume_24h: number;

  // Sentiment indicators
  buy_sell_ratio: number;  // > 1 = bullish, < 1 = bearish

  // Momentum indicators
  momentum_score: number;  // Price velocity
  price_change_24h: number;  // Percentage change

  // Metadata
  last_aggregated_at: string;
}

// ============================================================================
// Transformed Types (Our Application Schema)
// ============================================================================

/**
 * Transformed market data matching our database schema
 * All numeric fields converted to numbers
 */
export interface CascadianMarket {
  market_id: string;
  title: string;
  description: string;
  category: string;

  // Pricing
  current_price: number;
  volume_24h: number;
  volume_total: number;
  liquidity: number;

  // Market metadata
  active: boolean;
  closed: boolean;
  end_date: Date;
  outcomes: string[];

  // Slugs and URLs
  slug: string;
  image_url?: string;

  // Analytics (optional, joined from market_analytics table)
  analytics?: MarketAnalytics;

  // Raw data for debugging
  raw_data: Record<string, unknown>;

  // Timestamps
  created_at: Date;
  updated_at: Date;
}

/**
 * Sync result from a sync operation
 */
export interface SyncResult {
  success: boolean;
  markets_synced: number;
  errors: SyncError[];
  duration_ms: number;
  timestamp: Date;
}

/**
 * Error during sync operation
 */
export interface SyncError {
  market_id?: string;
  error: string;
  timestamp: Date;
}

// ============================================================================
// API Query Parameters
// ============================================================================

/**
 * Query parameters for market list endpoint
 */
export interface MarketQueryParams {
  category?: string;
  active?: boolean;
  closed?: boolean;
  limit?: number;
  offset?: number;
  sort?: 'volume' | 'liquidity' | 'created_at' | 'momentum' | 'trades';
  include_analytics?: boolean;  // Whether to join analytics data
}

/**
 * Paginated API response
 */
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  stale?: boolean;
  last_synced?: string;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for Polymarket API errors
 */
export class PolymarketError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'PolymarketError';
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends PolymarketError {
  constructor(message = 'Polymarket API rate limit exceeded') {
    super(message, 429, true);
    this.name = 'RateLimitError';
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends PolymarketError {
  constructor(message = 'Request timeout') {
    super(message, 408, true);
    this.name = 'TimeoutError';
  }
}

/**
 * Network error
 */
export class NetworkError extends PolymarketError {
  constructor(message = 'Network error') {
    super(message, undefined, true);
    this.name = 'NetworkError';
  }
}

/**
 * Invalid response error
 */
export class InvalidResponseError extends PolymarketError {
  constructor(message = 'Invalid API response') {
    super(message, undefined, false);
    this.name = 'InvalidResponseError';
  }
}
