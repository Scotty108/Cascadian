"use client";

// Using regular img tag for external images to avoid Next.js hostname configuration
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Users,
  DollarSign,
  ChevronRight,
  Clock,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SmartMarketData } from "./hooks/use-event-smart-summary";

interface SmartMarketCardProps {
  market: SmartMarketData;
  onClick: () => void;
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

// Get signal display
function getSignalDisplay(signal: string) {
  switch (signal) {
    case "BULLISH":
      return {
        icon: <TrendingUp className="h-3 w-3" />,
        color: "text-emerald-500",
        bgColor: "bg-emerald-500/10 border-emerald-500/30",
        barColor: "bg-emerald-500",
        label: "BULLISH",
      };
    case "BEARISH":
      return {
        icon: <TrendingDown className="h-3 w-3" />,
        color: "text-rose-500",
        bgColor: "bg-rose-500/10 border-rose-500/30",
        barColor: "bg-rose-500",
        label: "BEARISH",
      };
    case "PENDING":
      return {
        icon: <Clock className="h-3 w-3" />,
        color: "text-amber-500",
        bgColor: "bg-amber-500/10 border-amber-500/30",
        barColor: "bg-amber-500",
        label: "PENDING",
      };
    default:
      return {
        icon: <Target className="h-3 w-3" />,
        color: "text-muted-foreground",
        bgColor: "bg-muted/50 border-border/50",
        barColor: "bg-muted-foreground",
        label: "NEUTRAL",
      };
  }
}

// Comparison bar component
function ComparisonBar({
  smartOdds,
  crowdOdds,
  hasSmartMoneyData,
}: {
  smartOdds: number | null;
  crowdOdds: number;
  hasSmartMoneyData: boolean;
}) {
  const smart = smartOdds !== null ? smartOdds * 100 : null;
  const crowd = crowdOdds * 100;

  return (
    <div className="space-y-1.5">
      {/* Smart Money bar */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#00E0AA] w-12 shrink-0">Smart</span>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          {hasSmartMoneyData && smart !== null ? (
            <div
              className="h-full bg-gradient-to-r from-[#00E0AA] to-cyan-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(smart, 100)}%` }}
            />
          ) : (
            <div className="h-full bg-muted-foreground/20 rounded-full w-full flex items-center justify-center">
              <span className="text-[8px] text-muted-foreground">Pending</span>
            </div>
          )}
        </div>
        <span className="text-xs font-semibold w-10 text-right">
          {smart !== null ? `${smart.toFixed(0)}%` : "—"}
        </span>
      </div>

      {/* Crowd bar */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-12 shrink-0">Crowd</span>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-muted-foreground/50 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(crowd, 100)}%` }}
          />
        </div>
        <span className="text-xs font-semibold w-10 text-right text-muted-foreground">
          {crowd.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

export function SmartMarketCard({ market, onClick }: SmartMarketCardProps) {
  const signalDisplay = getSignalDisplay(market.signal);

  return (
    <Card
      className={cn(
        "border border-border/50 p-4 cursor-pointer transition-all duration-200",
        "hover:border-[#00E0AA]/50 hover:shadow-lg hover:shadow-[#00E0AA]/5",
        "group"
      )}
      onClick={onClick}
    >
      {/* Header: Title + Signal */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {market.image ? (
            <div className="relative h-10 w-10 rounded-lg overflow-hidden shrink-0 border border-border/50">
              <img src={market.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Target className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm leading-tight line-clamp-2 group-hover:text-[#00E0AA] transition-colors">
              {market.shortName}
            </h3>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn("text-xs border shrink-0", signalDisplay.bgColor, signalDisplay.color)}
        >
          {signalDisplay.icon}
          <span className="ml-1">{signalDisplay.label}</span>
        </Badge>
      </div>

      {/* Comparison bars */}
      <ComparisonBar
        smartOdds={market.smartOdds}
        crowdOdds={market.crowdOdds}
        hasSmartMoneyData={market.hasSmartMoneyData}
      />

      {/* Delta indicator */}
      {market.delta !== null && (
        <div className="mt-3 flex items-center justify-center">
          <span
            className={cn(
              "text-xs font-semibold px-2 py-0.5 rounded-full",
              market.delta > 0.05
                ? "bg-emerald-500/10 text-emerald-500"
                : market.delta < -0.05
                ? "bg-rose-500/10 text-rose-500"
                : "bg-muted text-muted-foreground"
            )}
          >
            {market.delta >= 0 ? "+" : ""}
            {(market.delta * 100).toFixed(0)}pt delta
          </span>
        </div>
      )}

      {/* Footer: Stats */}
      <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {market.superforecasterCount > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Zap className="h-3 w-3 text-purple-400" />
              <span>{market.superforecasterCount} SF</span>
            </div>
          )}
          {market.totalInvested > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <DollarSign className="h-3 w-3 text-emerald-400" />
              <span>{formatUSD(market.totalInvested)}</span>
            </div>
          )}
          {market.smartWalletCount > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>{market.smartWalletCount}</span>
            </div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-[#00E0AA] transition-colors" />
      </div>

      {/* Detected signal badge (if any) */}
      {market.detectedSignal && (
        <div className="mt-3 p-2 bg-[#00E0AA]/5 border border-[#00E0AA]/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-3 w-3 text-[#00E0AA]" />
              <span className="text-xs font-medium text-[#00E0AA]">
                {market.detectedSignal.signalId.replace(/_/g, " ")}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {(market.detectedSignal.winRate * 100).toFixed(0)}% win rate
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
