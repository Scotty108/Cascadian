/**
 * Hook: useMarketSmartMoney
 *
 * Fetches WIO smart money analysis for a specific market.
 */

import useSWR from 'swr';

export interface MarketSnapshot {
  crowd_odds: number;
  smart_money_odds: number;
  delta: number;
  smart_wallet_count: number;
  smart_holdings_usd: number;
  smart_roi: number;
  dumb_wallet_count: number;
  total_oi: number;
  as_of: string;
}

export interface SmartConsensus {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number;
  yes_wallets: number;
  no_wallets: number;
  yes_credibility_sum: number;
  no_credibility_sum: number;
}

export interface SmartPosition {
  wallet_id: string;
  tier: string;
  credibility_score: number;
  side: string;
  open_shares_net: number;
  open_cost_usd: number;
  avg_entry_price: number;
  unrealized_pnl_usd: number;
}

export interface DotEvent {
  dot_id: string;
  ts: string;
  wallet_id: string;
  action: string;
  side: string;
  size_usd: number;
  dot_type: string;
  confidence: number;
  reason_metrics: string[];
  credibility_score: number;
  entry_price: number;
  crowd_odds: number;
}

interface APIResponse {
  success: boolean;
  market_id: string;
  snapshot: MarketSnapshot | null;
  consensus: SmartConsensus;
  superforecasters: {
    yes_count: number;
    no_count: number;
    yes_positions: SmartPosition[];
    no_positions: SmartPosition[];
  };
  dot_events: DotEvent[];
  smart_positions: SmartPosition[];
  error?: string;
}

const fetcher = async (url: string): Promise<APIResponse> => {
  const response = await fetch(url);
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch smart money data');
  }

  return data;
};

interface UseMarketSmartMoneyOptions {
  marketId: string;
  enabled?: boolean;
}

export function useMarketSmartMoney({
  marketId,
  enabled = true,
}: UseMarketSmartMoneyOptions) {
  const { data, error, isLoading, mutate } = useSWR<APIResponse>(
    enabled && marketId ? `/api/wio/markets/${marketId}/smart-money` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 minute
      errorRetryCount: 2,
    }
  );

  return {
    snapshot: data?.snapshot ?? null,
    consensus: data?.consensus ?? null,
    superforecasters: data?.superforecasters ?? null,
    dotEvents: data?.dot_events ?? [],
    smartPositions: data?.smart_positions ?? [],
    isLoading,
    error,
    mutate,
  };
}

// Formatting helpers
export function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(1)}%`;
}

export function getSignalColor(signal: string): string {
  switch (signal) {
    case 'BULLISH':
      return 'text-emerald-500';
    case 'BEARISH':
      return 'text-rose-500';
    default:
      return 'text-muted-foreground';
  }
}

export function getSignalBgClass(signal: string): string {
  switch (signal) {
    case 'BULLISH':
      return 'bg-emerald-500/10 border-emerald-500/30';
    case 'BEARISH':
      return 'bg-rose-500/10 border-rose-500/30';
    default:
      return 'bg-muted/50 border-border/50';
  }
}
