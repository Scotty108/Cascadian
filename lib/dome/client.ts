/**
 * ============================================================================
 * DOME API CLIENT - MARKET DATA LAYER
 * ============================================================================
 *
 * Comprehensive client for fetching market data from Dome API.
 * This client handles:
 * - Market discovery and filtering
 * - Historical candlestick data
 * - Real-time market prices
 * - Trade history
 *
 * ENVIRONMENT VARIABLES:
 * - DOME_API_KEY: Required. Dome API bearer token.
 *
 * Terminal: Claude 2 (Strategy Builder Data Layer)
 * Date: 2025-12-07
 */

// ============================================================================
// Types
// ============================================================================

export interface DomeMarket {
  market_slug: string;
  condition_id: string;
  title: string;
  status: 'open' | 'closed';
  start_time?: number;
  end_time?: number;
  tags?: string[];
  volume?: number;
  side_a?: string;
  side_b?: string;
  winning_side?: string;
  event_slug?: string;
}

export interface DomePagination {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
}

export interface DomeMarketsResponse {
  markets: DomeMarket[];
  pagination: DomePagination;
}

export interface DomeMarketFilters {
  market_slug?: string[];
  event_slug?: string[];
  condition_id?: string[];
  tags?: string[];
  status?: 'open' | 'closed';
  min_volume?: number;
  limit?: number;
  offset?: number;
  start_time?: number;
  end_time?: number;
}

export interface DomeCandlePrice {
  open: number;
  high: number;
  low: number;
  close: number;
  open_dollars?: string;
  high_dollars?: string;
  low_dollars?: string;
  close_dollars?: string;
}

export interface DomeCandleBidAsk {
  open: number;
  close: number;
  high: number;
  low: number;
}

export interface DomeCandle {
  end_period_ts: number;
  open_interest?: number;
  price: DomeCandlePrice;
  volume?: number;
  yes_ask?: DomeCandleBidAsk;
  yes_bid?: DomeCandleBidAsk;
}

export interface DomeCandlesResponse {
  candlesticks: Array<[DomeCandle[], { token_id: string }]>;
}

export interface DomeMarketPrice {
  price: number;
  at_time: number;
}

export interface DomeOrder {
  token_id: string;
  token_label: string;
  side: 'BUY' | 'SELL';
  market_slug: string;
  condition_id: string;
  shares: number;
  shares_normalized: number;
  price: number;
  tx_hash?: string;
  title?: string;
  timestamp: number;
  order_hash?: string;
  user?: string;
  taker?: string;
}

export interface DomeOrdersResponse {
  orders: DomeOrder[];
  pagination: DomePagination;
}

export interface DomeTradeFilters {
  market_slug?: string;
  condition_id?: string;
  token_id?: string;
  user?: string;
  start_time?: number;
  end_time?: number;
  limit?: number;
  offset?: number;
}

export type CandleInterval = 1 | 60 | 1440; // 1m, 1h, 1d

export interface DomeClientResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  source: 'dome';
}

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = 'https://api.domeapi.io/v1';

function getApiKey(): string | null {
  return process.env.DOME_API_KEY || null;
}

function getHeaders(): HeadersInit {
  const apiKey = getApiKey();
  return {
    'Authorization': apiKey ? `Bearer ${apiKey}` : '',
    'Content-Type': 'application/json',
  };
}

// ============================================================================
// In-Memory Cache
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const marketCache = new Map<string, CacheEntry<DomeMarket[]>>();
const priceCache = new Map<string, CacheEntry<DomeMarketPrice>>();
const CACHE_TTL_MS = 60000; // 1 minute

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// ============================================================================
// API Methods
// ============================================================================

/**
 * List markets with filtering support
 */
export async function listMarkets(
  filters: DomeMarketFilters = {}
): Promise<DomeClientResult<DomeMarketsResponse>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: 'DOME_API_KEY environment variable not set',
      source: 'dome',
    };
  }

  // Build query string
  const params = new URLSearchParams();

  if (filters.market_slug?.length) {
    filters.market_slug.forEach(slug => params.append('market_slug', slug));
  }
  if (filters.event_slug?.length) {
    filters.event_slug.forEach(slug => params.append('event_slug', slug));
  }
  if (filters.condition_id?.length) {
    filters.condition_id.forEach(id => params.append('condition_id', id));
  }
  if (filters.tags?.length) {
    filters.tags.forEach(tag => params.append('tags', tag));
  }
  if (filters.status) {
    params.append('status', filters.status);
  }
  if (filters.min_volume !== undefined) {
    params.append('min_volume', String(filters.min_volume));
  }
  if (filters.limit !== undefined) {
    params.append('limit', String(Math.min(filters.limit, 100)));
  }
  if (filters.offset !== undefined) {
    params.append('offset', String(filters.offset));
  }
  if (filters.start_time !== undefined) {
    params.append('start_time', String(filters.start_time));
  }
  if (filters.end_time !== undefined) {
    params.append('end_time', String(filters.end_time));
  }

  const url = `${BASE_URL}/polymarket/markets?${params.toString()}`;

  try {
    const response = await fetch(url, { headers: getHeaders() });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        source: 'dome',
      };
    }

    const data = await response.json() as DomeMarketsResponse;

    return {
      success: true,
      data,
      source: 'dome',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      source: 'dome',
    };
  }
}

/**
 * Get candlestick data for a market
 */
export async function getCandles(
  conditionId: string,
  interval: CandleInterval,
  startTime: number,
  endTime: number
): Promise<DomeClientResult<DomeCandlesResponse>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: 'DOME_API_KEY environment variable not set',
      source: 'dome',
    };
  }

  // Validate time ranges based on interval
  const rangeSeconds = endTime - startTime;
  const maxRanges: Record<CandleInterval, number> = {
    1: 7 * 24 * 3600, // 1 week for 1m
    60: 30 * 24 * 3600, // 1 month for 1h
    1440: 365 * 24 * 3600, // 1 year for 1d
  };

  if (rangeSeconds > maxRanges[interval]) {
    return {
      success: false,
      error: `Time range exceeds maximum for interval ${interval}: ${maxRanges[interval]} seconds`,
      source: 'dome',
    };
  }

  const params = new URLSearchParams({
    start_time: String(startTime),
    end_time: String(endTime),
    interval: String(interval),
  });

  const url = `${BASE_URL}/polymarket/candlesticks/${conditionId}?${params.toString()}`;

  try {
    const response = await fetch(url, { headers: getHeaders() });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        source: 'dome',
      };
    }

    const data = await response.json() as DomeCandlesResponse;

    return {
      success: true,
      data,
      source: 'dome',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      source: 'dome',
    };
  }
}

/**
 * Get current market price by token ID
 */
export async function getMarketPrice(
  tokenId: string,
  atTime?: number
): Promise<DomeClientResult<DomeMarketPrice>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: 'DOME_API_KEY environment variable not set',
      source: 'dome',
    };
  }

  // Check cache for real-time prices
  if (!atTime) {
    const cached = getCached(priceCache, tokenId);
    if (cached) {
      return {
        success: true,
        data: cached,
        source: 'dome',
      };
    }
  }

  const params = new URLSearchParams();
  if (atTime !== undefined) {
    params.append('at_time', String(atTime));
  }

  const queryString = params.toString();
  const url = `${BASE_URL}/polymarket/market-price/${tokenId}${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, { headers: getHeaders() });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        source: 'dome',
      };
    }

    const data = await response.json() as DomeMarketPrice;

    // Cache real-time prices
    if (!atTime) {
      setCache(priceCache, tokenId, data);
    }

    return {
      success: true,
      data,
      source: 'dome',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      source: 'dome',
    };
  }
}

/**
 * Get trade history with filtering
 */
export async function getTradeHistory(
  filters: DomeTradeFilters = {}
): Promise<DomeClientResult<DomeOrdersResponse>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: 'DOME_API_KEY environment variable not set',
      source: 'dome',
    };
  }

  const params = new URLSearchParams();

  if (filters.market_slug) {
    params.append('market_slug', filters.market_slug);
  }
  if (filters.condition_id) {
    params.append('condition_id', filters.condition_id);
  }
  if (filters.token_id) {
    params.append('token_id', filters.token_id);
  }
  if (filters.user) {
    params.append('user', filters.user);
  }
  if (filters.start_time !== undefined) {
    params.append('start_time', String(filters.start_time));
  }
  if (filters.end_time !== undefined) {
    params.append('end_time', String(filters.end_time));
  }
  if (filters.limit !== undefined) {
    params.append('limit', String(Math.min(filters.limit, 1000)));
  }
  if (filters.offset !== undefined) {
    params.append('offset', String(filters.offset));
  }

  const url = `${BASE_URL}/polymarket/orders?${params.toString()}`;

  try {
    const response = await fetch(url, { headers: getHeaders() });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        source: 'dome',
      };
    }

    const data = await response.json() as DomeOrdersResponse;

    return {
      success: true,
      data,
      source: 'dome',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      source: 'dome',
    };
  }
}

// ============================================================================
// Cache Management
// ============================================================================

export function clearMarketCache(): void {
  marketCache.clear();
}

export function clearPriceCache(): void {
  priceCache.clear();
}

export function clearAllCaches(): void {
  marketCache.clear();
  priceCache.clear();
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Flatten candlestick response to a simpler array format
 */
export function flattenCandles(response: DomeCandlesResponse): Array<{
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  tokenId: string;
}> {
  const result: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    tokenId: string;
  }> = [];

  for (const [candles, meta] of response.candlesticks) {
    for (const candle of candles) {
      result.push({
        timestamp: candle.end_period_ts,
        open: candle.price.open || parseFloat(candle.price.open_dollars || '0'),
        high: candle.price.high || parseFloat(candle.price.high_dollars || '0'),
        low: candle.price.low || parseFloat(candle.price.low_dollars || '0'),
        close: candle.price.close || parseFloat(candle.price.close_dollars || '0'),
        volume: candle.volume,
        tokenId: meta.token_id,
      });
    }
  }

  return result.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Calculate simple statistics from candles
 */
export function calculateCandleStats(candles: ReturnType<typeof flattenCandles>): {
  trendSlope: number;
  recentVolatility: number;
  priceChange: number;
  priceChangePercent: number;
} {
  if (candles.length < 2) {
    return {
      trendSlope: 0,
      recentVolatility: 0,
      priceChange: 0,
      priceChangePercent: 0,
    };
  }

  // Price change
  const firstClose = candles[0].close;
  const lastClose = candles[candles.length - 1].close;
  const priceChange = lastClose - firstClose;
  const priceChangePercent = firstClose > 0 ? (priceChange / firstClose) * 100 : 0;

  // Simple linear regression for trend slope
  const n = candles.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += candles[i].close;
    sumXY += i * candles[i].close;
    sumXX += i * i;
  }
  const trendSlope = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) : 0;

  // Volatility (standard deviation of returns)
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0) {
      returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }
  }

  let recentVolatility = 0;
  if (returns.length > 0) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    recentVolatility = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / returns.length);
  }

  return {
    trendSlope,
    recentVolatility,
    priceChange,
    priceChangePercent,
  };
}

// ============================================================================
// Default Export
// ============================================================================

export const domeMarketClient = {
  listMarkets,
  getCandles,
  getMarketPrice,
  getTradeHistory,
  flattenCandles,
  calculateCandleStats,
  clearMarketCache,
  clearPriceCache,
  clearAllCaches,
};
