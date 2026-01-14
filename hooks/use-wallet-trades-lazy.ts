/**
 * Hook: useWalletTradesLazy
 *
 * Lazy-loads wallet trades from WIO API on demand.
 * Only fetches when enabled=true (e.g., when user opens Trades tab).
 */

import useSWR from 'swr';
import { Trade } from './use-wallet-wio';

interface PaginationInfo {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

interface TradesResponse {
  success: boolean;
  trades: Trade[];
  count: number;
  pagination: PaginationInfo;
  error?: string;
}

interface UseWalletTradesLazyOptions {
  walletAddress: string;
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}

const fetcher = async (url: string): Promise<TradesResponse> => {
  const response = await fetch(url);
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch trades');
  }

  return data;
};

export function useWalletTradesLazy({
  walletAddress,
  page = 1,
  pageSize = 50,
  enabled = true,
}: UseWalletTradesLazyOptions) {
  const normalizedAddress = walletAddress?.toLowerCase();

  const { data, error, isLoading, mutate } = useSWR<TradesResponse>(
    enabled && normalizedAddress
      ? `/api/wio/wallet/${normalizedAddress}/trades?page=${page}&pageSize=${pageSize}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 minute
      errorRetryCount: 2,
    }
  );

  return {
    trades: data?.trades ?? [],
    count: data?.count ?? 0,
    pagination: data?.pagination ?? { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 },
    isLoading,
    error,
    mutate,
  };
}
