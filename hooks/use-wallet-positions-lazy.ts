/**
 * Hook: useWalletPositionsLazy
 *
 * Lazy-loads wallet positions from WIO API on demand.
 * Only fetches when enabled=true (e.g., when user opens Positions tab).
 */

import useSWR from 'swr';
import { OpenPosition, ClosedPosition } from './use-wallet-wio';

interface PaginationInfo {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

interface PositionsResponse {
  success: boolean;
  open_positions: OpenPosition[];
  open_count: number;
  closed_positions: ClosedPosition[];
  closed_count: number;
  pagination: PaginationInfo;
  error?: string;
}

interface UseWalletPositionsLazyOptions {
  walletAddress: string;
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}

const fetcher = async (url: string): Promise<PositionsResponse> => {
  const response = await fetch(url);
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch positions');
  }

  return data;
};

export function useWalletPositionsLazy({
  walletAddress,
  page = 1,
  pageSize = 50,
  enabled = true,
}: UseWalletPositionsLazyOptions) {
  const normalizedAddress = walletAddress?.toLowerCase();

  const { data, error, isLoading, mutate } = useSWR<PositionsResponse>(
    enabled && normalizedAddress
      ? `/api/wio/wallet/${normalizedAddress}/positions?page=${page}&pageSize=${pageSize}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 minute
      errorRetryCount: 2,
    }
  );

  return {
    openPositions: data?.open_positions ?? [],
    openCount: data?.open_count ?? 0,
    closedPositions: data?.closed_positions ?? [],
    closedCount: data?.closed_count ?? 0,
    pagination: data?.pagination ?? { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 },
    isLoading,
    error,
    mutate,
  };
}
