"use client";

import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TrendingUp,
  Target,
  DollarSign,
  BarChart3,
  Clock,
  AlertTriangle,
  Activity,
  Shield,
  Info,
} from "lucide-react";
import { WalletMetrics, TimeWindow, formatPnL } from "@/hooks/use-wallet-wio";
import type { FingerprintMetric } from "./types";

// Clean ROI values by capping at realistic bounds
// On Polymarket: max loss is -100%, reasonable win cap is +500%
function cleanRoi(value: number): number {
  if (value < -1.0) return -1.0; // Can't lose more than 100%
  if (value > 5.0) return 5.0;   // Cap display at 500%
  return value;
}

function formatPercent(value: number, clean: boolean = false): string {
  const displayValue = clean ? cleanRoi(value) : value;
  const sign = displayValue >= 0 ? "+" : "";
  return `${sign}${(displayValue * 100).toFixed(1)}%`;
}

interface CombinedMetricsSectionProps {
  metrics: WalletMetrics;
  allMetrics: WalletMetrics[];
  fingerprintMetrics?: FingerprintMetric[] | null;
  selectedWindow: TimeWindow;
  onWindowChange: (window: TimeWindow) => void;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon: React.ReactNode;
  tooltip: string;
  valueColor?: string;
}

function MetricCard({ label, value, subtext, icon, tooltip, valueColor }: MetricCardProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="p-4 bg-card/50 border-border/50 cursor-help hover:bg-card/70 transition-colors">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              {icon}
              <span className="text-xs font-medium">{label}</span>
              <Info className="h-3 w-3 opacity-50" />
            </div>
            <div className={`text-xl font-bold ${valueColor || ''}`}>
              {value}
            </div>
            {subtext && (
              <div className="text-xs text-muted-foreground mt-1">
                {subtext}
              </div>
            )}
          </Card>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function CombinedMetricsSection({
  metrics,
  allMetrics,
  fingerprintMetrics,
  selectedWindow,
  onWindowChange,
}: CombinedMetricsSectionProps) {
  // Extract credibility from fingerprint metrics (unique to fingerprint)
  const credibilityMetric = fingerprintMetrics?.find(m => m.key === 'credibility');

  // Calculate derived values
  const winCount = Math.round(metrics.win_rate * metrics.resolved_positions_n);
  const lossCount = metrics.resolved_positions_n - winCount;

  const formatHoldTime = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
    return `${(minutes / 1440).toFixed(1)}d`;
  };

  return (
    <Card className="p-6 border-border/50">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5 text-[#00E0AA]" />
          Performance Metrics
        </h2>

        {/* Time Window Selector */}
        <Tabs value={selectedWindow} onValueChange={(v) => onWindowChange(v as TimeWindow)}>
          <TabsList className="bg-muted/50">
            <TabsTrigger value="ALL" className="text-xs">ALL</TabsTrigger>
            <TabsTrigger value="90d" className="text-xs">90d</TabsTrigger>
            <TabsTrigger value="30d" className="text-xs">30d</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Credibility (from fingerprint - unique) */}
        {credibilityMetric && (
          <MetricCard
            label="Credibility"
            value={`${credibilityMetric.normalized.toFixed(0)}%`}
            subtext={credibilityMetric.normalized >= 70 ? 'High' : credibilityMetric.normalized >= 40 ? 'Moderate' : 'Low'}
            icon={<Shield className="h-4 w-4" />}
            tooltip="Credibility score based on trading history, consistency, and behavior patterns. Higher is more trustworthy."
            valueColor={credibilityMetric.normalized >= 70 ? 'text-[#00E0AA]' : credibilityMetric.normalized >= 40 ? 'text-amber-500' : 'text-red-500'}
          />
        )}

        {/* ROI */}
        <MetricCard
          label="ROI"
          value={formatPercent(metrics.roi_cost_weighted)}
          subtext={`P50: ${formatPercent(metrics.roi_p50)}`}
          icon={<TrendingUp className="h-4 w-4" />}
          tooltip="Cost-weighted return on investment. P50 shows median position ROI."
          valueColor={metrics.roi_cost_weighted >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}
        />

        {/* Total PnL */}
        <MetricCard
          label="Total PnL"
          value={formatPnL(metrics.pnl_total_usd)}
          subtext={`${metrics.positions_n} positions`}
          icon={<DollarSign className="h-4 w-4" />}
          tooltip="Total profit/loss in USD across all resolved positions."
          valueColor={metrics.pnl_total_usd >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}
        />

        {/* Win Rate */}
        <MetricCard
          label="Win Rate"
          value={`${(metrics.win_rate * 100).toFixed(1)}%`}
          subtext={`${winCount}W / ${lossCount}L`}
          icon={<Target className="h-4 w-4" />}
          tooltip="Percentage of positions that were profitable."
          valueColor={metrics.win_rate >= 0.5 ? 'text-[#00E0AA]' : 'text-red-500'}
        />

        {/* Profit Factor */}
        <MetricCard
          label="Profit Factor"
          value={metrics.profit_factor.toFixed(2)}
          subtext={metrics.profit_factor >= 1.5 ? 'Strong' : metrics.profit_factor >= 1 ? 'Moderate' : 'Weak'}
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Total gains divided by total losses. Above 1.5 is considered strong."
          valueColor={metrics.profit_factor >= 1.5 ? 'text-[#00E0AA]' : metrics.profit_factor >= 1 ? 'text-amber-500' : 'text-red-500'}
        />

        {/* Avg Win ROI */}
        <MetricCard
          label="Avg Win"
          value={formatPercent(metrics.avg_win_roi, true)}
          subtext={`vs ${formatPercent(metrics.avg_loss_roi, true)} loss`}
          icon={<TrendingUp className="h-4 w-4" />}
          tooltip="Average ROI on winning positions vs losing positions. Values capped at realistic bounds (-100% to +500%)."
          valueColor="text-[#00E0AA]"
        />

        {/* Risk Level (CVaR) */}
        <MetricCard
          label="Risk Level"
          value={formatPercent(cleanRoi(metrics.cvar_95_roi), false)}
          subtext={`Max loss: ${formatPercent(cleanRoi(metrics.max_loss_roi), false)}`}
          icon={<AlertTriangle className="h-4 w-4" />}
          tooltip="CVaR 95% - expected loss in worst 5% of outcomes. Values capped at -100% (max possible loss)."
          valueColor={cleanRoi(metrics.cvar_95_roi) > -0.5 ? 'text-amber-500' : 'text-red-500'}
        />

        {/* Brier Score */}
        <MetricCard
          label="Brier Score"
          value={metrics.brier_mean.toFixed(3)}
          subtext={metrics.brier_mean < 0.15 ? 'Excellent' : metrics.brier_mean < 0.2 ? 'Good' : metrics.brier_mean < 0.25 ? 'Average' : 'Poor'}
          icon={<Target className="h-4 w-4" />}
          tooltip="Prediction accuracy (0 = perfect, 0.25 = random). Lower is better."
          valueColor={metrics.brier_mean < 0.15 ? 'text-[#00E0AA]' : metrics.brier_mean < 0.2 ? 'text-blue-500' : metrics.brier_mean < 0.25 ? 'text-amber-500' : 'text-red-500'}
        />

        {/* Hold Duration */}
        <MetricCard
          label="Hold Time"
          value={formatHoldTime(metrics.hold_minutes_p50)}
          subtext={`${(metrics.pct_held_to_resolve * 100).toFixed(0)}% to resolve`}
          icon={<Clock className="h-4 w-4" />}
          tooltip="Median position hold time. Percentage held until market resolution."
        />
      </div>
    </Card>
  );
}
