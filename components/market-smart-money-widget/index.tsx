"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Users,
  Zap,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Target,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useMarketSmartMoney,
  formatDelta,
  getSignalColor,
  getSignalBgClass,
  type SmartPosition,
  type DotEvent,
} from "@/hooks/use-market-smart-money";
import { TIER_CONFIG, getTierConfig } from "@/hooks/use-wio-leaderboard";

interface MarketSmartMoneyWidgetProps {
  marketId: string;
  compact?: boolean;
}

export function MarketSmartMoneyWidget({
  marketId,
  compact = false,
}: MarketSmartMoneyWidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const {
    snapshot,
    consensus,
    superforecasters,
    dotEvents,
    smartPositions,
    isLoading,
    error,
  } = useMarketSmartMoney({ marketId });

  // Loading state
  if (isLoading) {
    return (
      <Card className={cn("border border-border/50", compact ? "p-4" : "p-6")}>
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#00E0AA]" />
          <span className="text-sm text-muted-foreground">
            Loading smart money analysis...
          </span>
        </div>
      </Card>
    );
  }

  // Error or no data state
  if (error || !consensus) {
    return (
      <Card className={cn("border border-border/50", compact ? "p-4" : "p-6")}>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Brain className="h-5 w-5" />
          <span className="text-sm">No smart money data available for this market</span>
        </div>
      </Card>
    );
  }

  const hasSignal = consensus.signal !== 'NEUTRAL';
  const totalSmartWallets = consensus.yes_wallets + consensus.no_wallets;
  const sfTotal = (superforecasters?.yes_count || 0) + (superforecasters?.no_count || 0);

  // Compact view for event detail page
  if (compact) {
    return (
      <Card className={cn("border", getSignalBgClass(consensus.signal), "p-4")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className={cn("h-5 w-5", getSignalColor(consensus.signal))} />
            <div>
              <div className="text-sm font-semibold">
                Smart Money: <span className={getSignalColor(consensus.signal)}>{consensus.signal}</span>
              </div>
              {snapshot && (
                <div className="text-xs text-muted-foreground">
                  {formatDelta(snapshot.delta)} vs crowd • {totalSmartWallets} smart wallets
                </div>
              )}
            </div>
          </div>
          {hasSignal && (
            <Badge className={cn(getSignalBgClass(consensus.signal), "border")}>
              {(consensus.strength * 100).toFixed(0)}% strength
            </Badge>
          )}
        </div>
      </Card>
    );
  }

  // Full view for market detail page
  return (
    <Card className="border border-border/50 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Brain className="h-5 w-5 text-[#00E0AA]" />
          <h3 className="text-lg font-semibold">WIO Smart Money Analysis</h3>
        </div>
        <Badge variant="outline" className="text-xs">
          <Activity className="h-3 w-3 mr-1" />
          Live from ClickHouse
        </Badge>
      </div>

      {/* Main Signal */}
      <div className={cn("rounded-lg border p-4 mb-6", getSignalBgClass(consensus.signal))}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {consensus.signal === 'BULLISH' ? (
              <TrendingUp className="h-5 w-5 text-emerald-500" />
            ) : consensus.signal === 'BEARISH' ? (
              <TrendingDown className="h-5 w-5 text-rose-500" />
            ) : (
              <Target className="h-5 w-5 text-muted-foreground" />
            )}
            <span className={cn("text-xl font-bold", getSignalColor(consensus.signal))}>
              {consensus.signal}
            </span>
          </div>
          {hasSignal && (
            <div className="text-sm text-muted-foreground">
              Signal strength: <span className="font-semibold">{(consensus.strength * 100).toFixed(0)}%</span>
            </div>
          )}
        </div>

        {snapshot && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div>
              <div className="text-xs text-muted-foreground">Crowd Odds</div>
              <div className="text-lg font-semibold">{(snapshot.crowd_odds * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Smart Money Odds</div>
              <div className="text-lg font-semibold">{(snapshot.smart_money_odds * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Delta</div>
              <div className={cn("text-lg font-semibold", snapshot.delta >= 0 ? "text-emerald-500" : "text-rose-500")}>
                {formatDelta(snapshot.delta)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Smart Wallets</div>
              <div className="text-lg font-semibold">{snapshot.smart_wallet_count}</div>
            </div>
          </div>
        )}
      </div>

      {/* Position Breakdown */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* YES Side */}
        <div className="border border-emerald-500/30 rounded-lg p-4 bg-emerald-500/5">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-sm font-semibold">YES Side</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Smart Wallets</span>
              <span className="font-semibold">{consensus.yes_wallets}</span>
            </div>
            {superforecasters && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Superforecasters</span>
                <span className="font-semibold text-purple-400">{superforecasters.yes_count}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Credibility Sum</span>
              <span className="font-semibold">{consensus.yes_credibility_sum.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* NO Side */}
        <div className="border border-rose-500/30 rounded-lg p-4 bg-rose-500/5">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="text-sm font-semibold">NO Side</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Smart Wallets</span>
              <span className="font-semibold">{consensus.no_wallets}</span>
            </div>
            {superforecasters && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Superforecasters</span>
                <span className="font-semibold text-purple-400">{superforecasters.no_count}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Credibility Sum</span>
              <span className="font-semibold">{consensus.no_credibility_sum.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Superforecaster Positions */}
      {sfTotal > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-semibold">Superforecaster Positions ({sfTotal})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {superforecasters?.yes_positions?.slice(0, 3).map((pos) => (
              <PositionCard key={pos.wallet_id} position={pos} side="YES" />
            ))}
            {superforecasters?.no_positions?.slice(0, 3).map((pos) => (
              <PositionCard key={pos.wallet_id} position={pos} side="NO" />
            ))}
          </div>
        </div>
      )}

      {/* Recent Dot Events */}
      {dotEvents.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="w-full justify-between mb-3"
          >
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              <span>Recent Smart Money Signals ({dotEvents.length})</span>
            </div>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>

          {expanded && (
            <div className="space-y-2">
              {dotEvents.map((event) => (
                <DotEventCard key={event.dot_id} event={event} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function PositionCard({ position, side }: { position: SmartPosition; side: string }) {
  const tierConfig = getTierConfig(position.tier as any);
  const pnlColor = position.unrealized_pnl_usd >= 0 ? 'text-emerald-500' : 'text-rose-500';

  return (
    <div className="border border-border/50 rounded-lg p-3 bg-muted/20">
      <div className="flex items-center justify-between mb-2">
        <Link
          href={`/analysis/wallet/${position.wallet_id}`}
          className="text-xs font-mono text-muted-foreground hover:text-foreground"
        >
          {position.wallet_id.slice(0, 6)}...{position.wallet_id.slice(-4)}
        </Link>
        <Badge className={cn("text-xs border", tierConfig.bgClass, tierConfig.textClass, tierConfig.borderClass)}>
          {tierConfig.shortLabel}
        </Badge>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={cn(side === 'YES' ? 'text-emerald-500' : 'text-rose-500', 'font-semibold')}>
          {side} • ${position.open_cost_usd.toFixed(0)}
        </span>
        <span className={pnlColor}>
          {position.unrealized_pnl_usd >= 0 ? '+' : ''}${position.unrealized_pnl_usd.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function DotEventCard({ event }: { event: DotEvent }) {
  const isEntry = event.action === 'ENTER';
  const timeAgo = getTimeAgo(event.ts);

  return (
    <div className="border border-border/50 rounded-lg p-3 bg-muted/10">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge
            variant={isEntry ? 'default' : 'outline'}
            className={cn(
              "text-xs",
              isEntry
                ? event.side === 'YES'
                  ? 'bg-emerald-600 hover:bg-emerald-600'
                  : 'bg-rose-600 hover:bg-rose-600'
                : 'text-muted-foreground'
            )}
          >
            {event.action} {event.side}
          </Badge>
          <span className="text-xs text-muted-foreground">{timeAgo}</span>
        </div>
        <span className="text-sm font-semibold">${event.size_usd.toFixed(0)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <Link
          href={`/analysis/wallet/${event.wallet_id}`}
          className="font-mono hover:text-foreground"
        >
          {event.wallet_id.slice(0, 6)}...{event.wallet_id.slice(-4)}
        </Link>
        <span>
          {(event.confidence * 100).toFixed(0)}% confidence
        </span>
      </div>
    </div>
  );
}

function getTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return 'Just now';
}
