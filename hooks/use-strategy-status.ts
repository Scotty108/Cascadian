'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Strategy status response from API
 */
export interface StrategyStatusData {
  id: string;
  name: string;
  status: 'running' | 'paused' | 'stopped' | 'error';
  auto_run: boolean;
  execution_interval_minutes: number;
  last_executed_at: string | null;
  next_execution_at: string | null;
  execution_count: number;
  success_count: number;
  error_count: number;
  success_rate: number;
  average_execution_time_ms: number;
  uptime_seconds: number;
  watchlist_size: number;
  active_trades: number;
}

/**
 * Hook to fetch and poll strategy status
 *
 * Provides real-time status updates for an autonomous strategy including:
 * - Current status (running, paused, stopped, error)
 * - Execution metrics (count, success rate, uptime)
 * - Next execution timing
 * - Watchlist and trade counts
 *
 * @param workflowId - The strategy/workflow ID to monitor
 * @param options - Query options (refetchInterval defaults to 30s)
 * @returns Query result with strategy status data
 */
export function useStrategyStatus(
  workflowId: string,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
  }
) {
  return useQuery({
    queryKey: ['strategy-status', workflowId],
    queryFn: async () => {
      const response = await fetch(`/api/strategies/${workflowId}/status`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch strategy status: ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch strategy status');
      }

      return data.data as StrategyStatusData;
    },
    refetchInterval: options?.refetchInterval ?? 30000, // Poll every 30 seconds by default
    enabled: options?.enabled ?? true,
    staleTime: 15000, // Consider data stale after 15 seconds
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}
