"use client";

import { Info, TrendingUp, Hash } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FingerprintRadarChart } from "./fingerprint-radar-chart";
import type { FingerprintMetric } from "./types";

const METRIC_TOOLTIPS: Record<string, string> = {
  credibility: "Overall trustworthiness combining skill and consistency.",
  win_rate: "Percentage of profitable positions.",
  roi: "Return on investment per dollar risked.",
  brier: "Prediction accuracy score.",
  consistency: "Profit factor - wins vs losses ratio.",
  edge: "Closing Line Value - market-moving ability.",
};

interface FingerprintSectionHorizontalProps {
  metrics: FingerprintMetric[];
  overallScore: number;
  isLoading?: boolean;
}

function SkeletonBar() {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="h-4 w-20 bg-muted/50 rounded animate-pulse" />
        <div className="h-4 w-10 bg-muted/50 rounded animate-pulse" />
      </div>
      <div className="h-2 w-full bg-muted/50 rounded animate-pulse" />
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="flex items-center justify-center" style={{ width: 220, height: 220 }}>
      <div className="w-40 h-40 rounded-full border-4 border-muted/30 animate-pulse" />
    </div>
  );
}

function SkeletonSecondaryStats() {
  return (
    <div className="flex gap-4 text-center">
      <div>
        <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
          <TrendingUp className="h-3 w-3" />
          <span className="text-xs">Overall Score</span>
        </div>
        <div className="h-5 w-8 bg-muted/50 rounded animate-pulse mx-auto" />
      </div>
      <div>
        <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
          <Hash className="h-3 w-3" />
          <span className="text-xs">Metrics</span>
        </div>
        <div className="h-5 w-8 bg-muted/50 rounded animate-pulse mx-auto" />
      </div>
    </div>
  );
}

export function FingerprintSectionHorizontal({
  metrics,
  overallScore,
  isLoading,
}: FingerprintSectionHorizontalProps) {
  const getScoreColor = (value: number) => {
    if (value >= 70) return "text-green-500";
    if (value >= 40) return "text-amber-500";
    return "text-muted-foreground";
  };

  const hasData = metrics && metrics.length > 0;

  return (
    <Card className="p-6 border-border/50 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-[#00E0AA]/5 via-transparent to-[#3B82F6]/5 pointer-events-none" />

      <div className="relative z-10">
        {/* Header with key stats (replacing chart toggles) */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Trader Profile</h2>
            <p className="text-xs text-muted-foreground">Performance fingerprint across key metrics</p>
          </div>
          {/* Info icon */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors group">
                  <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p>A visual fingerprint of this trader's performance across key metrics like win rate, ROI, consistency, and prediction accuracy.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Horizontal Layout: Chart Left, Bars Right */}
        <div className="grid grid-cols-2 gap-6">
          {/* Left: Chart + Overall Score */}
          <div className="flex flex-col items-center justify-between" style={{ height: 280 }}>
            {/* Chart container */}
            <div className="flex items-center justify-center flex-1" style={{ width: 220 }}>
              {isLoading || !hasData ? (
                <SkeletonChart />
              ) : (
                <FingerprintRadarChart metrics={metrics} size={220} />
              )}
            </div>

            {/* Secondary Stats - anchored to bottom */}
            {isLoading || !hasData ? (
              <SkeletonSecondaryStats />
            ) : (
              <div className="flex gap-4 text-center">
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                    <TrendingUp className="h-3 w-3" />
                    <span className="text-xs">Overall Score</span>
                  </div>
                  <span className={`text-sm font-semibold ${getScoreColor(overallScore)}`}>
                    {overallScore}%
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                    <Hash className="h-3 w-3" />
                    <span className="text-xs">Metrics</span>
                  </div>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {metrics.length}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right: Progress Bars */}
          <div className="space-y-2 min-w-0">
            {isLoading || !hasData ? (
              <>
                <SkeletonBar />
                <SkeletonBar />
                <SkeletonBar />
                <SkeletonBar />
                <SkeletonBar />
                <SkeletonBar />
              </>
            ) : (
              metrics.map((metric) => (
                <div key={metric.key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5 text-muted-foreground cursor-help">
                            <span className="text-xs">{metric.name}</span>
                            <Info className="h-2.5 w-2.5 text-muted-foreground/50" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs">
                          <p className="text-sm">{METRIC_TOOLTIPS[metric.key] || metric.name}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <span className={`text-xs font-medium ${getScoreColor(metric.normalized)}`}>
                      {Math.round(metric.normalized)}%
                    </span>
                  </div>
                  <Progress value={metric.normalized} className="h-2" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer - Always visible */}
        <div className="mt-4 pt-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground text-center">
            Use this score to decide if a wallet is worth following.
          </p>
        </div>
      </div>
    </Card>
  );
}
