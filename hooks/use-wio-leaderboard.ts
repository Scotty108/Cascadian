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
  pnl_total_usd: number;
  roi_cost_weighted: number;
  win_rate: number;
  resolved_positions_n: number;
  fills_per_day: number;
  profit_factor: number;
  active_days_n: number;
  days_since_last_trade: number | null;
  avg_win_roi: number;
  avg_loss_roi: number;
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

interface PaginationInfo {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

interface APIResponse {
  success: boolean;
  count: number;
  pagination: PaginationInfo;
  summary: LeaderboardSummary;
  tier_stats: TierStats[];
  leaderboard: LeaderboardEntry[];
  error?: string;
}

export type SortField = 'credibility' | 'pnl' | 'roi' | 'win_rate' | 'positions' | 'activity' | 'profit_factor' | 'avg_win_roi' | 'active_days';
export type SortDirection = 'asc' | 'desc';
export type TierFilter = 'all' | 'superforecaster' | 'smart' | 'profitable' | 'slight_loser' | 'bot';

interface UseWIOLeaderboardOptions {
  page?: number;
  pageSize?: number;
  tier?: TierFilter;
  minPositions?: number;
  minPnl?: number;
  minWinRate?: number | null;
  minROI?: number | null;
  maxDaysSinceLastTrade?: number | null;
  minAvgWinRoi?: number | null;
  maxAvgLossRoi?: number | null;
  minProfitFactor?: number | null;
  minActiveDays?: number | null;
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
  page = 1,
  pageSize = 20,
  tier = 'all',
  minPositions = 10,
  minPnl = 0,
  minWinRate = null,
  minROI = null,
  maxDaysSinceLastTrade = null,
  minAvgWinRoi = null,
  maxAvgLossRoi = null,
  minProfitFactor = null,
  minActiveDays = null,
  sortBy = 'credibility',
  sortDir = 'desc',
  enabled = true,
}: UseWIOLeaderboardOptions = {}) {
  // Build query string
  const params = new URLSearchParams();
  params.set('page', page.toString());
  params.set('pageSize', pageSize.toString());
  params.set('minPositions', minPositions.toString());
  if (minPnl > 0) {
    params.set('minPnl', minPnl.toString());
  }
  if (minWinRate !== null) {
    params.set('minWinRate', minWinRate.toString());
  }
  if (minROI !== null) {
    params.set('minROI', minROI.toString());
  }
  if (maxDaysSinceLastTrade !== null) {
    params.set('maxDaysSinceLastTrade', maxDaysSinceLastTrade.toString());
  }
  if (minAvgWinRoi !== null) {
    params.set('minAvgWinRoi', minAvgWinRoi.toString());
  }
  if (maxAvgLossRoi !== null) {
    params.set('maxAvgLossRoi', maxAvgLossRoi.toString());
  }
  if (minProfitFactor !== null) {
    params.set('minProfitFactor', minProfitFactor.toString());
  }
  if (minActiveDays !== null) {
    params.set('minActiveDays', minActiveDays.toString());
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
    pagination: data?.pagination ?? { page: 1, pageSize: 20, totalCount: 0, totalPages: 0 },
    count: data?.count ?? 0,
    isLoading,
    isValidating, // True when fetching, even with cached data showing
    error,
    mutate,
  };
}

// Tier configuration for display - neutral styling
export const TIER_CONFIG = {
  superforecaster: {
    label: 'Superforecaster',
    shortLabel: 'SF',
    color: '#71717a',
    bgClass: 'bg-muted/50',
    textClass: 'text-foreground',
    borderClass: 'border-border',
    description: 'Top-tier predictors with proven track record',
  },
  smart: {
    label: 'Smart Money',
    shortLabel: 'SM',
    color: '#71717a',
    bgClass: 'bg-muted/50',
    textClass: 'text-foreground',
    borderClass: 'border-border',
    description: 'Consistently profitable with high credibility',
  },
  profitable: {
    label: 'Profitable',
    shortLabel: 'P',
    color: '#71717a',
    bgClass: 'bg-muted/50',
    textClass: 'text-foreground',
    borderClass: 'border-border',
    description: 'Positive returns overall',
  },
  slight_loser: {
    label: 'Slight Loser',
    shortLabel: 'SL',
    color: '#71717a',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
    borderClass: 'border-border',
    description: 'Minor losses, potential for improvement',
  },
  heavy_loser: {
    label: 'Heavy Loser',
    shortLabel: 'HL',
    color: '#71717a',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
    borderClass: 'border-border',
    description: 'Significant losses',
  },
  bot: {
    label: 'Likely Bot',
    shortLabel: 'B',
    color: '#71717a',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
    borderClass: 'border-border',
    description: 'Automated trading patterns detected',
  },
  inactive: {
    label: 'Inactive',
    shortLabel: 'I',
    color: '#71717a',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
    borderClass: 'border-border',
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
  // Neutral styling - no colored badges
  return 'bg-muted/50 text-foreground border-border';
}

export function getPnLTextClass(value: number): string {
  // Subtle coloring - just distinguish positive/negative
  if (value > 0) return 'text-foreground';
  if (value === 0) return 'text-muted-foreground';
  return 'text-muted-foreground';
}

export function getROITextClass(value: number): string {
  // Subtle coloring - just distinguish positive/negative
  if (value >= 0) return 'text-foreground';
  return 'text-muted-foreground';
}
