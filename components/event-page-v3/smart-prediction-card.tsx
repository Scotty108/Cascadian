"use client";

// Using regular img tag for external images to avoid Next.js hostname configuration
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Target,
  Users,
  DollarSign,
  ChevronRight,
  Sparkles,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SmartPrediction, SmartMarketData } from "./hooks/use-event-smart-summary";

interface SmartPredictionCardProps {
  smartPrediction: SmartPrediction;
  eventTitle: string;
  onViewAllMarkets: () => void;
}

// Format dollar amount
function formatUSD(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

// Get signal icon and color
function getSignalDisplay(signal: string) {
  switch (signal) {
    case "BULLISH":
      return {
        icon: <TrendingUp className="h-4 w-4" />,
        color: "text-emerald-500",
        bgColor: "bg-emerald-500/10 border-emerald-500/30",
        label: "BULLISH",
      };
    case "BEARISH":
      return {
        icon: <TrendingDown className="h-4 w-4" />,
        color: "text-rose-500",
        bgColor: "bg-rose-500/10 border-rose-500/30",
        label: "BEARISH",
      };
    default:
      return {
        icon: <Target className="h-4 w-4" />,
        color: "text-muted-foreground",
        bgColor: "bg-muted/50 border-border/50",
        label: "NEUTRAL",
      };
  }
}

// Confidence bar component
function ConfidenceBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[#00E0AA] to-cyan-400 rounded-full transition-all duration-500"
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}

// Runner up card
function RunnerUpCard({ market, rank }: { market: SmartMarketData; rank: number }) {
  const signalDisplay = getSignalDisplay(market.signal);

  return (
    <div className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-lg">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-muted-foreground">#{rank}</span>
        {market.image && (
          <div className="relative h-6 w-6 rounded-full overflow-hidden shrink-0">
            <img src={market.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
          </div>
        )}
        <span className="text-sm font-medium truncate">{market.shortName}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-semibold">
          {market.smartOdds !== null
            ? `${(market.smartOdds * 100).toFixed(0)}%`
            : `${(market.crowdOdds * 100).toFixed(0)}%`}
        </span>
        <Badge variant="outline" className={cn("text-xs border", signalDisplay.bgColor, signalDisplay.color)}>
          {signalDisplay.icon}
        </Badge>
      </div>
    </div>
  );
}

export function SmartPredictionCard({
  smartPrediction,
  eventTitle,
  onViewAllMarkets,
}: SmartPredictionCardProps) {
  const { topOutcome, rankings } = smartPrediction;
  const runnerUps = rankings.slice(1, 4); // Get #2, #3, #4

  // No smart money data yet
  if (!topOutcome) {
    return (
      <Card className="border border-border/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-muted">
            <Brain className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="font-semibold">Smart Money Prediction</h2>
            <p className="text-sm text-muted-foreground">for {eventTitle}</p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="p-3 rounded-full bg-muted/50 mb-3">
            <Clock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-medium text-lg mb-1">Coming Soon</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Smart money data is being collected for this event. Check back soon for AI-powered predictions
            based on superforecaster and smart wallet activity.
          </p>
        </div>

        <Button variant="outline" className="w-full mt-4" onClick={onViewAllMarkets}>
          View All Markets
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </Card>
    );
  }

  const signalDisplay = getSignalDisplay(topOutcome.signal);

  return (
    <Card className="border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50 bg-gradient-to-r from-[#00E0AA]/5 to-cyan-500/5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#00E0AA]/10">
            <Brain className="h-5 w-5 text-[#00E0AA]" />
          </div>
          <div>
            <h2 className="font-semibold">Smart Money Prediction</h2>
            <p className="text-sm text-muted-foreground">Based on superforecaster & smart wallet consensus</p>
          </div>
        </div>
        <Badge variant="outline" className="bg-[#00E0AA]/10 text-[#00E0AA] border-[#00E0AA]/30">
          <Sparkles className="h-3 w-3 mr-1" />
          AI-Powered
        </Badge>
      </div>

      {/* Main prediction */}
      <div className="p-6">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Left: Top prediction details */}
          <div>
            <div className="flex items-start gap-4 mb-6">
              {topOutcome.image ? (
                <div className="relative h-16 w-16 rounded-xl overflow-hidden shrink-0 border border-border/50">
                  <img src={topOutcome.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                </div>
              ) : (
                <div className="h-16 w-16 rounded-xl bg-muted flex items-center justify-center shrink-0">
                  <Target className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Top Prediction
                </p>
                <h3 className="text-xl font-bold leading-tight">{topOutcome.shortName}</h3>
                <div className="flex items-center gap-2 mt-2">
                  <Badge
                    variant="outline"
                    className={cn("text-xs border", signalDisplay.bgColor, signalDisplay.color)}
                  >
                    {signalDisplay.icon}
                    <span className="ml-1">{signalDisplay.label}</span>
                  </Badge>
                  {topOutcome.delta !== null && (
                    <span className="text-xs text-muted-foreground">
                      {topOutcome.delta >= 0 ? "+" : ""}
                      {(topOutcome.delta * 100).toFixed(0)}pt vs crowd
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Confidence bar */}
            <div className="space-y-4">
              <ConfidenceBar
                value={topOutcome.smartOdds || topOutcome.crowdOdds}
                label="Smart Money Confidence"
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <Users className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-lg font-bold">{topOutcome.superforecasterCount}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Superforecasters</p>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-lg font-bold">{formatUSD(topOutcome.totalInvested)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Smart Money</p>
                </div>
              </div>

              {/* Conviction score */}
              {topOutcome.conviction && (
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <span className="text-sm text-muted-foreground">Conviction Score</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{topOutcome.conviction.score}</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {topOutcome.conviction.level.replace("_", " ")}
                    </Badge>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Runners up */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-muted-foreground">Other Top Contenders</h4>
              <span className="text-xs text-muted-foreground">{rankings.length} ranked</span>
            </div>

            <div className="space-y-2 mb-4">
              {runnerUps.length > 0 ? (
                runnerUps.map((market, idx) => (
                  <RunnerUpCard key={market.id} market={market} rank={idx + 2} />
                ))
              ) : (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  No other markets with smart money data yet
                </div>
              )}
            </div>

            <Button variant="outline" className="w-full" onClick={onViewAllMarkets}>
              View All {rankings.length > 0 ? rankings.length : ""} Markets
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* P&L status footer */}
      {topOutcome.pnlStatus && (
        <div className="px-6 py-3 border-t border-border/50 bg-muted/20">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Smart Money P&L Status</span>
            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={cn(
                  "text-xs border",
                  topOutcome.pnlStatus.status === "winning"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : topOutcome.pnlStatus.status === "losing"
                    ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                    : "bg-muted text-muted-foreground border-border"
                )}
              >
                {topOutcome.pnlStatus.status.toUpperCase()}
              </Badge>
              <span
                className={cn(
                  "font-semibold",
                  topOutcome.pnlStatus.roi >= 0 ? "text-emerald-500" : "text-rose-500"
                )}
              >
                {topOutcome.pnlStatus.roi >= 0 ? "+" : ""}
                {topOutcome.pnlStatus.roi.toFixed(1)}% ROI
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
