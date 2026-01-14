/**
 * Hook: useWIOLeaderboard
 *
 * Fetches unified leaderboard data from WIO API.
 */

import useSWR from 'swr';

// Type definitions matching API response
export interface LeaderboardEntry {
  rank: number;
  wallet_id: string;
  tier: 'superforecaster' | 'smart' | 'profitable' | 'slight_loser' | 'heavy_loser' | 'bot' | 'inactive';
  credibility_score: number;
  bot_likelihood: number;
  copyability_score: number;
  pnl_total_usd: number;
  roi_cost_weighted: number;
  win_rate: number;
  resolved_positions_n: number;
  fills_per_day: number;
  profit_factor: number;
  brier_mean: number;
  active_days_n: number;
  days_since_last_trade: number | null;
}

export interface TierStats {
  tier: string;
  count: number;
  total_pnl: number;
  avg_roi: number;
  avg_win_rate: number;
}

export interface LeaderboardSummary {
  total_qualified_wallets: number;
  superforecasters: number;
  smart_money: number;
  profitable: number;
  min_positions_filter: number;
}

interface APIResponse {
  success: boolean;
  count: number;
  summary: LeaderboardSummary;
  tier_stats: TierStats[];
  leaderboard: LeaderboardEntry[];
  error?: string;
}

export type SortField = 'credibility' | 'pnl' | 'roi' | 'win_rate' | 'positions';
export type SortDirection = 'asc' | 'desc';
export type TierFilter = 'all' | 'superforecaster' | 'smart' | 'profitable' | 'slight_loser' | 'bot';

interface UseWIOLeaderboardOptions {
  limit?: number;
  tier?: TierFilter;
  minPositions?: number;
  minPnl?: number;
  sortBy?: SortField;
  sortDir?: SortDirection;
  enabled?: boolean;
}

const fetcher = async (url: string): Promise<APIResponse> => {
  const response = await fetch(url);
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch leaderboard');
  }

  return data;
};

export function useWIOLeaderboard({
  limit = 100,
  tier = 'all',
  minPositions = 10,
  minPnl = 0,
  sortBy = 'credibility',
  sortDir = 'desc',
  enabled = true,
}: UseWIOLeaderboardOptions = {}) {
  // Build query string
  const params = new URLSearchParams();
  params.set('limit', limit.toString());
  params.set('minPositions', minPositions.toString());
  if (minPnl > 0) {
    params.set('minPnl', minPnl.toString());
  }
  params.set('sortBy', sortBy);
  params.set('sortDir', sortDir);
  if (tier !== 'all') {
    params.set('tier', tier);
  }

  const { data, error, isLoading, isValidating, mutate } = useSWR<APIResponse>(
    enabled ? `/api/wio/leaderboard?${params.toString()}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 5 * 60 * 1000, // 5 minutes
      errorRetryCount: 2,
      keepPreviousData: true, // Show old data while loading new
    }
  );

  return {
    leaderboard: data?.leaderboard ?? [],
    summary: data?.summary ?? null,
    tierStats: data?.tier_stats ?? [],
    count: data?.count ?? 0,
    isLoading,
    isValidating, // True when fetching, even with cached data showing
    error,
    mutate,
  };
}

// Tier configuration for display
export const TIER_CONFIG = {
  superforecaster: {
    label: 'Superforecaster',
    shortLabel: 'SF',
    color: '#7C3AED',
    bgClass: 'bg-purple-500/10',
    textClass: 'text-purple-400',
    borderClass: 'border-purple-500/30',
    description: 'Top-tier predictors with proven track record',
  },
  smart: {
    label: 'Smart Money',
    shortLabel: 'SM',
    color: '#00E0AA',
    bgClass: 'bg-[#00E0AA]/10',
    textClass: 'text-[#00E0AA]',
    borderClass: 'border-[#00E0AA]/30',
    description: 'Consistently profitable with high credibility',
  },
  profitable: {
    label: 'Profitable',
    shortLabel: 'P',
    color: '#3B82F6',
    bgClass: 'bg-blue-500/10',
    textClass: 'text-blue-400',
    borderClass: 'border-blue-500/30',
    description: 'Positive returns overall',
  },
  slight_loser: {
    label: 'Slight Loser',
    shortLabel: 'SL',
    color: '#F59E0B',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
    description: 'Minor losses, potential for improvement',
  },
  heavy_loser: {
    label: 'Heavy Loser',
    shortLabel: 'HL',
    color: '#EF4444',
    bgClass: 'bg-red-500/10',
    textClass: 'text-red-400',
    borderClass: 'border-red-500/30',
    description: 'Significant losses',
  },
  bot: {
    label: 'Likely Bot',
    shortLabel: 'B',
    color: '#6B7280',
    bgClass: 'bg-gray-500/10',
    textClass: 'text-gray-400',
    borderClass: 'border-gray-500/30',
    description: 'Automated trading patterns detected',
  },
  inactive: {
    label: 'Inactive',
    shortLabel: 'I',
    color: '#374151',
    bgClass: 'bg-gray-700/10',
    textClass: 'text-gray-500',
    borderClass: 'border-gray-700/30',
    description: 'No recent activity',
  },
} as const;

export function getTierConfig(tier: LeaderboardEntry['tier']) {
  return TIER_CONFIG[tier] || TIER_CONFIG.inactive;
}

// Formatting helpers
export function formatPnL(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '' : '-';
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

export function formatCredibility(score: number): string {
  return `${(score * 100).toFixed(0)}%`;
}

export function getCredibilityBadgeClass(score: number): string {
  if (score >= 0.7) return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
  if (score >= 0.5) return 'bg-[#00E0AA]/15 text-[#00E0AA] border-[#00E0AA]/30';
  if (score >= 0.3) return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
  return 'bg-gray-500/15 text-gray-400 border-gray-500/30';
}

export function getPnLTextClass(value: number): string {
  if (value >= 100000) return 'text-emerald-400 font-semibold';
  if (value > 0) return 'text-emerald-300';
  if (value === 0) return 'text-muted-foreground';
  if (value > -10000) return 'text-amber-400';
  return 'text-red-400 font-semibold';
}

export function getROITextClass(value: number): string {
  if (value >= 0.5) return 'text-emerald-400 font-semibold';
  if (value >= 0.1) return 'text-emerald-300';
  if (value >= 0) return 'text-muted-foreground';
  if (value > -0.2) return 'text-amber-400';
  return 'text-red-400 font-semibold';
}
