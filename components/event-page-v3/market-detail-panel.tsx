"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
// Using regular img tag for external images to avoid Next.js hostname configuration
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  X,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  Users,
  DollarSign,
  Zap,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSmartMoneyBreakdown } from "@/hooks/use-smart-money-breakdown";
import { useMarketSmartMoney } from "@/hooks/use-market-smart-money";
import { SmartMoneyBreakdownComponent } from "@/components/smart-money-breakdown";
import { MarketSmartMoneyWidget } from "@/components/market-smart-money-widget";
import type { SmartMarketData } from "./hooks/use-event-smart-summary";

interface MarketDetailPanelProps {
  market: SmartMarketData;
  onClose: () => void;
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
    case "PENDING":
      return {
        icon: <Clock className="h-4 w-4" />,
        color: "text-amber-500",
        bgColor: "bg-amber-500/10 border-amber-500/30",
        label: "PENDING",
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

export function MarketDetailPanel({ market, onClose }: MarketDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const signalDisplay = getSignalDisplay(market.signal);

  // Fetch additional data
  const { data: breakdown, isLoading: breakdownLoading } = useSmartMoneyBreakdown(market.conditionId);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay adding listener to avoid immediate close
    const timeout = setTimeout(() => {
      window.addEventListener("mousedown", handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          "fixed top-0 right-0 h-full w-full max-w-lg bg-background border-l border-border z-50",
          "animate-in slide-in-from-right duration-300"
        )}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border/50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {market.image ? (
                <div className="relative h-12 w-12 rounded-lg overflow-hidden shrink-0 border border-border/50">
                  <img src={market.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                </div>
              ) : (
                <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Target className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-lg leading-tight">{market.shortName}</h2>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{market.question}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            <div className="text-center p-2 bg-muted/30 rounded-lg">
              <p className="text-lg font-bold text-[#00E0AA]">
                {market.smartOdds !== null ? `${(market.smartOdds * 100).toFixed(0)}%` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Smart</p>
            </div>
            <div className="text-center p-2 bg-muted/30 rounded-lg">
              <p className="text-lg font-bold text-muted-foreground">
                {(market.crowdOdds * 100).toFixed(0)}%
              </p>
              <p className="text-xs text-muted-foreground">Crowd</p>
            </div>
            <div className="text-center p-2 bg-muted/30 rounded-lg">
              <p
                className={cn(
                  "text-lg font-bold",
                  market.delta !== null && market.delta >= 0 ? "text-emerald-500" : "text-rose-500"
                )}
              >
                {market.delta !== null ? `${market.delta >= 0 ? "+" : ""}${(market.delta * 100).toFixed(0)}pt` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Delta</p>
            </div>
            <div className="text-center p-2 bg-muted/30 rounded-lg">
              <Badge variant="outline" className={cn("text-xs border", signalDisplay.bgColor, signalDisplay.color)}>
                {signalDisplay.icon}
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">{signalDisplay.label}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100vh-200px)] p-4 space-y-4">
          {/* Loading state */}
          {breakdownLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[#00E0AA]" />
            </div>
          )}

          {/* Smart Money Widget */}
          {market.conditionId && (
            <MarketSmartMoneyWidget marketId={market.id} />
          )}

          {/* Smart Money Breakdown */}
          {market.conditionId && (
            <SmartMoneyBreakdownComponent conditionId={market.conditionId} />
          )}

          {/* Quick metrics if no detailed data */}
          {!market.conditionId && (
            <Card className="border border-border/50 p-4">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium">Smart Money Data Pending</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Smart money analysis is being collected for this market. In the meantime, here are the
                available metrics:
              </p>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Users className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-sm font-semibold">{market.smartWalletCount}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Smart Wallets</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-sm font-semibold">{market.superforecasterCount}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Superforecasters</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-1.5 mb-1">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-sm font-semibold">{formatUSD(market.totalInvested)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Total Invested</p>
                </div>
                {market.conviction && (
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Target className="h-3.5 w-3.5 text-[#00E0AA]" />
                      <span className="text-sm font-semibold">{market.conviction.score}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Conviction</p>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-background border-t border-border/50">
          <Link href={`/analysis/market/${market.conditionId || market.id}`}>
            <Button className="w-full bg-[#00E0AA] hover:bg-[#00E0AA]/90 text-black">
              View Full Analysis
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
          <div className="flex items-center justify-center gap-4 mt-3">
            <a
              href={`https://polymarket.com/event/${market.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              View on Polymarket
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
