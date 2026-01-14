/**
 * Data prefetching utilities for navigation
 *
 * Prefetches API data when user hovers over navigation links,
 * so data is ready when they click.
 */

// Track which URLs have been prefetched to avoid duplicates
const prefetchedUrls = new Set<string>();

/**
 * Prefetch an API endpoint in the background
 */
export function prefetchApi(url: string) {
  if (prefetchedUrls.has(url)) return;

  prefetchedUrls.add(url);

  // Use low priority fetch
  fetch(url, {
    priority: 'low',
    cache: 'force-cache',
  }).catch(() => {
    // Remove from set so it can be retried
    prefetchedUrls.delete(url);
  });
}

/**
 * Prefetch data for common pages
 */
export const prefetchRouteData: Record<string, () => void> = {
  '/': () => {
    prefetchApi('/api/screener?limit=50');
  },
  '/events': () => {
    prefetchApi('/api/events?limit=100&sortBy=volume');
  },
  '/discovery/market-insights': () => {
    prefetchApi('/api/markets?limit=100&active=true');
  },
  '/discovery/leaderboard': () => {
    prefetchApi('/api/wio/leaderboard?limit=100');
  },
};

/**
 * Prefetch data for a route when hovering
 */
export function prefetchForRoute(href: string) {
  const prefetcher = prefetchRouteData[href];
  if (prefetcher) {
    prefetcher();
  }
}
