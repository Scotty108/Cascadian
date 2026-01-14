/**
 * Hook: useWalletWIO
 *
 * Fetches comprehensive wallet profile from WIO API.
 * Single source of truth for all wallet data.
 */

import useSWR from 'swr';

// Type definitions matching API response
export interface WalletScore {
  credibility_score: number;
  bot_likelihood: number;
  copyability_score: number;
  skill_component: number;
  consistency_component: number;
  sample_size_factor: number;
  fill_rate_signal: number;
  scalper_signal: number;
  horizon_component: number;
  risk_component: number;
  window_id: string;
}

export interface WalletClassification {
  tier: 'superforecaster' | 'smart' | 'profitable' | 'slight_loser' | 'heavy_loser' | 'bot' | 'inactive';
  roi_cost_weighted: number;
  win_rate: number;
  pnl_total_usd: number;
  resolved_positions_n: number;
  fills_per_day: number;
  credibility_score: number;
  bot_likelihood: number;
}

export interface WalletMetrics {
  scope_type: string;
  scope_id: string;
  window_id: string;
  positions_n: number;
  resolved_positions_n: number;
  fills_n: number;
  active_days_n: number;
  wallet_age_days: number | null;
  days_since_last_trade: number | null;
  roi_cost_weighted: number;
  pnl_total_usd: number;
  roi_p50: number;
  roi_p05: number;
  roi_p95: number;
  win_rate: number;
  avg_win_roi: number;
  avg_loss_roi: number;
  profit_factor: number;
  max_drawdown_usd: number;
  cvar_95_roi: number;
  max_loss_roi: number;
  loss_streak_max: number;
  hold_minutes_p50: number;
  pct_held_to_resolve: number;
  time_to_resolve_hours_p50: number;
  clv_4h_cost_weighted: number;
  clv_24h_cost_weighted: number;
  clv_72h_cost_weighted: number;
  clv_24h_win_rate: number;
  brier_mean: number;
  brier_vs_crowd: number;
  sharpness: number;
  calibration_gap: number;
  market_hhi_cost: number;
  position_cost_p50: number;
  position_cost_p90: number;
  fills_per_day: number;
}

export interface OpenPosition {
  market_id: string;
  question: string;
  category: string;
  side: string;
  open_shares_net: number;
  open_cost_usd: number;
  avg_entry_price: number;
  mark_price: number;
  unrealized_pnl_usd: number;
  unrealized_roi: number;
  bundle_id: string;
  as_of_ts: string;
  image_url: string | null;
}

export interface ClosedPosition {
  position_id: string;
  market_id: string;
  question: string;
  category: string;
  side: string;
  cost_usd: number;
  proceeds_usd: number;
  pnl_usd: number;
  roi: number;
  hold_minutes: number;
  brier_score: number | null;
  is_resolved: number;
  ts_open: string;
  ts_close: string | null;
  ts_resolve: string | null;
  image_url: string | null;
}

export interface DotEvent {
  dot_id: string;
  ts: string;
  market_id: string;
  question: string;
  action: 'ENTER' | 'EXIT' | 'ADD' | 'REDUCE' | 'FLIP';
  side: string;
  size_usd: number;
  dot_type: 'SUPERFORECASTER' | 'INSIDER' | 'SMART_MONEY';
  confidence: number;
  reason_metrics: string[];
  entry_price: number;
  crowd_odds: number;
}

export interface BubbleChartPosition {
  category: string;
  market_id: string;
  question: string;
  side: string;
  cost_usd: number;
  pnl_usd: number;
  roi: number;
  positions_count: number;
}

export interface Trade {
  event_id: string;
  side: string;
  amount_usd: number;
  shares: number;
  price: number;
  action: string;
  trade_time: string;
  token_id: string;
  question?: string;
  image_url?: string;
}

export interface CategoryStats {
  category: string;
  positions: number;
  wins: number;
  losses: number;
  win_rate: number;
  pnl_usd: number;
  avg_roi: number;
}

export interface CategoryMetrics {
  scope_id: string;
  bundle_name: string;
  positions_n: number;
  resolved_positions_n: number;
  pnl_total_usd: number;
  roi_cost_weighted: number;
  win_rate: number;
  brier_mean: number;
}

export interface WalletWIOProfile {
  wallet_id: string;
  score: WalletScore | null;
  classification: WalletClassification | null;
  metrics: {
    global: WalletMetrics | null;
    all_windows: WalletMetrics[];
  };
  category_metrics: CategoryMetrics[];
  category_stats: CategoryStats[];
  realized_pnl: number;
  open_positions: OpenPosition[];
  recent_positions: ClosedPosition[];
  recent_trades: Trade[];
  dot_events: DotEvent[];
  bubble_chart_data: BubbleChartPosition[];
  computed_at: string;
}

interface APIResponse {
  success: boolean;
  profile: WalletWIOProfile;
  error?: string;
}

const fetcher = async (url: string): Promise<WalletWIOProfile | null> => {
  const response = await fetch(url);
  const data: APIResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch wallet data');
  }

  return data.profile;
};

export type TimeWindow = 'ALL' | '90d' | '30d';

interface UseWalletWIOOptions {
  walletAddress: string;
  window?: TimeWindow;
  enabled?: boolean;
}

export function useWalletWIO({
  walletAddress,
  window = 'ALL',
  enabled = true
}: UseWalletWIOOptions) {
  const normalizedAddress = walletAddress?.toLowerCase();

  const { data, error, isLoading, mutate } = useSWR<WalletWIOProfile | null>(
    enabled && normalizedAddress
      ? `/api/wio/wallet/${normalizedAddress}?window=${window}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 minute
      errorRetryCount: 2,
    }
  );

  return {
    profile: data,
    isLoading,
    error,
    mutate,
    // Convenience accessors
    score: data?.score ?? null,
    classification: data?.classification ?? null,
    metrics: data?.metrics?.global ?? null,
    allMetrics: data?.metrics?.all_windows ?? [],
    categoryMetrics: data?.category_metrics ?? [],
    categoryStats: data?.category_stats ?? [],
    realizedPnl: data?.realized_pnl ?? 0,
    openPositions: data?.open_positions ?? [],
    recentPositions: data?.recent_positions ?? [],
    recentTrades: data?.recent_trades ?? [],
    dotEvents: data?.dot_events ?? [],
    bubbleChartData: data?.bubble_chart_data ?? [],
  };
}

// Tier display helpers
export const TIER_CONFIG = {
  superforecaster: {
    label: 'Superforecaster',
    color: '#7C3AED', // purple-600
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500',
    textColor: 'text-purple-500',
  },
  smart: {
    label: 'Smart Money',
    color: '#00E0AA', // brand green
    bgColor: 'bg-[#00E0AA]/10',
    borderColor: 'border-[#00E0AA]',
    textColor: 'text-[#00E0AA]',
  },
  profitable: {
    label: 'Profitable',
    color: '#3B82F6', // blue-500
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500',
    textColor: 'text-blue-500',
  },
  slight_loser: {
    label: 'Slight Loser',
    color: '#F59E0B', // amber-500
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500',
    textColor: 'text-amber-500',
  },
  heavy_loser: {
    label: 'Heavy Loser',
    color: '#EF4444', // red-500
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500',
    textColor: 'text-red-500',
  },
  bot: {
    label: 'Likely Bot',
    color: '#6B7280', // gray-500
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500',
    textColor: 'text-gray-500',
  },
  inactive: {
    label: 'Inactive',
    color: '#374151', // gray-700
    bgColor: 'bg-gray-700/10',
    borderColor: 'border-gray-700',
    textColor: 'text-gray-400',
  },
} as const;

export function getTierConfig(tier: WalletClassification['tier'] | undefined) {
  if (!tier) return TIER_CONFIG.inactive;
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

export function formatPercent(value: number, decimals: number = 1): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(decimals)}%`;
}

export function formatCredibility(score: number): string {
  if (score >= 0.7) return 'Highly Credible';
  if (score >= 0.5) return 'Credible';
  if (score >= 0.3) return 'Moderate';
  return 'Low';
}

export function getCredibilityColor(score: number): string {
  if (score >= 0.7) return 'text-green-500';
  if (score >= 0.5) return 'text-blue-500';
  if (score >= 0.3) return 'text-amber-500';
  return 'text-red-500';
}
