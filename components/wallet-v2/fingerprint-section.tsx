"use client";

import { useState } from "react";
import { Hexagon, Target, PieChart, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FingerprintRadarChart } from "./fingerprint-radar-chart";
import { FingerprintPolarChart } from "./fingerprint-polar-chart";
import { FingerprintHexBadge } from "./fingerprint-hex-badge";
import type { FingerprintMetric, ChartVariant } from "./types";

// Metric tooltips explaining what each means
const METRIC_TOOLTIPS: Record<string, string> = {
  credibility: "Overall trustworthiness score combining skill, consistency, and sample size. Higher means more reliable to follow.",
  win_rate: "Percentage of positions that ended profitable. Above 50% shows good market selection.",
  roi: "Return on investment - how much profit per dollar risked. Positive means profitable overall.",
  brier: "Prediction accuracy score. Lower Brier = better calibrated predictions that match actual outcomes.",
  consistency: "Profit factor - ratio of total wins to total losses. Above 1.0 means wins outweigh losses.",
  edge: "Closing Line Value - measures if trades move the market. Positive CLV suggests informed trading.",
};

interface FingerprintSectionProps {
  metrics: FingerprintMetric[];
  overallScore: number;
}

export function FingerprintSection({
  metrics,
  overallScore,
}: FingerprintSectionProps) {
  const [variant, setVariant] = useState<ChartVariant>("radar");

  // Get score color based on value
  const getScoreColor = (value: number) => {
    if (value >= 70) return "text-green-500";
    if (value >= 40) return "text-amber-500";
    return "text-muted-foreground";
  };

  return (
    <Card className="p-6 border-border/50 overflow-hidden relative h-full">
      {/* Subtle glow effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#00E0AA]/5 via-transparent to-[#3B82F6]/5 pointer-events-none" />

      <div className="relative z-10 h-full flex flex-col">
        {/* Header with title and variant toggle */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">
              Trader Profile
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              What kind of trader is this?
            </p>
          </div>

          <Tabs
            value={variant}
            onValueChange={(v) => setVariant(v as ChartVariant)}
          >
            <TabsList className="grid grid-cols-3 gap-1">
              <TabsTrigger value="radar" className="px-3">
                <Target className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="polar" className="px-3">
                <PieChart className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="hexagon" className="px-3">
                <Hexagon className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Chart container - smaller to match credibility card height */}
        <div className="flex flex-col items-center justify-center">
          <div style={{ width: 240, height: 220 }} className="flex items-center justify-center">
            {variant === "radar" && (
              <FingerprintRadarChart metrics={metrics} size={220} />
            )}
            {variant === "polar" && (
              <FingerprintPolarChart metrics={metrics} size={220} />
            )}
            {variant === "hexagon" && (
              <FingerprintHexBadge metrics={metrics} size={220} />
            )}
          </div>

          {/* Secondary Scores - mirrors Bot Risk & Copyability structure */}
          <div className="flex gap-8 mt-4">
            <div className="text-center">
              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                <span className="text-sm">Overall Score</span>
              </div>
              <span className={`text-xl font-semibold ${getScoreColor(overallScore)}`}>
                {overallScore}%
              </span>
            </div>
            <div className="text-center">
              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                <span className="text-sm">Metrics</span>
              </div>
              <span className="text-xl font-semibold text-muted-foreground">
                {metrics.length}
              </span>
            </div>
          </div>
        </div>

        {/* Metric breakdown - mirrors component bars style with tooltips */}
        <div className="mt-4 pt-4 border-t border-border/50 space-y-3">
          {metrics.map((metric) => (
            <div key={metric.key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 text-muted-foreground cursor-help">
                        <span>{metric.name}</span>
                        <Info className="h-3 w-3 text-muted-foreground/50" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">
                      <p className="text-sm">{METRIC_TOOLTIPS[metric.key] || metric.name}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <span className={`font-medium ${getScoreColor(metric.normalized)}`}>
                  {Math.round(metric.normalized)}%
                </span>
              </div>
              <Progress value={metric.normalized} className="h-2" />
            </div>
          ))}
        </div>

        {/* Explanation - anchored to bottom */}
        <div className="mt-auto pt-4 border-t border-border/50">
          <p className="text-xs text-muted-foreground text-center">
            Use this score to decide if a wallet is worth following. Factors in skill, consistency, sample size, and practical copyability.
          </p>
        </div>
      </div>
    </Card>
  );
}
