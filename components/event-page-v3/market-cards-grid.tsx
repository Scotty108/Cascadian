"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LayoutGrid,
  ArrowUpDown,
  TrendingUp,
  DollarSign,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SmartMarketCard } from "./smart-market-card";
import type { SmartMarketData } from "./hooks/use-event-smart-summary";

interface MarketCardsGridProps {
  markets: SmartMarketData[];
  onMarketSelect: (market: SmartMarketData) => void;
}

type SortOption = "activity" | "delta" | "odds" | "confidence";

const sortOptions: { value: SortOption; label: string; icon: React.ReactNode }[] = [
  { value: "activity", label: "Smart $ Activity", icon: <DollarSign className="h-3 w-3" /> },
  { value: "delta", label: "Largest Delta", icon: <TrendingUp className="h-3 w-3" /> },
  { value: "odds", label: "Smart Odds", icon: <ArrowUpDown className="h-3 w-3" /> },
  { value: "confidence", label: "Conviction", icon: <Users className="h-3 w-3" /> },
];

export function MarketCardsGrid({ markets, onMarketSelect }: MarketCardsGridProps) {
  const [sortBy, setSortBy] = useState<SortOption>("activity");
  const [showAll, setShowAll] = useState(false);

  // Sort markets based on selected option
  const sortedMarkets = useMemo(() => {
    const sorted = [...markets];

    switch (sortBy) {
      case "activity":
        // Already sorted by activity in the hook, but re-sort to be safe
        return sorted.sort((a, b) => {
          if (a.hasSmartMoneyData && !b.hasSmartMoneyData) return -1;
          if (!a.hasSmartMoneyData && b.hasSmartMoneyData) return 1;
          return b.totalInvested - a.totalInvested;
        });

      case "delta":
        // Sort by absolute delta (biggest divergence first)
        return sorted.sort((a, b) => {
          const deltaA = a.delta !== null ? Math.abs(a.delta) : -1;
          const deltaB = b.delta !== null ? Math.abs(b.delta) : -1;
          return deltaB - deltaA;
        });

      case "odds":
        // Sort by smart odds (highest first)
        return sorted.sort((a, b) => {
          const oddsA = a.smartOdds ?? a.crowdOdds;
          const oddsB = b.smartOdds ?? b.crowdOdds;
          return oddsB - oddsA;
        });

      case "confidence":
        // Sort by conviction score
        return sorted.sort((a, b) => {
          const confA = a.conviction?.score ?? -1;
          const confB = b.conviction?.score ?? -1;
          return confB - confA;
        });

      default:
        return sorted;
    }
  }, [markets, sortBy]);

  // Separate markets with and without data
  const { marketsWithData, marketsPending } = useMemo(() => {
    const withData = sortedMarkets.filter((m) => m.hasSmartMoneyData);
    const pending = sortedMarkets.filter((m) => !m.hasSmartMoneyData);
    return { marketsWithData: withData, marketsPending: pending };
  }, [sortedMarkets]);

  // Determine what to display
  const displayMarkets = showAll ? sortedMarkets : sortedMarkets.slice(0, 8);
  const hasMoreMarkets = sortedMarkets.length > 8;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">All Markets</h2>
          <Badge variant="outline" className="text-xs">
            {markets.length} total
          </Badge>
          {marketsWithData.length > 0 && (
            <Badge variant="outline" className="text-xs bg-[#00E0AA]/10 text-[#00E0AA] border-[#00E0AA]/30">
              {marketsWithData.length} with smart data
            </Badge>
          )}
        </div>

        {/* Sort options */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-2">Sort by:</span>
          {sortOptions.map((option) => (
            <Button
              key={option.value}
              variant={sortBy === option.value ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "h-7 text-xs px-2",
                sortBy === option.value && "bg-[#00E0AA]/10 text-[#00E0AA] hover:bg-[#00E0AA]/20"
              )}
              onClick={() => setSortBy(option.value)}
            >
              {option.icon}
              <span className="ml-1 hidden sm:inline">{option.label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {displayMarkets.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {displayMarkets.map((market) => (
              <SmartMarketCard
                key={market.id}
                market={market}
                onClick={() => onMarketSelect(market)}
              />
            ))}
          </div>

          {/* Show more button */}
          {hasMoreMarkets && !showAll && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => setShowAll(true)}
                className="px-8"
              >
                Show All {sortedMarkets.length} Markets
              </Button>
            </div>
          )}

          {showAll && hasMoreMarkets && (
            <div className="flex justify-center pt-4">
              <Button
                variant="ghost"
                onClick={() => setShowAll(false)}
                className="text-muted-foreground"
              >
                Show Less
              </Button>
            </div>
          )}
        </>
      ) : (
        <Card className="border border-border/50 p-8 text-center">
          <p className="text-muted-foreground">No markets found for this event.</p>
        </Card>
      )}

      {/* Pending markets notice */}
      {marketsPending.length > 0 && marketsWithData.length > 0 && !showAll && (
        <p className="text-xs text-center text-muted-foreground">
          {marketsPending.length} additional market{marketsPending.length > 1 ? "s" : ""} pending
          smart money data
        </p>
      )}
    </div>
  );
}
