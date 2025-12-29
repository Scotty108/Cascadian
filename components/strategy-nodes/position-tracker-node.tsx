/**
 * POSITION TRACKER NODE
 *
 * Displays paper positions from copy trades.
 * Shows open positions, P&L, and resolved markets.
 */

"use client"

import { memo, useEffect, useState, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
import {
  Briefcase,
  TrendingUp,
  TrendingDown,
  DollarSign,
  RefreshCw,
  CheckCircle,
  Clock,
  Target,
} from "lucide-react"
import type { PaperPosition, PositionSummary } from "@/lib/copytrade/positionStore"

// ============================================================================
// Types
// ============================================================================

interface PositionTrackerNodeProps {
  data: {
    config?: {
      showResolved?: boolean;
      maxPositionsDisplayed?: number;
    };
    status?: "idle" | "running" | "error";
  };
  selected?: boolean;
  id: string;
}

// ============================================================================
// Component
// ============================================================================

function PositionTrackerNode({ data, selected }: PositionTrackerNodeProps) {
  const config = data.config || {};
  const maxDisplay = config.maxPositionsDisplayed || 5;

  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [summary, setSummary] = useState<PositionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPositions = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/copytrade/positions");
      const result = await response.json();
      if (result.success) {
        setPositions(result.data.positions);
        setSummary(result.data.summary);
      }
    } catch (err) {
      console.error("Failed to fetch positions:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 5000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  // Filter positions for display
  const displayPositions = config.showResolved
    ? positions.slice(0, maxDisplay)
    : positions.filter(p => p.status === "open").slice(0, maxDisplay);

  const borderColor = data.status === "error"
    ? "border-red-500 bg-red-500/5"
    : "border-border";

  return (
    <div
      data-testid="position-tracker-node"
      className={`rounded-2xl border-2 ${borderColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2 border-[#00E0AA]" : ""
      } bg-gradient-to-br from-emerald-500/10 to-teal-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[300px] max-w-[340px] antialiased`}
      style={{ backfaceVisibility: "hidden", transform: "translateZ(0)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-500/20 p-1.5">
              <Briefcase className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="font-semibold text-sm">Position Tracker</div>
          </div>
          <button
            onClick={fetchPositions}
            disabled={isLoading}
            className="p-1 rounded hover:bg-muted/50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="px-4 py-2 border-b border-emerald-500/10 bg-muted/20">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="text-center">
              <div className="text-muted-foreground">Open</div>
              <div className="font-bold text-emerald-600">{summary.openPositions}</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">Unrealized</div>
              <div className={`font-bold ${summary.totalUnrealizedPnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                {summary.totalUnrealizedPnl >= 0 ? "+" : ""}${summary.totalUnrealizedPnl.toFixed(2)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">Realized</div>
              <div className={`font-bold ${summary.totalRealizedPnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                {summary.totalRealizedPnl >= 0 ? "+" : ""}${summary.totalRealizedPnl.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Positions List */}
      <div className="px-4 py-3 space-y-2">
        {displayPositions.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4 bg-muted/20 rounded-lg">
            No positions yet. Copy trades will appear here.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {displayPositions.map((position) => {
              const pnl = position.realizedPnl ?? position.unrealizedPnl ?? 0;
              const pnlPositive = pnl >= 0;

              return (
                <div
                  key={position.positionId}
                  className={`flex items-center justify-between text-xs rounded-lg px-2 py-1.5 ${
                    position.status === "open"
                      ? "bg-emerald-500/10"
                      : position.status === "resolved"
                      ? "bg-blue-500/10"
                      : "bg-muted/30"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {position.status === "open" ? (
                      <Clock className="h-3 w-3 text-emerald-500" />
                    ) : position.status === "resolved" ? (
                      <CheckCircle className="h-3 w-3 text-blue-500" />
                    ) : (
                      <Target className="h-3 w-3 text-gray-500" />
                    )}
                    <span className={position.side === "buy" ? "text-green-600" : "text-red-600"}>
                      {position.side.toUpperCase()}
                    </span>
                    <span className="font-medium truncate">{position.outcome}</span>
                    <span className="text-muted-foreground">@{position.entryPrice.toFixed(2)}</span>
                  </div>
                  <div className={`flex items-center gap-1 shrink-0 font-semibold ${pnlPositive ? "text-green-600" : "text-red-600"}`}>
                    {pnlPositive ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {pnlPositive ? "+" : ""}${pnl.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Win Rate */}
        {summary && summary.winCount + summary.lossCount > 0 && (
          <div className="flex items-center justify-between text-xs pt-2 border-t border-emerald-500/10">
            <span className="text-muted-foreground">Win Rate</span>
            <span className="font-semibold">
              {summary.winRate.toFixed(0)}% ({summary.winCount}W / {summary.lossCount}L)
            </span>
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-emerald-500 !border-2 !border-emerald-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-emerald-500 !border-2 !border-emerald-600 !w-3 !h-3"
      />
    </div>
  );
}

export default memo(PositionTrackerNode);
