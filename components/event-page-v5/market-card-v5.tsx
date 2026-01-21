"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Sparkles, Users, DollarSign } from "lucide-react";
import type { SmartMarketData } from "../event-page-v3/hooks/use-event-smart-summary";

interface MarketCardV5Props {
  market: SmartMarketData;
  rank: number;
  color: string;
  isHovered: boolean;
  onHover: (hovered: boolean) => void;
  onClick: () => void;
}

export function MarketCardV5({
  market,
  rank,
  color,
  isHovered,
  onHover,
  onClick,
}: MarketCardV5Props) {
  const crowdOdds = market.crowdOdds * 100;
  const smartOdds = market.smartOdds !== null ? market.smartOdds * 100 : null;
  const divergence = market.delta ? market.delta * 100 : null;
  const signal = market.signal;

  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
    return `$${vol.toFixed(0)}`;
  };

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        "relative w-full text-left rounded-2xl border transition-all duration-200",
        "bg-card/50 backdrop-blur-sm overflow-hidden group",
        isHovered
          ? "border-[#00E0AA]/40 shadow-lg shadow-[#00E0AA]/10 scale-[1.02]"
          : "border-border hover:border-border/80"
      )}
    >
      {/* Rank Badge */}
      <div
        className="absolute top-4 left-4 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
        style={{ backgroundColor: `${color}20`, color }}
      >
        {rank}
      </div>

      {/* Content */}
      <div className="relative p-5 pt-14">
        {/* Market Image & Title */}
        <div className="flex items-start gap-3 mb-4">
          {market.image ? (
            <div
              className={cn(
                "w-14 h-14 rounded-xl overflow-hidden border-2 transition-all flex-shrink-0",
                isHovered ? "border-[#00E0AA]/50" : "border-border"
              )}
            >
              <img src={market.image} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${color}15` }}
            >
              <span className="text-2xl font-bold" style={{ color }}>
                {(market.shortName || market.question)[0]}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold leading-tight line-clamp-2 group-hover:text-[#00E0AA] transition-colors">
              {market.shortName || market.question}
            </h3>
          </div>
        </div>

        {/* Large Probability Display */}
        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Crowd Odds</p>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-mono font-bold tabular-nums">
                {crowdOdds.toFixed(0)}
              </span>
              <span className="text-xl font-mono text-muted-foreground">%</span>
            </div>
          </div>

          {smartOdds !== null && (
            <div className="text-right">
              <p className="text-xs text-[#00E0AA] mb-1 flex items-center gap-1 justify-end">
                <Sparkles className="w-3 h-3" />
                Smart Money
              </p>
              <div className="flex items-baseline gap-1 justify-end">
                <span className="text-2xl font-mono font-bold text-[#00E0AA] tabular-nums">
                  {smartOdds.toFixed(0)}
                </span>
                <span className="text-sm font-mono text-[#00E0AA]/70">%</span>
              </div>
            </div>
          )}
        </div>

        {/* Probability Bar */}
        <div className="mb-4">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="relative h-full rounded-full overflow-hidden">
              {/* Crowd odds bar */}
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                style={{
                  width: `${crowdOdds}%`,
                  backgroundColor: color,
                  opacity: 0.6,
                }}
              />
              {/* Smart money marker */}
              {smartOdds !== null && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-1 h-4 bg-[#00E0AA] rounded-full shadow-sm shadow-[#00E0AA]/50"
                  style={{ left: `${smartOdds}%` }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex items-center justify-between text-xs">
          {/* Divergence Badge */}
          {divergence !== null && Math.abs(divergence) > 2 ? (
            <div
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md font-medium",
                divergence > 0
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-rose-500/10 text-rose-500"
              )}
            >
              {divergence > 0 ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              {divergence > 0 ? "+" : ""}{divergence.toFixed(0)}pt divergence
            </div>
          ) : (
            <div className="text-muted-foreground">No signal</div>
          )}

          {/* Volume */}
          {market.totalInvested > 0 && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <DollarSign className="w-3.5 h-3.5" />
              <span className="font-mono">{formatVolume(market.totalInvested)}</span>
            </div>
          )}
        </div>

        {/* Signal Badge */}
        {signal && signal !== "NEUTRAL" && (
          <div
            className={cn(
              "absolute top-4 right-4 px-2 py-1 rounded-md text-xs font-semibold uppercase tracking-wider",
              signal === "BULLISH"
                ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
            )}
          >
            {signal}
          </div>
        )}

        {/* Superforecaster Badge */}
        {market.superforecasterCount > 0 && (
          <div className="absolute bottom-4 right-4 flex items-center gap-1 text-xs text-[#FBBF24]">
            <Users className="w-3.5 h-3.5" />
            <span className="font-mono">{market.superforecasterCount}</span>
          </div>
        )}
      </div>
    </button>
  );
}
