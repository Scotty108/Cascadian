"use client";

/**
 * SmartMoneyBreakdown Component
 *
 * Modular component showing detailed smart money analysis.
 * Works on both event pages (aggregate) and market pages (single market).
 * Supports both light and dark modes.
 */

import { useMemo } from "react";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  Calendar,
  Target,
  Zap,
  ChevronRight,
  ExternalLink,
  Award,
  AlertTriangle,
} from "lucide-react";
import { useSmartMoneyBreakdown, SmartMoneyBreakdown } from "@/hooks/use-smart-money-breakdown";

interface SmartMoneyBreakdownProps {
  conditionId: string;
  compact?: boolean; // For inline/sidebar use
  showTopPositions?: boolean;
  className?: string;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatPrice(value: number): string {
  return `${(value * 100).toFixed(1)}¢`;
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function shortenWallet(wallet: string | undefined): string {
  if (!wallet) return 'Unknown';
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function ConvictionBadge({ level, score }: { level: string; score: number }) {
  const config = {
    very_high: { bg: "bg-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", label: "Very High" },
    high: { bg: "bg-green-500/20", text: "text-green-600 dark:text-green-400", label: "High" },
    medium: { bg: "bg-yellow-500/20", text: "text-yellow-600 dark:text-yellow-400", label: "Medium" },
    low: { bg: "bg-orange-500/20", text: "text-orange-600 dark:text-orange-400", label: "Low" },
    very_low: { bg: "bg-red-500/20", text: "text-red-600 dark:text-red-400", label: "Very Low" },
  }[level] || { bg: "bg-zinc-500/20", text: "text-zinc-600 dark:text-zinc-400", label: "Unknown" };

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ${config.bg}`}>
      <Zap className={`w-3.5 h-3.5 ${config.text}`} />
      <span className={`text-xs font-semibold ${config.text}`}>{config.label}</span>
      <span className="text-xs text-zinc-500">({score})</span>
    </div>
  );
}

function PnlStatusBadge({ status, roi }: { status: string; roi: number }) {
  const config = {
    winning: { bg: "bg-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", icon: TrendingUp },
    losing: { bg: "bg-red-500/20", text: "text-red-600 dark:text-red-400", icon: TrendingDown },
    breakeven: { bg: "bg-zinc-500/20", text: "text-zinc-600 dark:text-zinc-400", icon: Target },
  }[status] || { bg: "bg-zinc-500/20", text: "text-zinc-600 dark:text-zinc-400", icon: Target };

  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ${config.bg}`}>
      <Icon className={`w-3.5 h-3.5 ${config.text}`} />
      <span className={`text-xs font-semibold ${config.text}`}>
        {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
      </span>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const config = {
    superforecaster: { bg: "bg-purple-500/20", text: "text-purple-600 dark:text-purple-400", label: "SF" },
    smart: { bg: "bg-cyan-500/20", text: "text-cyan-600 dark:text-cyan-400", label: "Smart" },
    profitable: { bg: "bg-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", label: "Pro" },
  }[tier] || { bg: "bg-zinc-500/20", text: "text-zinc-600 dark:text-zinc-400", label: tier };

  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

export function SmartMoneyBreakdownComponent({
  conditionId,
  compact = false,
  showTopPositions = true,
  className = "",
}: SmartMoneyBreakdownProps) {
  const { data, isLoading, error } = useSmartMoneyBreakdown(conditionId);

  if (isLoading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-48 bg-zinc-200 dark:bg-zinc-800/50 rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`p-4 bg-zinc-100 dark:bg-zinc-800/30 rounded-lg border border-zinc-200 dark:border-zinc-700/50 ${className}`}>
        <div className="flex items-center gap-2 text-zinc-500">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">Smart money data unavailable</span>
        </div>
      </div>
    );
  }

  const { summary, entry_timeline, top_positions, pnl_status, conviction } = data;

  // Determine signal direction
  const signal = summary.smart_money_odds >= 50 ? 'YES' : 'NO';
  const signalStrength = Math.abs(summary.smart_money_odds - 50) * 2; // 0-100 scale

  if (compact) {
    return (
      <div className={`p-3 bg-zinc-100 dark:bg-zinc-800/30 rounded-lg border border-zinc-200 dark:border-zinc-700/50 ${className}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Smart Money</span>
          </div>
          <ConvictionBadge level={conviction.level} score={conviction.score} />
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className={`text-lg font-bold ${summary.smart_money_odds >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {summary.smart_money_odds.toFixed(0)}%
            </div>
            <div className="text-[10px] text-zinc-500">{signal} Odds</div>
          </div>
          <div>
            <div className="text-lg font-bold text-zinc-800 dark:text-zinc-200">{summary.smart_wallets}</div>
            <div className="text-[10px] text-zinc-500">Wallets</div>
          </div>
          <div>
            <div className="text-lg font-bold text-zinc-800 dark:text-zinc-200">{formatUsd(summary.smart_invested_usd)}</div>
            <div className="text-[10px] text-zinc-500">Invested</div>
          </div>
        </div>

        <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700/50">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">vs Crowd ({summary.crowd_odds.toFixed(0)}%)</span>
            <span className={summary.divergence >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {summary.divergence >= 0 ? '+' : ''}{summary.divergence.toFixed(0)}pt
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-cyan-500/20 rounded-lg">
              <Zap className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
            </div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Smart Money Breakdown</h3>
          </div>
          <ConvictionBadge level={conviction.level} score={conviction.score} />
        </div>
      </div>

      {/* Main Signal */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg">
            <div className={`text-2xl font-bold ${summary.smart_money_odds >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {summary.smart_money_odds.toFixed(0)}%
            </div>
            <div className="text-xs text-zinc-500 mt-1">Smart Money on {signal}</div>
          </div>
          <div className="text-center p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg">
            <div className="text-2xl font-bold text-zinc-800 dark:text-zinc-200">{summary.smart_wallets}</div>
            <div className="text-xs text-zinc-500 mt-1">Smart Wallets</div>
          </div>
          <div className="text-center p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg">
            <div className="text-2xl font-bold text-zinc-800 dark:text-zinc-200">{formatUsd(summary.smart_invested_usd)}</div>
            <div className="text-xs text-zinc-500 mt-1">Total Invested</div>
          </div>
          <div className="text-center p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg">
            <div className={`text-2xl font-bold ${summary.divergence >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {summary.divergence >= 0 ? '+' : ''}{summary.divergence.toFixed(0)}pt
            </div>
            <div className="text-xs text-zinc-500 mt-1">vs Crowd ({summary.crowd_odds.toFixed(0)}%)</div>
          </div>
        </div>
      </div>

      {/* P&L Status */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
            P&L Status
          </h4>
          <PnlStatusBadge status={pnl_status.status} roi={pnl_status.unrealized_roi_percent} />
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-zinc-500 text-xs mb-1">Avg Entry</div>
            <div className="font-medium text-zinc-800 dark:text-zinc-200">{formatPrice(pnl_status.avg_entry_price)}</div>
          </div>
          <div>
            <div className="text-zinc-500 text-xs mb-1">Current Price</div>
            <div className="font-medium text-zinc-800 dark:text-zinc-200">{formatPrice(pnl_status.current_price)}</div>
          </div>
          <div>
            <div className="text-zinc-500 text-xs mb-1">Unrealized P&L</div>
            <div className={`font-medium ${pnl_status.unrealized_pnl_usd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {pnl_status.unrealized_pnl_usd >= 0 ? '+' : ''}{formatUsd(pnl_status.unrealized_pnl_usd)}
            </div>
          </div>
        </div>
      </div>

      {/* Entry Timeline */}
      {entry_timeline.length > 0 && (
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
            When Smart Money Bought
          </h4>
          <div className="space-y-2">
            {entry_timeline.slice(-5).map((month) => (
              <div key={month.month} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-zinc-600 dark:text-zinc-400 w-16">{formatMonth(month.month)}</span>
                  <span className="text-zinc-500">{month.wallets} wallets</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-zinc-800 dark:text-zinc-200 font-medium">{formatUsd(month.total_usd)}</span>
                  <span className="text-zinc-500 text-xs">@ {formatPrice(month.avg_entry_price)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Positions */}
      {showTopPositions && top_positions.length > 0 && (
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2 mb-3">
            <Award className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
            Top Smart Money Positions
          </h4>
          <div className="space-y-2">
            {top_positions.slice(0, 5).filter(pos => pos?.wallet_id).map((pos, idx) => (
              <div key={`${pos.wallet_id}-${idx}`} className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/analysis/wallet/${pos.wallet_id}`}
                    className="text-sm font-mono text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 transition-colors"
                  >
                    {shortenWallet(pos.wallet_id)}
                  </Link>
                  <TierBadge tier={pos.tier || 'unknown'} />
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className={pos.side === 'YES' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                    {pos.side || '?'}
                  </span>
                  <span className="text-zinc-800 dark:text-zinc-200 font-medium">{formatUsd(pos.cost_usd || 0)}</span>
                  <span className={`text-xs ${(pos.unrealized_pnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {(pos.unrealized_pnl || 0) >= 0 ? '+' : ''}{formatUsd(pos.unrealized_pnl || 0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conviction Factors */}
      {conviction.factors.length > 0 && (
        <div className="p-4">
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
            Conviction Factors
          </h4>
          <div className="flex flex-wrap gap-2">
            {conviction.factors.map((factor, idx) => (
              <span
                key={idx}
                className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-full text-xs text-zinc-600 dark:text-zinc-400"
              >
                {factor}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Compact version for sidebars
export function SmartMoneyBreakdownCompact(props: Omit<SmartMoneyBreakdownProps, 'compact'>) {
  return <SmartMoneyBreakdownComponent {...props} compact />;
}

// Default export
export default SmartMoneyBreakdownComponent;
