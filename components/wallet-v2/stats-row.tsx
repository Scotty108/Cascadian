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
  BarChart3,
  Info,
  Zap,
} from "lucide-react";

interface StatsRowProps {
  avgWinRoi: number;
  avgLossRoi: number;
  cvar95: number;
  maxLossRoi: number;
  brierScore: number;
  holdMinutes: number;
  pctHeldToResolve: number;
  profitFactor: number;
  clv4h: number;
  clv24h: number;
  clv72h: number;
}

// Clean ROI values by capping at realistic bounds
// On Polymarket: max loss is -100%, reasonable win cap is +500%
function cleanRoi(value: number): number {
  if (value < -1.0) return -1.0; // Can't lose more than 100%
  if (value > 5.0) return 5.0;   // Cap display at 500%
  return value;
}

function formatPercent(value: number, clean: boolean = true): string {
  const displayValue = clean ? cleanRoi(value) : value;
  const sign = displayValue >= 0 ? "+" : "";
  return `${sign}${(displayValue * 100).toFixed(0)}%`;
}

function formatHoldTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

function getBrierLabel(score: number): { label: string; color: string; bgColor: string } {
  if (score < 0.15) return { label: "Excellent", color: "text-emerald-500", bgColor: "bg-emerald-500" };
  if (score < 0.2) return { label: "Good", color: "text-blue-500", bgColor: "bg-blue-500" };
  if (score < 0.25) return { label: "Average", color: "text-amber-500", bgColor: "bg-amber-500" };
  return { label: "Poor", color: "text-red-500", bgColor: "bg-red-500" };
}

function getRiskLevel(cvar95: number): { label: string; color: string } {
  // Use cleaned CVaR (capped at -100% for realistic assessment)
  const cleanedCvar = Math.max(cvar95, -1.0);
  const absRisk = Math.abs(cleanedCvar);
  if (absRisk < 0.25) return { label: "Low", color: "text-emerald-500" };
  if (absRisk < 0.5) return { label: "Moderate", color: "text-blue-500" };
  if (absRisk < 0.75) return { label: "High", color: "text-amber-500" };
  return { label: "Very High", color: "text-red-500" };
}

function getProfitFactorStyle(pf: number): { label: string; color: string; bgColor: string } {
  if (pf >= 2.0) return { label: "Excellent", color: "text-emerald-500", bgColor: "bg-emerald-500" };
  if (pf >= 1.5) return { label: "Strong", color: "text-emerald-500", bgColor: "bg-emerald-500" };
  if (pf >= 1.0) return { label: "Moderate", color: "text-amber-500", bgColor: "bg-amber-500" };
  return { label: "Weak", color: "text-red-500", bgColor: "bg-red-500" };
}

interface StatItemProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  subtext: string;
  tooltip: string;
}

function StatItem({ icon, label, value, valueColor, subtext, tooltip }: StatItemProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="p-4 cursor-help hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-muted-foreground">{icon}</span>
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

interface SliderStatItemProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  subtext: string;
  sliderPercent: number;
  sliderColor: string;
  tooltip: string;
}

function SliderStatItem({ icon, label, value, valueColor, subtext, sliderPercent, sliderColor, tooltip }: SliderStatItemProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="p-4 cursor-help hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-muted-foreground">{icon}</span>
              <p className="text-xs text-muted-foreground font-medium">{label}</p>
              <Info className="h-3 w-3 text-muted-foreground/50" />
            </div>
            <p className={`text-xl font-bold ${valueColor || ''}`}>{value}</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-muted-foreground">{subtext}</p>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${sliderColor} rounded-full transition-all`}
                  style={{ width: `${Math.min(Math.max(sliderPercent, 0), 100)}%` }}
                />
              </div>
            </div>
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
  profitFactor,
  clv4h,
  clv24h,
  clv72h,
}: StatsRowProps) {
  const hasClvData = clv4h !== 0 || clv24h !== 0 || clv72h !== 0;
  const brierStatus = getBrierLabel(brierScore);
  const riskLevel = getRiskLevel(cvar95);
  const pfStatus = getProfitFactorStyle(profitFactor);

  // Clean the ROI values for display
  const cleanedWinRoi = cleanRoi(avgWinRoi);
  const cleanedLossRoi = cleanRoi(avgLossRoi);
  const cleanedCvar = Math.max(cvar95, -1.0); // Cap CVaR at -100%

  // Brier slider: 0 = 100% (perfect), 0.25 = 0% (random)
  const brierSliderPercent = ((0.25 - Math.min(brierScore, 0.25)) / 0.25) * 100;

  // Profit Factor slider: 0 = 0%, 1 = 50%, 2+ = 100%
  const pfSliderPercent = Math.min((profitFactor / 2) * 100, 100);

  return (
    <Card className="p-0 bg-card border-border/50 overflow-hidden">
      <div className="grid grid-cols-5 divide-x divide-border/50">
        {/* Avg Win */}
        <StatItem
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Avg Win"
          value={formatPercent(cleanedWinRoi)}
          valueColor="text-emerald-500"
          subtext={`vs ${formatPercent(cleanedLossRoi)} loss`}
          tooltip="Average ROI on winning vs losing positions. Values capped at realistic bounds (-100% to +500%)."
        />

        {/* Risk Level (CVaR) */}
        <StatItem
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Risk Level"
          value={riskLevel.label}
          valueColor={riskLevel.color}
          subtext={`Worst 5%: ${formatPercent(cleanedCvar)}`}
          tooltip="Risk level based on CVaR - the average loss in the worst 5% of positions. Capped at -100% (max possible loss)."
        />

        {/* Accuracy (Brier Score) with inline slider */}
        <SliderStatItem
          icon={<Target className="h-3.5 w-3.5" />}
          label="Accuracy"
          value={brierScore.toFixed(3)}
          valueColor={brierStatus.color}
          subtext={brierStatus.label}
          sliderPercent={brierSliderPercent}
          sliderColor={brierStatus.bgColor}
          tooltip={`Brier Score: ${brierScore.toFixed(3)}. Measures prediction accuracy (0 = perfect, 0.25 = random). Lower is better.`}
        />

        {/* Hold Time */}
        <StatItem
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Hold Time"
          value={formatHoldTime(holdMinutes)}
          subtext={`${(pctHeldToResolve * 100).toFixed(0)}% to resolve`}
          tooltip="Median position hold duration. Percentage shows how often positions are held until market resolution."
        />

        {/* Profit Factor with inline slider */}
        <SliderStatItem
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          label="Profit Factor"
          value={profitFactor.toFixed(2)}
          valueColor={pfStatus.color}
          subtext={pfStatus.label}
          sliderPercent={pfSliderPercent}
          sliderColor={pfStatus.bgColor}
          tooltip={`Profit Factor = Total Gains / Total Losses. Above 1.0 is profitable, 1.5+ is strong, 2.0+ is excellent.`}
        />
      </div>

      {/* CLV Section - compact row at bottom */}
      <div className="border-t border-border/50 px-4 py-2 flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Zap className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Market Edge (CLV)</span>
        </div>
        {hasClvData ? (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">+4h:</span>
              <span className={`text-xs font-semibold ${clv4h > 0 ? 'text-emerald-500' : clv4h < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                {clv4h > 0 ? '+' : ''}{(clv4h * 100).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">+24h:</span>
              <span className={`text-xs font-semibold ${clv24h > 0 ? 'text-emerald-500' : clv24h < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                {clv24h > 0 ? '+' : ''}{(clv24h * 100).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">+72h:</span>
              <span className={`text-xs font-semibold ${clv72h > 0 ? 'text-emerald-500' : clv72h < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                {clv72h > 0 ? '+' : ''}{(clv72h * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No timing edge — holds to resolution</span>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3 w-3 text-muted-foreground/50" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-sm">Closing Line Value measures if trades anticipate market moves. Positive = enters before favorable price movement.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </Card>
  );
}
