'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Single strategy execution record
 */
export interface StrategyExecution {
  id: string;
  workflow_id: string;
  executed_at: string;
  status: 'completed' | 'failed' | 'running';
  duration_ms: number;
  nodes_executed: number;
  outputs: Record<string, any>;
  error_message?: string;
  summary: string;
}

/**
 * Execution history response from API
 */
export interface StrategyExecutionsResponse {
  data: StrategyExecution[];
  metadata: {
    total: number;
    limit: number;
    offset: number;
  };
}

/**
 * Hook to fetch and poll strategy execution history
 *
 * Provides recent execution logs with real-time updates:
 * - Last 50 executions (configurable)
 * - Success/failure status
 * - Execution duration and node count
 * - Error details for failed executions
 * - Summary of what the execution did
 *
 * @param workflowId - The strategy/workflow ID to fetch executions for
 * @param options - Query options (limit, offset, refetchInterval)
 * @returns Query result with execution history
 */
export function useStrategyExecutions(
  workflowId: string,
  options?: {
    limit?: number;
    offset?: number;
    enabled?: boolean;
    refetchInterval?: number;
  }
) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return useQuery({
    queryKey: ['strategy-executions', workflowId, limit, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });

      const response = await fetch(
        `/api/strategies/${workflowId}/executions?${params}`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to fetch executions: ${response.status}`
        );
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch executions');
      }

      return {
        data: data.data as StrategyExecution[],
        metadata: data.metadata,
      } as StrategyExecutionsResponse;
    },
    refetchInterval: options?.refetchInterval ?? 30000, // Poll every 30 seconds
    enabled: options?.enabled ?? true,
    staleTime: 15000, // Consider data stale after 15 seconds
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}
