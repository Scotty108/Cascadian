/**
 * Polymarket API Utilities
 *
 * Provides robust error handling for Polymarket Gamma API calls,
 * including Cloudflare block detection and rate limiting.
 */

// Cloudflare error detection patterns
const CLOUDFLARE_PATTERNS = [
  '<!DOCTYPE html>',
  'Cloudflare',
  'Attention Required',
  'cf-browser-verification',
  'challenge-platform',
  'Just a moment',
  'checking your browser',
];

/**
 * Check if a response body contains Cloudflare error HTML
 */
export function isCloudflareError(text: string): boolean {
  if (!text || typeof text !== 'string') return false;

  // Quick check - if it starts with HTML, likely Cloudflare
  if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
    return true;
  }

  // Check for specific Cloudflare patterns
  return CLOUDFLARE_PATTERNS.some(pattern =>
    text.includes(pattern)
  );
}

/**
 * Check if response is JSON by content-type header
 */
export function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return contentType?.includes('application/json') ?? false;
}

/**
 * Rate limiter state
 */
interface RateLimiterState {
  requestCount: number;
  windowStart: number;
  lastRequest: number;
}

const rateLimiterState: RateLimiterState = {
  requestCount: 0,
  windowStart: Date.now(),
  lastRequest: 0,
};

// Configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 50; // Conservative limit
const MIN_REQUEST_INTERVAL_MS = 1200; // ~50 req/min

/**
 * Wait for rate limit if needed
 */
export async function waitForRateLimit(): Promise<void> {
  const now = Date.now();

  // Reset window if expired
  if (now - rateLimiterState.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimiterState.requestCount = 0;
    rateLimiterState.windowStart = now;
  }

  // Check if we've exceeded rate limit
  if (rateLimiterState.requestCount >= MAX_REQUESTS_PER_WINDOW) {
    const waitTime = RATE_LIMIT_WINDOW_MS - (now - rateLimiterState.windowStart);
    if (waitTime > 0) {
      console.log(`[api-utils] Rate limit reached, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      rateLimiterState.requestCount = 0;
      rateLimiterState.windowStart = Date.now();
    }
  }

  // Enforce minimum interval between requests
  const timeSinceLastRequest = now - rateLimiterState.lastRequest;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    const waitTime = MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  rateLimiterState.requestCount++;
  rateLimiterState.lastRequest = Date.now();
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt: number, config: Required<RetryConfig>): number {
  const delay = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Fetch from Polymarket API with robust error handling
 *
 * Features:
 * - Cloudflare error detection
 * - Rate limiting
 * - Exponential backoff retry
 * - Content-type validation
 */
export async function fetchPolymarketAPI<T>(
  url: string,
  options?: {
    retryConfig?: RetryConfig;
    timeout?: number;
  }
): Promise<{ data: T | null; error: string | null; isCloudflareBlocked: boolean }> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options?.retryConfig };
  const timeout = options?.timeout ?? 10000;

  let lastError = '';
  let isCloudflareBlocked = false;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Apply rate limiting
      await waitForRateLimit();

      // Make request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Cascadian/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check status code
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;

        // Don't retry on 404
        if (response.status === 404) {
          return { data: null, error: lastError, isCloudflareBlocked: false };
        }

        // Retry on 5xx errors
        if (response.status >= 500) {
          if (attempt < config.maxRetries) {
            const delay = getBackoffDelay(attempt, config);
            console.log(`[api-utils] Server error, retrying in ${delay}ms (attempt ${attempt + 1}/${config.maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        return { data: null, error: lastError, isCloudflareBlocked: false };
      }

      // Get response text first to check for Cloudflare
      const text = await response.text();

      // Check for Cloudflare block
      if (isCloudflareError(text)) {
        isCloudflareBlocked = true;
        lastError = 'Cloudflare block detected - API access temporarily restricted';

        // Retry with longer backoff for Cloudflare blocks
        if (attempt < config.maxRetries) {
          const delay = getBackoffDelay(attempt, config) * 2; // Double delay for CF blocks
          console.log(`[api-utils] Cloudflare block detected, retrying in ${delay}ms (attempt ${attempt + 1}/${config.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        return { data: null, error: lastError, isCloudflareBlocked: true };
      }

      // Parse JSON
      try {
        const data = JSON.parse(text) as T;
        return { data, error: null, isCloudflareBlocked: false };
      } catch (parseError) {
        lastError = `JSON parse error: ${text.slice(0, 100)}...`;
        return { data: null, error: lastError, isCloudflareBlocked: false };
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        lastError = 'Request timeout';
      } else {
        lastError = error.message || 'Unknown error';
      }

      // Retry on network errors
      if (attempt < config.maxRetries) {
        const delay = getBackoffDelay(attempt, config);
        console.log(`[api-utils] Network error, retrying in ${delay}ms: ${lastError}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  return { data: null, error: lastError, isCloudflareBlocked };
}

/**
 * Sanitize error message for display
 *
 * Strips HTML and limits length to prevent UI issues
 */
export function sanitizeErrorMessage(error: string | null | undefined, maxLength = 200): string {
  if (!error) return 'Unknown error';

  // Check if it's HTML (Cloudflare or other)
  if (isCloudflareError(error)) {
    return 'API temporarily unavailable (rate limited)';
  }

  // Strip HTML tags
  const stripped = error.replace(/<[^>]*>/g, '').trim();

  // Limit length
  if (stripped.length > maxLength) {
    return stripped.slice(0, maxLength) + '...';
  }

  return stripped;
}
