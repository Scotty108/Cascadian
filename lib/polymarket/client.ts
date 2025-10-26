/**
 * Polymarket API Client
 *
 * Robust API client with:
 * - Exponential backoff retry logic
 * - Rate limit handling
 * - Timeout handling
 * - Request deduplication
 * - Type transformations
 */

import {
  PolymarketMarket,
  PolymarketEvent,
  CascadianMarket,
  MarketQueryParams,
  RateLimitError,
  TimeoutError,
  NetworkError,
  InvalidResponseError,
  PolymarketError,
} from '@/types/polymarket';
import {
  POLYMARKET_API_URL,
  ENDPOINTS,
  RETRY_CONFIG,
  TIMEOUT_CONFIG,
  DEFAULT_QUERY_PARAMS,
} from './config';
import {
  transformPolymarketMarket,
  transformPolymarketMarkets,
  filterValidMarkets,
  expandEventsToMarkets,
  sleep,
  calculateBackoffDelay,
  isRetryableError,
  getErrorMessage,
} from './utils';

// ============================================================================
// Request Cache (Simple Deduplication)
// ============================================================================

/**
 * In-flight request cache to prevent duplicate requests
 */
const inFlightRequests = new Map<string, Promise<unknown>>();

/**
 * Get or create in-flight request
 */
function deduplicate<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fn().finally(() => {
    inFlightRequests.delete(key);
  });

  inFlightRequests.set(key, promise);
  return promise;
}

// ============================================================================
// Core HTTP Client
// ============================================================================

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    if ((error as Error).name === 'AbortError') {
      throw new TimeoutError(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Make HTTP request with retry logic
 */
async function makeRequest<T>(
  url: string,
  options: RequestInit = {},
  maxRetries?: number
): Promise<T> {
  const retries = maxRetries ?? RETRY_CONFIG.MAX_RETRIES;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Calculate backoff delay for this attempt
      if (attempt > 0) {
        const delay = calculateBackoffDelay(
          attempt - 1,
          RETRY_CONFIG.BASE_DELAY_MS,
          RETRY_CONFIG.MAX_DELAY_MS
        );
        console.log(`[Polymarket] Retry attempt ${attempt} after ${delay}ms`);
        await sleep(delay);
      }

      // Make request with timeout
      const response = await fetchWithTimeout(
        url,
        options,
        TIMEOUT_CONFIG.DEFAULT_TIMEOUT_MS
      );

      // Handle rate limiting
      if (response.status === 429) {
        lastError = new RateLimitError('Rate limit exceeded');
        // Continue to retry with backoff
        continue;
      }

      // Handle other HTTP errors
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        lastError = new PolymarketError(
          `HTTP ${response.status}: ${errorText}`,
          response.status,
          response.status >= 500
        );

        // Retry on server errors
        if (response.status >= 500) {
          continue;
        }

        // Don't retry on client errors (except 429)
        throw lastError;
      }

      // Parse JSON response
      const data = await response.json();
      return data as T;

    } catch (error) {
      lastError = error as Error;

      // Convert to typed errors
      if (error instanceof PolymarketError) {
        // Already typed
      } else if ((error as Error).name === 'AbortError') {
        lastError = new TimeoutError('Request timeout');
      } else if (
        error instanceof TypeError &&
        error.message.includes('fetch')
      ) {
        lastError = new NetworkError('Network request failed');
      }

      // Check if we should retry
      if (!isRetryableError(lastError)) {
        throw lastError;
      }

      // Log retry-worthy errors
      console.warn(
        `[Polymarket] Request failed (attempt ${attempt + 1}/${retries}):`,
        getErrorMessage(lastError)
      );
    }
  }

  // All retries exhausted
  throw lastError || new PolymarketError('Request failed after all retries');
}

// ============================================================================
// Public API Methods
// ============================================================================

/**
 * Fetch markets from Polymarket API
 * Returns transformed CascadianMarket objects
 */
export async function fetchMarkets(
  params: MarketQueryParams = {}
): Promise<CascadianMarket[]> {
  const queryParams = { ...DEFAULT_QUERY_PARAMS, ...params };

  // Build query string
  const searchParams = new URLSearchParams();
  if (queryParams.limit) searchParams.set('limit', queryParams.limit.toString());
  if (queryParams.offset) searchParams.set('offset', queryParams.offset.toString());
  if (queryParams.category) searchParams.set('category', queryParams.category);
  if (queryParams.active !== undefined) {
    searchParams.set('active', queryParams.active.toString());
  }
  if (queryParams.closed !== undefined) {
    searchParams.set('closed', queryParams.closed.toString());
  }

  const url = `${POLYMARKET_API_URL}${ENDPOINTS.MARKETS}?${searchParams}`;
  const cacheKey = `markets:${searchParams.toString()}`;

  try {
    // Deduplicate concurrent requests
    const data = await deduplicate(cacheKey, async () => {
      const response = await makeRequest<unknown>(url);

      // Validate response
      if (!Array.isArray(response)) {
        throw new InvalidResponseError('Expected array of markets');
      }

      return response;
    });

    // Filter and transform markets
    const validMarkets = filterValidMarkets(data as unknown[]);
    const transformedMarkets = transformPolymarketMarkets(validMarkets);

    console.log(
      `[Polymarket] Fetched ${transformedMarkets.length} markets (${validMarkets.length} valid)`
    );

    return transformedMarkets;

  } catch (error) {
    console.error('[Polymarket] Failed to fetch markets:', error);
    throw error;
  }
}

/**
 * Fetch single market by ID
 */
export async function fetchMarket(
  marketId: string
): Promise<CascadianMarket> {
  const url = `${POLYMARKET_API_URL}${ENDPOINTS.MARKET_DETAIL(marketId)}`;
  const cacheKey = `market:${marketId}`;

  try {
    // Deduplicate concurrent requests
    const data = await deduplicate(cacheKey, async () => {
      return await makeRequest<PolymarketMarket>(url);
    });

    // Transform to our schema
    const transformedMarket = transformPolymarketMarket(data as PolymarketMarket);

    console.log(`[Polymarket] Fetched market ${marketId}`);

    return transformedMarket;

  } catch (error) {
    console.error(`[Polymarket] Failed to fetch market ${marketId}:`, error);
    throw error;
  }
}

/**
 * Fetch events from Polymarket API with pagination
 * Events contain nested markets with categories/tags
 *
 * Production pattern: Up to 1000 events in batches of 100
 * Returns events which must be expanded to markets using expandEventsToMarkets()
 */
export async function fetchEvents(): Promise<PolymarketEvent[]> {
  const allEvents: PolymarketEvent[] = [];
  let offset = 0;
  const limit = 100;  // Batch size
  const maxPages = 50;  // Up to 5000 events (raised from 10 to capture all ~3,242 events)
  let pageCount = 0;

  console.log('[Polymarket] Starting event fetch with pagination...');

  while (pageCount < maxPages) {
    // Build query string
    const searchParams = new URLSearchParams();
    searchParams.set('closed', 'false');
    searchParams.set('limit', limit.toString());
    searchParams.set('offset', offset.toString());

    const url = `${POLYMARKET_API_URL}${ENDPOINTS.EVENTS}?${searchParams}`;
    const cacheKey = `events:${searchParams.toString()}`;

    try {
      // Deduplicate concurrent requests
      const data = await deduplicate(cacheKey, async () => {
        const response = await makeRequest<unknown>(url);

        // Validate response
        if (!Array.isArray(response)) {
          throw new InvalidResponseError('Expected array of events');
        }

        return response;
      });

      const events = data as PolymarketEvent[];

      console.log(
        `[Polymarket] Fetched ${events.length} events at offset ${offset}`
      );

      // Stop if no events returned
      if (events.length === 0) {
        break;
      }

      allEvents.push(...events);
      pageCount++;
      offset += limit;

      // Stop if we got fewer events than requested (last page)
      if (events.length < limit) {
        break;
      }

      // Rate limiting between batches (200ms)
      if (pageCount < maxPages && events.length === limit) {
        await sleep(200);
      }

    } catch (error) {
      console.error(`[Polymarket] Failed to fetch events at offset ${offset}:`, error);
      throw error;
    }
  }

  console.log(`[Polymarket] Fetched total of ${allEvents.length} events`);

  return allEvents;
}

/**
 * Fetch all active markets (no pagination limit)
 * Used for sync operations
 *
 * Now uses /events endpoint and expands to markets with proper categories
 */
export async function fetchAllActiveMarkets(): Promise<CascadianMarket[]> {
  console.log('[Polymarket] Fetching all active markets via events endpoint...');

  try {
    // Step 1: Fetch events with pagination (up to 1000 events)
    const events = await fetchEvents();

    console.log(`[Polymarket] Expanding ${events.length} events to markets...`);

    // Step 2: Expand events → markets with inherited categories
    const marketsWithCategories = expandEventsToMarkets(events);

    console.log(`[Polymarket] Expanded to ${marketsWithCategories.length} markets`);

    // Step 3: Transform to CascadianMarket schema
    const transformedMarkets = transformPolymarketMarkets(marketsWithCategories);

    console.log(`[Polymarket] Successfully transformed ${transformedMarkets.length} markets with categories`);

    return transformedMarkets;

  } catch (error) {
    console.error('[Polymarket] Failed to fetch markets via events:', error);
    throw error;
  }
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check if Polymarket API is accessible
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const url = `${POLYMARKET_API_URL}${ENDPOINTS.MARKETS}?limit=1`;
    await makeRequest<unknown>(url, {}, 1);  // Single attempt only
    return true;
  } catch (error) {
    console.error('[Polymarket] Health check failed:', error);
    return false;
  }
}
