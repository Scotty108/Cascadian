/**
 * Hook for fetching wallet fingerprint data from WIO
 */

import useSWR from 'swr';

export interface FingerprintMetric {
  name: string;
  key: string;
  raw: number;
  normalized: number;
  displayValue: string;
  percentile: number;
  description: string;
}

export interface WalletFingerprint {
  wallet_id: string;
  window_id: string;
  metrics: FingerprintMetric[];
  overall_score: number;
  tier: string;
  tier_label: string;
  computed_at: string;
}

interface FingerprintResponse {
  success: boolean;
  fingerprint: WalletFingerprint | null;
  error?: string;
}

export type TimeWindow = 'ALL' | '90d' | '30d';

interface UseWalletFingerprintOptions {
  walletAddress: string;
  window?: TimeWindow;
  enabled?: boolean;
}

const fetcher = async (url: string): Promise<FingerprintResponse> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch fingerprint data');
  }
  return res.json();
};

export function useWalletFingerprint({
  walletAddress,
  window = '90d',
  enabled = true,
}: UseWalletFingerprintOptions) {
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(walletAddress);

  const { data, error, isLoading, mutate } = useSWR<FingerprintResponse>(
    enabled && isValidAddress
      ? `/api/wio/wallet-fingerprint/${walletAddress.toLowerCase()}?window=${window}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
      errorRetryCount: 2,
    }
  );

  return {
    fingerprint: data?.fingerprint ?? null,
    metrics: data?.fingerprint?.metrics ?? null,
    overallScore: data?.fingerprint?.overall_score ?? 0,
    tier: data?.fingerprint?.tier ?? 'UNCLASSIFIED',
    tierLabel: data?.fingerprint?.tier_label ?? 'Unclassified',
    isLoading,
    error: error || (data?.error ? new Error(data.error) : null),
    refresh: mutate,
  };
}
