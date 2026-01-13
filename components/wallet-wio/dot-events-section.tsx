"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap, ArrowUpRight, ArrowDownRight, Plus, Minus, RefreshCw, ExternalLink } from "lucide-react";
import { DotEvent, formatPnL } from "@/hooks/use-wallet-wio";
import Link from "next/link";

interface DotEventsSectionProps {
  dotEvents: DotEvent[];
}

// Action configuration
const ACTION_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  ENTER: {
    label: 'Entered',
    icon: <ArrowUpRight className="h-3.5 w-3.5" />,
    color: 'bg-green-500/10 text-green-500 border-green-500/20',
  },
  EXIT: {
    label: 'Exited',
    icon: <ArrowDownRight className="h-3.5 w-3.5" />,
    color: 'bg-red-500/10 text-red-500 border-red-500/20',
  },
  ADD: {
    label: 'Added',
    icon: <Plus className="h-3.5 w-3.5" />,
    color: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  },
  REDUCE: {
    label: 'Reduced',
    icon: <Minus className="h-3.5 w-3.5" />,
    color: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  },
  FLIP: {
    label: 'Flipped',
    icon: <RefreshCw className="h-3.5 w-3.5" />,
    color: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  },
};

// Dot type configuration
const DOT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  SUPERFORECASTER: {
    label: 'Superforecaster',
    color: 'bg-purple-500 text-white',
  },
  INSIDER: {
    label: 'Insider',
    color: 'bg-amber-500 text-black',
  },
  SMART_MONEY: {
    label: 'Smart Money',
    color: 'bg-[#00E0AA] text-black',
  },
};

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  if (diffMins < 10080) return `${Math.floor(diffMins / 1440)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function DotEventsSection({ dotEvents }: DotEventsSectionProps) {
  if (dotEvents.length === 0) {
    return null; // Don't show section if no dot events
  }

  return (
    <Card className="p-6 border-border/50 border-2 border-[#00E0AA]/20 bg-[#00E0AA]/5">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5 text-[#00E0AA]" />
          Smart Money Signals
        </h2>
        <Badge variant="outline" className="border-[#00E0AA]/30 text-[#00E0AA]">
          {dotEvents.length} signals
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        This wallet has been identified as a credible trader. These are their recent significant moves.
      </p>

      <div className="space-y-3">
        {dotEvents.map((event) => {
          const actionConfig = ACTION_CONFIG[event.action] || ACTION_CONFIG.ENTER;
          const typeConfig = DOT_TYPE_CONFIG[event.dot_type] || DOT_TYPE_CONFIG.SMART_MONEY;

          return (
            <Card
              key={event.dot_id}
              className="p-4 bg-card/50 border-border/50 hover:bg-card/70 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Market & Action */}
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Badge className={actionConfig.color}>
                      {actionConfig.icon}
                      <span className="ml-1">{actionConfig.label}</span>
                    </Badge>
                    <Badge variant={event.side === 'YES' ? 'default' : 'secondary'}>
                      {event.side}
                    </Badge>
                    <Badge className={typeConfig.color}>
                      {typeConfig.label}
                    </Badge>
                  </div>

                  {/* Market Question */}
                  <Link
                    href={`/analysis/market/${event.market_id}`}
                    className="font-medium text-sm line-clamp-2 hover:text-[#00E0AA] transition-colors group"
                  >
                    {event.question || `Market ${event.market_id.slice(0, 8)}...`}
                    <ExternalLink className="h-3 w-3 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>

                  {/* Reason Tags */}
                  {event.reason_metrics && event.reason_metrics.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {event.reason_metrics.map((reason, idx) => (
                        <span
                          key={idx}
                          className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                        >
                          {reason.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right side: Size & Time */}
                <div className="text-right flex-shrink-0">
                  <div className="font-semibold text-[#00E0AA]">
                    {formatPnL(event.size_usd)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    @ ${event.entry_price.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatTimeAgo(event.ts)}
                  </div>
                </div>
              </div>

              {/* Crowd Odds Context */}
              {event.crowd_odds > 0 && (
                <div className="mt-2 pt-2 border-t border-border/30">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Crowd odds at entry:</span>
                    <span className="font-mono">{(event.crowd_odds * 100).toFixed(0)}%</span>
                  </div>
                  {event.confidence > 0 && (
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Signal confidence:</span>
                      <span className="font-mono">{(event.confidence * 100).toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </Card>
  );
}
