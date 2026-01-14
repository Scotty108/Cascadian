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
  isLoading?: boolean;
}

// Clean ROI values - only cap losses at -100% (can't lose more than invested)
function cleanRoi(value: number): number {
  if (value < -1.0) return -1.0; // Can't lose more than 100%
  return value;
}

function formatPercent(value: number, clean: boolean = true): string {
  const displayValue = clean ? cleanRoi(value) : value;
  const sign = displayValue >= 0 ? "+" : "";
  const absPercent = Math.abs(displayValue * 100);
  // Show one decimal for small values, whole numbers for larger ones
  const decimals = absPercent > 0 && absPercent < 1 ? 1 : 0;
  return `${sign}${(displayValue * 100).toFixed(decimals)}%`;
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
  // Binary prediction markets have inherent worst-case risk (losing positions go to 0)
  // Thresholds adjusted for this reality:
  // - Low: Worst 5% lose less than 80% (good risk management)
  // - Moderate: Worst 5% lose 80-95%
  // - High: Worst 5% lose 95-100% (common in binary markets)
  // - Very High: CVaR worse than -100% (data anomaly or extreme cases)
  const absRisk = Math.abs(cvar95);
  if (absRisk < 0.8) return { label: "Low", color: "text-emerald-500" };
  if (absRisk < 0.95) return { label: "Moderate", color: "text-blue-500" };
  if (absRisk <= 1.0) return { label: "High", color: "text-amber-500" };
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
  isLoading?: boolean;
}

function StatItem({ icon, label, value, valueColor, subtext, tooltip, isLoading }: StatItemProps) {
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
            {isLoading ? (
              <>
                <div className="h-7 w-16 bg-muted/50 rounded animate-pulse" />
                <div className="h-3 w-20 bg-muted/50 rounded animate-pulse mt-2" />
              </>
            ) : (
              <>
                <p className={`text-xl font-bold ${valueColor || ''}`}>{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
              </>
            )}
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
  isLoading?: boolean;
}

function SliderStatItem({ icon, label, value, valueColor, subtext, sliderPercent, sliderColor, tooltip, isLoading }: SliderStatItemProps) {
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
            {isLoading ? (
              <>
                <div className="h-7 w-16 bg-muted/50 rounded animate-pulse" />
                <div className="flex items-center gap-2 mt-2">
                  <div className="h-3 w-12 bg-muted/50 rounded animate-pulse" />
                  <div className="flex-1 h-2 bg-muted/50 rounded-full animate-pulse" />
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
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
  isLoading,
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
          isLoading={isLoading}
        />

        {/* Risk Level (CVaR) */}
        <StatItem
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Risk Level"
          value={riskLevel.label}
          valueColor={riskLevel.color}
          subtext={`Worst 5%: ${formatPercent(cleanedCvar)}`}
          tooltip="Risk level based on CVaR (worst 5% of positions). Low: <80% loss, Moderate: 80-95%, High: 95-100%. Binary markets often have total losses, so 'High' is common."
          isLoading={isLoading}
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
          isLoading={isLoading}
        />

        {/* Hold Time */}
        <StatItem
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Hold Time"
          value={formatHoldTime(holdMinutes)}
          subtext={`${(pctHeldToResolve * 100).toFixed(0)}% to resolve`}
          tooltip="Median position hold duration. Percentage shows how often positions are held until market resolution."
          isLoading={isLoading}
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
          isLoading={isLoading}
        />
      </div>

      {/* CLV Section - compact row at bottom */}
      <div className="border-t border-border/50 px-4 py-2 flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Zap className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Market Edge (CLV)</span>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-4">
            <div className="h-4 w-16 bg-muted/50 rounded animate-pulse" />
            <div className="h-4 w-16 bg-muted/50 rounded animate-pulse" />
            <div className="h-4 w-16 bg-muted/50 rounded animate-pulse" />
          </div>
        ) : hasClvData ? (
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
