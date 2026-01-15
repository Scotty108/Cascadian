"use client";

import { usePositionTrades } from "@/hooks/use-position-trades";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import type { TradeWithFifo } from "@/lib/pnl/fifoBreakdown";

interface PositionTradesPanelProps {
  wallet: string;
  conditionId: string;
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "" : "-";
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatPrice(value: number): string {
  return `${Math.round(value * 100)}¢`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function TradeRow({ trade }: { trade: TradeWithFifo }) {
  const isBuy = trade.side === "BUY";
  const isYes = trade.outcome === "YES";

  return (
    <div
      className={`grid grid-cols-12 gap-2 px-3 py-2 text-sm border-l-2 ${
        isBuy
          ? "border-l-emerald-500 bg-emerald-500/5"
          : "border-l-red-500 bg-red-500/5"
      }`}
    >
      {/* Date/Time */}
      <div className="col-span-3 md:col-span-2 text-muted-foreground text-xs">
        {formatDateTime(trade.trade_time)}
      </div>

      {/* Action + Outcome + Maker/Taker */}
      <div className="col-span-3 md:col-span-2 flex items-center gap-1">
        <Badge
          variant="outline"
          className={`text-xs px-1.5 py-0 ${
            isBuy
              ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
              : "text-red-500 border-red-500/30 bg-red-500/10"
          }`}
        >
          {trade.side}
        </Badge>
        <Badge
          variant="outline"
          className={`text-xs px-1.5 py-0 ${
            isYes
              ? "text-[#00E0AA] border-[#00E0AA]/30 bg-[#00E0AA]/10"
              : "text-red-400 border-red-400/30 bg-red-400/10"
          }`}
        >
          {trade.outcome}
        </Badge>
        <span className="text-[10px] text-muted-foreground uppercase">
          {trade.action === "maker" ? "M" : "T"}
        </span>
      </div>

      {/* Shares */}
      <div className="col-span-2 text-right">
        {trade.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </div>

      {/* Price */}
      <div className="col-span-2 md:col-span-1 text-right text-muted-foreground">
        {formatPrice(trade.price)}
      </div>

      {/* Cost/Proceeds */}
      <div className="col-span-2 text-right">
        {isBuy ? (
          <span className="text-muted-foreground">
            {formatCurrency(trade.cost_usd)}
          </span>
        ) : (
          <span>{formatCurrency(trade.proceeds_usd)}</span>
        )}
      </div>

      {/* ROI (sells only) - hidden on mobile */}
      <div className="hidden md:block col-span-1 text-right">
        {trade.roi !== null ? (
          <span
            className={
              trade.roi > 0 ? "text-emerald-600" : trade.roi < 0 ? "text-red-500" : "text-muted-foreground"
            }
          >
            {formatPercent(trade.roi)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>

      {/* PnL (sells only) - hidden on mobile */}
      <div className="hidden md:block col-span-2 text-right">
        {trade.realized_pnl !== null ? (
          <span
            className={
              trade.realized_pnl > 0 ? "text-emerald-600" : trade.realized_pnl < 0 ? "text-red-500" : "text-muted-foreground"
            }
          >
            {formatCurrency(trade.realized_pnl)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

export function PositionTradesPanel({
  wallet,
  conditionId,
}: PositionTradesPanelProps) {
  const { trades, isLoading, error } = usePositionTrades(
    wallet,
    conditionId
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading trades...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        Failed to load trades: {error}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        No trade history available
      </div>
    );
  }

  // Calculate totals
  const totalBuyCost = trades
    .filter((t) => t.side === "BUY")
    .reduce((sum, t) => sum + t.cost_usd, 0);
  const totalSellProceeds = trades
    .filter((t) => t.side === "SELL")
    .reduce((sum, t) => sum + t.proceeds_usd, 0);
  const totalRealizedPnl = trades
    .filter((t) => t.realized_pnl !== null)
    .reduce((sum, t) => sum + (t.realized_pnl || 0), 0);

  return (
    <div className="bg-muted/30 rounded-md overflow-hidden">
      {/* Header */}
      <div className="hidden md:grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground uppercase border-b border-border/50">
        <div className="col-span-2">Date</div>
        <div className="col-span-2">Action</div>
        <div className="col-span-2 text-right">Shares</div>
        <div className="col-span-1 text-right">Price</div>
        <div className="col-span-2 text-right">Cost/Proceeds</div>
        <div className="col-span-1 text-right">ROI</div>
        <div className="col-span-2 text-right">P&L</div>
      </div>

      {/* Trades */}
      <div className="divide-y divide-border/30">
        {trades.map((trade) => (
          <TradeRow key={trade.event_id} trade={trade} />
        ))}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-12 gap-2 px-3 py-2 text-sm border-t border-border/50 bg-muted/50">
        <div className="col-span-5 md:col-span-6 text-muted-foreground font-medium">
          Summary ({trades.length} trades)
        </div>
        <div className="col-span-3 md:col-span-2 text-right text-muted-foreground">
          {trades.filter((t) => t.side === "BUY").length > 0 && (
            <span>Cost: {formatCurrency(totalBuyCost)}</span>
          )}
        </div>
        <div className="hidden md:block col-span-2 text-right">
          {/* ROI placeholder */}
        </div>
        <div className="col-span-4 md:col-span-2 text-right">
          {totalRealizedPnl !== 0 && (
            <span
              className={`font-medium ${
                totalRealizedPnl > 0 ? "text-emerald-600" : totalRealizedPnl < 0 ? "text-red-500" : "text-muted-foreground"
              }`}
            >
              {formatCurrency(totalRealizedPnl)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
