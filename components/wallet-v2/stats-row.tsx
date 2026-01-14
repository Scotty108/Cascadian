"use client";

import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TrendingUp,
  AlertTriangle,
  Target,
  Clock,
  Info,
} from "lucide-react";

interface StatsRowProps {
  avgWinRoi: number;
  avgLossRoi: number;
  cvar95: number;
  maxLossRoi: number;
  brierScore: number;
  holdMinutes: number;
  pctHeldToResolve: number;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatHoldTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

function getBrierLabel(score: number): { label: string; color: string } {
  if (score < 0.15) return { label: "Excellent", color: "text-emerald-500" };
  if (score < 0.2) return { label: "Good", color: "text-blue-500" };
  if (score < 0.25) return { label: "Average", color: "text-amber-500" };
  return { label: "Poor", color: "text-red-500" };
}

interface StatItemProps {
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  value: string;
  valueColor?: string;
  subtext: string;
  tooltip: string;
}

function StatItem({ icon, iconColor, label, value, valueColor, subtext, tooltip }: StatItemProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="p-4 cursor-help hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={iconColor}>{icon}</span>
              <p className="text-xs text-muted-foreground font-medium">{label}</p>
              <Info className="h-3 w-3 text-muted-foreground/50" />
            </div>
            <p className={`text-xl font-bold ${valueColor || ''}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function StatsRow({
  avgWinRoi,
  avgLossRoi,
  cvar95,
  maxLossRoi,
  brierScore,
  holdMinutes,
  pctHeldToResolve,
}: StatsRowProps) {
  const brierStatus = getBrierLabel(brierScore);

  return (
    <Card className="p-0 bg-card border-border/50 overflow-hidden">
      <div className="grid grid-cols-4 divide-x divide-border/50">
        {/* Avg Win */}
        <StatItem
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          iconColor="text-muted-foreground"
          label="Avg Win"
          value={formatPercent(avgWinRoi)}
          valueColor="text-emerald-500"
          subtext={`vs ${formatPercent(avgLossRoi)} loss`}
          tooltip="Average ROI on winning positions compared to average loss on losing positions. Shows risk/reward profile."
        />

        {/* CVaR 95% */}
        <StatItem
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          iconColor="text-muted-foreground"
          label="CVaR 95%"
          value={formatPercent(cvar95)}
          valueColor={cvar95 > -0.5 ? "text-amber-500" : "text-red-500"}
          subtext={`Max: ${formatPercent(maxLossRoi)}`}
          tooltip="Conditional Value at Risk - expected loss in the worst 5% of positions. Lower (closer to 0) is better risk management."
        />

        {/* Brier Score */}
        <StatItem
          icon={<Target className="h-3.5 w-3.5" />}
          iconColor="text-muted-foreground"
          label="Brier Score"
          value={brierScore.toFixed(3)}
          valueColor={brierStatus.color}
          subtext={brierStatus.label}
          tooltip="Prediction accuracy score (0 = perfect, 0.25 = random guessing). Measures calibration of probability estimates."
        />

        {/* Hold Time */}
        <StatItem
          icon={<Clock className="h-3.5 w-3.5" />}
          iconColor="text-muted-foreground"
          label="Hold Time"
          value={formatHoldTime(holdMinutes)}
          subtext={`${(pctHeldToResolve * 100).toFixed(0)}% to resolve`}
          tooltip="Median position hold duration. Percentage shows how often positions are held until market resolution vs early exit."
        />
      </div>
    </Card>
  );
}
