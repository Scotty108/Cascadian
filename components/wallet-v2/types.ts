/**
 * Type definitions for Wallet V2 components
 */

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

export type ChartVariant = 'radar' | 'polar' | 'hexagon';

export interface FingerprintChartProps {
  metrics: FingerprintMetric[];
  size?: number;
  animated?: boolean;
}

// Color palette for metrics (matches Tailwind/shadcn chart colors)
export const METRIC_COLORS = {
  credibility: '#00E0AA', // Primary accent (teal)
  win_rate: '#3B82F6',    // Blue
  roi: '#8B5CF6',         // Purple
  brier: '#F59E0B',       // Amber
  consistency: '#EC4899', // Pink
  edge: '#10B981',        // Emerald
} as const;

export const METRIC_COLORS_ARRAY = [
  '#00E0AA', // Credibility
  '#3B82F6', // Win Rate
  '#8B5CF6', // ROI
  '#F59E0B', // Accuracy
  '#EC4899', // Consistency
  '#10B981', // Edge
];

// Tier badge colors
export const TIER_COLORS = {
  SUPERFORECASTER: { bg: 'bg-amber-500/20', text: 'text-amber-500', border: 'border-amber-500/30' },
  SMART_MONEY: { bg: 'bg-emerald-500/20', text: 'text-emerald-500', border: 'border-emerald-500/30' },
  PROFITABLE: { bg: 'bg-blue-500/20', text: 'text-blue-500', border: 'border-blue-500/30' },
  BREAKEVEN: { bg: 'bg-slate-500/20', text: 'text-slate-500', border: 'border-slate-500/30' },
  LOSING: { bg: 'bg-red-500/20', text: 'text-red-500', border: 'border-red-500/30' },
  UNCLASSIFIED: { bg: 'bg-slate-500/20', text: 'text-slate-500', border: 'border-slate-500/30' },
} as const;
