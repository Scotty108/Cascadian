'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Watchlist entry for a strategy
 */
export interface WatchlistEntry {
  id: string;
  workflow_id: string;
  market_id: string;
  added_at: string;
  reason?: string;
  metadata: {
    volume_24h?: number;
    current_price?: number;
    category?: string;
    question?: string;
    liquidity?: number;
    endDate?: string;
  };
}

/**
 * Watchlist response from API
 */
export interface StrategyWatchlistResponse {
  data: WatchlistEntry[];
  metadata: {
    total: number;
    limit: number;
    offset: number;
  };
}

/**
 * Hook to fetch and manage strategy watchlist
 *
 * Provides watchlist management with real-time updates:
 * - List of markets added to watchlist
 * - Market metadata (volume, price, category)
 * - Reason why market was added
 * - Remove individual markets
 * - Clear entire watchlist
 *
 * @param workflowId - The strategy/workflow ID to fetch watchlist for
 * @param options - Query options (limit, offset, refetchInterval)
 * @returns Query result with watchlist data and mutation functions
 */
export function useStrategyWatchlist(
  workflowId: string,
  options?: {
    limit?: number;
    offset?: number;
    enabled?: boolean;
    refetchInterval?: number;
  }
) {
  const queryClient = useQueryClient();
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  const query = useQuery({
    queryKey: ['strategy-watchlist', workflowId, limit, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });

      const response = await fetch(
        `/api/strategies/${workflowId}/watchlist?${params}`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to fetch watchlist: ${response.status}`
        );
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch watchlist');
      }

      return {
        data: data.data as WatchlistEntry[],
        metadata: data.metadata,
      } as StrategyWatchlistResponse;
    },
    refetchInterval: options?.refetchInterval ?? 60000, // Poll every 60 seconds
    enabled: options?.enabled ?? true,
    staleTime: 30000, // Consider data stale after 30 seconds
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const removeMarket = useMutation({
    mutationFn: async (marketId: string) => {
      const response = await fetch(
        `/api/strategies/${workflowId}/watchlist/${marketId}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to remove market: ${response.status}`
        );
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to remove market');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['strategy-watchlist', workflowId],
      });
      queryClient.invalidateQueries({
        queryKey: ['strategy-status', workflowId],
      });
    },
  });

  const clearWatchlist = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/strategies/${workflowId}/watchlist`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to clear watchlist: ${response.status}`
        );
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to clear watchlist');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['strategy-watchlist', workflowId],
      });
      queryClient.invalidateQueries({
        queryKey: ['strategy-status', workflowId],
      });
    },
  });

  return {
    ...query,
    removeMarket,
    clearWatchlist,
  };
}
