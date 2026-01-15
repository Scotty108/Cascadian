/**
 * Hook: usePositionTrades
 *
 * Lazy-loads all trades for a market (both YES and NO outcomes) when expanded.
 * Only fetches when conditionId is provided (non-null).
 */

import useSWR from 'swr';
import type { TradeWithFifo } from '@/lib/pnl/fifoBreakdown';

interface PositionTradesResponse {
  success: boolean;
  trades: TradeWithFifo[];
  trade_count: number;
  error?: string;
}

const fetcher = async (url: string): Promise<PositionTradesResponse> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch position trades');
  }
  return res.json();
};

export function usePositionTrades(
  wallet: string | null,
  conditionId: string | null
) {
  // Only fetch when params are provided (lazy load on expand)
  const shouldFetch = wallet && conditionId !== null;

  const url = shouldFetch
    ? `/api/wio/wallet/${wallet}/position-trades?condition_id=${encodeURIComponent(conditionId)}`
    : null;

  const { data, error, isLoading } = useSWR<PositionTradesResponse>(
    url,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // Cache for 1 minute
    }
  );

  return {
    trades: data?.trades || [],
    tradeCount: data?.trade_count || 0,
    isLoading,
    error: error?.message || data?.error,
  };
}
