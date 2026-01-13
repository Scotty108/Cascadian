/**
 * Hook: useEvents
 *
 * Fetches events from ClickHouse-backed /api/events endpoint.
 * Replaces the old usePolymarketEvents hook that called Gamma API.
 */

import useSWR from 'swr';

export interface Event {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  image: string | null;
  marketCount: number;
  volume: number;
  liquidity: number;
  endDate: string | null;
  activeMarkets: number;
  isActive: boolean;
}

export interface CategoryStats {
  category: string;
  count: number;
}

interface APIResponse {
  success: boolean;
  data: Event[];
  total: number;
  categories: CategoryStats[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  error?: string;
}

export type SortBy = 'volume' | 'liquidity' | 'markets' | 'ending';

interface UseEventsOptions {
  limit?: number;
  offset?: number;
  category?: string;
  active?: boolean;
  sortBy?: SortBy;
  enabled?: boolean;
}

const fetcher = async (url: string): Promise<APIResponse> => {
  const response = await fetch(url);
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch events');
  }

  return data;
};

export function useEvents({
  limit = 100,
  offset = 0,
  category,
  active = true,
  sortBy = 'volume',
  enabled = true,
}: UseEventsOptions = {}) {
  // Build query string
  const params = new URLSearchParams();
  params.set('limit', limit.toString());
  params.set('offset', offset.toString());
  params.set('sortBy', sortBy);
  params.set('active', active.toString());
  if (category) {
    params.set('category', category);
  }

  const { data, error, isLoading, mutate } = useSWR<APIResponse>(
    enabled ? `/api/events?${params.toString()}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 minute
      errorRetryCount: 2,
    }
  );

  return {
    events: data?.data ?? [],
    total: data?.total ?? 0,
    categories: data?.categories ?? [],
    pagination: data?.pagination ?? { limit, offset, hasMore: false },
    isLoading,
    error,
    mutate,
  };
}

// Category color mapping for consistent styling
export const CATEGORY_COLORS: Record<string, string> = {
  Politics: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  Sports: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  Crypto: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  Tech: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
  Entertainment: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20',
  Finance: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  World: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
  Culture: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  Economy: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  Other: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20',
};

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
}

// Formatting helpers
export function formatVolume(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatLiquidity(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

// Calculate urgency score based on end date
export function calculateUrgencyScore(endDate: string | null): number {
  if (!endDate) return 0;

  const now = new Date().getTime();
  const end = new Date(endDate).getTime();
  const hoursUntilEnd = (end - now) / (1000 * 60 * 60);

  if (hoursUntilEnd < 0) return 0; // Already ended
  if (hoursUntilEnd < 24) return 95; // Less than 24 hours
  if (hoursUntilEnd < 48) return 90; // 24-48 hours
  if (hoursUntilEnd < 168) return 80; // Less than a week
  if (hoursUntilEnd < 720) return 70; // Less than a month
  return 60; // More than a month
}
