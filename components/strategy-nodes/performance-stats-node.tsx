/**
 * PERFORMANCE STATS NODE
 *
 * Shows overall performance statistics for copy trade strategy.
 * Win rate, P&L over time, best/worst wallets, etc.
 */

"use client"

import { memo, useEffect, useState, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Trophy,
  Target,
  RefreshCw,
  Percent,
  DollarSign,
} from "lucide-react"
import type { PositionSummary } from "@/lib/copytrade/positionStore"

// ============================================================================
// Types
// ============================================================================

interface WalletPerformance {
  wallet: string;
  trades: number;
  pnl: number;
  winRate: number;
}

interface PerformanceData {
  summary: PositionSummary;
  topWallets: WalletPerformance[];
  recentPnl: { date: string; pnl: number }[];
}

interface PerformanceStatsNodeProps {
  data: {
    config?: {
      showTopWallets?: number;
      timeframe?: "7d" | "30d" | "all";
    };
    status?: "idle" | "loading" | "error";
  };
  selected?: boolean;
  id: string;
}

// ============================================================================
// Component
// ============================================================================

function PerformanceStatsNode({ data, selected }: PerformanceStatsNodeProps) {
  const config = data.config || {};
  const showTopWallets = config.showTopWallets || 3;

  const [perfData, setPerfData] = useState<PerformanceData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPerformance = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/copytrade/performance");
      const result = await response.json();
      if (result.success) {
        setPerfData(result.data);
      }
    } catch (err) {
      console.error("Failed to fetch performance:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPerformance();
    const interval = setInterval(fetchPerformance, 10000);
    return () => clearInterval(interval);
  }, [fetchPerformance]);

  const summary = perfData?.summary;
  const topWallets = perfData?.topWallets?.slice(0, showTopWallets) || [];

  const totalPnl = (summary?.totalRealizedPnl || 0) + (summary?.totalUnrealizedPnl || 0);
  const isProfitable = totalPnl >= 0;

  return (
    <div
      data-testid="performance-stats-node"
      className={`rounded-2xl border-2 ${
        isProfitable ? "border-green-500/50" : "border-red-500/50"
      } ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-indigo-500/10 to-purple-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[320px] max-w-[360px] antialiased`}
      style={{ backfaceVisibility: "hidden", transform: "translateZ(0)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-indigo-500/20 bg-indigo-500/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-indigo-500/20 p-1.5">
              <BarChart3 className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="font-semibold text-sm">Performance</div>
          </div>
          <button
            onClick={fetchPerformance}
            disabled={isLoading}
            className="p-1 rounded hover:bg-muted/50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main Stats */}
      <div className="px-4 py-3 space-y-3">
        {/* Total P&L */}
        <div className={`text-center py-3 rounded-xl ${isProfitable ? "bg-green-500/10" : "bg-red-500/10"}`}>
          <div className="text-xs text-muted-foreground mb-1">Total P&L</div>
          <div className={`text-2xl font-bold flex items-center justify-center gap-1 ${isProfitable ? "text-green-600" : "text-red-600"}`}>
            {isProfitable ? (
              <TrendingUp className="h-5 w-5" />
            ) : (
              <TrendingDown className="h-5 w-5" />
            )}
            {isProfitable ? "+" : ""}${totalPnl.toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Realized: ${summary?.totalRealizedPnl?.toFixed(2) || "0.00"} |
            Unrealized: ${summary?.totalUnrealizedPnl?.toFixed(2) || "0.00"}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 bg-muted/20 rounded-lg">
            <Target className="h-3.5 w-3.5 mx-auto text-indigo-500 mb-1" />
            <div className="text-lg font-bold">{summary?.totalPositions || 0}</div>
            <div className="text-[10px] text-muted-foreground">Positions</div>
          </div>
          <div className="text-center p-2 bg-muted/20 rounded-lg">
            <Percent className="h-3.5 w-3.5 mx-auto text-indigo-500 mb-1" />
            <div className="text-lg font-bold">{summary?.winRate?.toFixed(0) || 0}%</div>
            <div className="text-[10px] text-muted-foreground">Win Rate</div>
          </div>
          <div className="text-center p-2 bg-muted/20 rounded-lg">
            <DollarSign className="h-3.5 w-3.5 mx-auto text-indigo-500 mb-1" />
            <div className="text-lg font-bold">${summary?.totalInvested?.toFixed(0) || 0}</div>
            <div className="text-[10px] text-muted-foreground">Invested</div>
          </div>
        </div>

        {/* Win/Loss Record */}
        {summary && (summary.winCount > 0 || summary.lossCount > 0) && (
          <div className="flex items-center justify-between text-xs px-2 py-1.5 bg-muted/10 rounded-lg">
            <span className="text-muted-foreground">Record</span>
            <span>
              <span className="text-green-600 font-semibold">{summary.winCount}W</span>
              {" / "}
              <span className="text-red-600 font-semibold">{summary.lossCount}L</span>
              {" / "}
              <span className="text-muted-foreground">{summary.openPositions} Open</span>
            </span>
          </div>
        )}

        {/* Top Performing Wallets */}
        {topWallets.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-indigo-500/10">
            <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
              <Trophy className="h-3 w-3 text-yellow-500" />
              Top Wallets
            </div>
            {topWallets.map((wallet, idx) => (
              <div
                key={wallet.wallet}
                className="flex items-center justify-between text-xs bg-muted/20 rounded px-2 py-1"
              >
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${idx === 0 ? "text-yellow-500" : idx === 1 ? "text-gray-400" : "text-amber-700"}`}>
                    #{idx + 1}
                  </span>
                  <span className="font-mono">{wallet.wallet.slice(0, 8)}...</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{wallet.trades} trades</span>
                  <span className={wallet.pnl >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                    {wallet.pnl >= 0 ? "+" : ""}${wallet.pnl.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!summary || summary.totalPositions === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4 bg-muted/20 rounded-lg">
            No performance data yet. Start copy trading to see stats.
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-indigo-500 !border-2 !border-indigo-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-indigo-500 !border-2 !border-indigo-600 !w-3 !h-3"
      />
    </div>
  );
}

export default memo(PerformanceStatsNode);
