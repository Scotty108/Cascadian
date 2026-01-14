"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, ArrowUpDown, ChevronDown } from "lucide-react";
import type { Trade } from "@/hooks/use-wallet-wio";

interface TradeHistoryProps {
  trades: Trade[];
}

type SortField = "time" | "amount" | "shares" | "price";
type SortDirection = "asc" | "desc";

function formatCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount >= 0 ? "" : "-";
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  if (diffMins < 10080) return `${Math.floor(diffMins / 1440)}d ago`;
  return `${Math.floor(diffMins / 10080)}w ago`;
}

function formatPrice(value: number): string {
  return `${Math.round(value * 100)}¢`;
}

export function TradeHistory({ trades }: TradeHistoryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("time");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const filteredAndSorted = useMemo(() => {
    let result = [...trades];

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.action?.toLowerCase().includes(query) ||
          t.side?.toLowerCase().includes(query) ||
          t.event_id?.toLowerCase().includes(query)
      );
    }

    // Sort
    result.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case "time":
          aVal = new Date(a.trade_time || 0).getTime();
          bVal = new Date(b.trade_time || 0).getTime();
          break;
        case "amount":
          aVal = a.amount_usd || 0;
          bVal = b.amount_usd || 0;
          break;
        case "shares":
          aVal = a.shares || 0;
          bVal = b.shares || 0;
          break;
        case "price":
          aVal = a.price || 0;
          bVal = b.price || 0;
          break;
        default:
          aVal = 0;
          bVal = 0;
      }
      return sortDirection === "desc" ? bVal - aVal : aVal - bVal;
    });

    return result;
  }, [trades, searchQuery, sortField, sortDirection]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  if (!trades || trades.length === 0) {
    return null;
  }

  return (
    <Card className="overflow-hidden border-border/50">
      {/* Header with search and sort */}
      <div className="p-4 border-b border-border/50">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Title badge */}
          <div className="flex items-center gap-2 bg-muted rounded-lg px-4 py-1.5">
            <span className="text-sm font-medium">Recent Trades</span>
            <Badge variant="outline" className="font-mono text-xs">
              {trades.length}
            </Badge>
          </div>

          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search trades"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-muted border-0"
            />
          </div>

          {/* Sort dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <ArrowUpDown className="h-4 w-4" />
                {sortField.charAt(0).toUpperCase() + sortField.slice(1)}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toggleSort("time")}>
                Time {sortField === "time" && (sortDirection === "desc" ? "↓" : "↑")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleSort("amount")}>
                Amount {sortField === "amount" && (sortDirection === "desc" ? "↓" : "↑")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleSort("shares")}>
                Shares {sortField === "shares" && (sortDirection === "desc" ? "↓" : "↑")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleSort("price")}>
                Price {sortField === "price" && (sortDirection === "desc" ? "↓" : "↑")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table header */}
      <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 border-b border-border/50 text-xs font-medium text-muted-foreground uppercase">
        <div className="col-span-5">Market</div>
        <div className="col-span-2 text-center">Action</div>
        <div className="col-span-2 text-right">Shares</div>
        <div className="col-span-1 text-right">Price</div>
        <div className="col-span-2 text-right">Amount</div>
      </div>

      {/* Trades list */}
      <div className="divide-y divide-border/50">
        {filteredAndSorted.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {searchQuery ? "No trades match your search" : "No trades"}
          </div>
        ) : (
          filteredAndSorted.slice(0, 50).map((trade, idx) => (
            <TradeRow key={trade.event_id || idx} trade={trade} />
          ))
        )}
      </div>

      {/* Show more indicator */}
      {filteredAndSorted.length > 50 && (
        <div className="p-4 text-center text-sm text-muted-foreground border-t border-border/50">
          Showing 50 of {filteredAndSorted.length} trades
        </div>
      )}
    </Card>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const isBuy = trade.side === "buy";
  const isMaker = trade.action === "maker";

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 p-4 hover:bg-muted/50 transition-colors">
      {/* Trade info */}
      <div className="col-span-1 md:col-span-5 flex items-start gap-3">
        {/* Token indicator */}
        <div className={`w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-bold ${isBuy ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
          {isBuy ? "BUY" : "SELL"}
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm leading-tight">
            {trade.shares?.toLocaleString(undefined, { maximumFractionDigits: 0 })} shares @ {formatPrice(trade.price)}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant="outline"
              className={`${isBuy ? "text-[#00E0AA]" : "text-red-400"} border-0 bg-transparent px-0 text-xs font-medium`}
            >
              {isBuy ? "Buy" : "Sell"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatTimeAgo(trade.trade_time)}
            </span>
          </div>
        </div>
      </div>

      {/* Action + Side */}
      <div className="hidden md:flex col-span-2 items-center justify-center gap-2">
        <Badge
          variant="outline"
          className={
            isMaker
              ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
              : "bg-amber-500/10 text-amber-600 border-amber-500/20"
          }
        >
          {trade.action?.toUpperCase()}
        </Badge>
        <Badge
          variant="outline"
          className={
            isBuy
              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
              : "bg-red-500/10 text-red-600 border-red-500/20"
          }
        >
          {trade.side?.toUpperCase()}
        </Badge>
      </div>

      {/* Shares */}
      <div className="hidden md:flex col-span-2 items-center justify-end">
        <span className="text-sm font-mono">
          {trade.shares?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>

      {/* Price */}
      <div className="hidden md:flex col-span-1 items-center justify-end">
        <span className="text-sm font-mono">{formatPrice(trade.price)}</span>
      </div>

      {/* Amount */}
      <div className="col-span-1 md:col-span-2 flex flex-col items-end justify-center">
        <span className="font-semibold">{formatCurrency(trade.amount_usd)}</span>
      </div>

      {/* Mobile: show details inline */}
      <div className="md:hidden flex justify-between text-xs text-muted-foreground">
        <div className="flex gap-2">
          <Badge
            variant="outline"
            className={
              isMaker
                ? "bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs"
                : "bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs"
            }
          >
            {trade.action?.toUpperCase()}
          </Badge>
          <Badge
            variant="outline"
            className={
              isBuy
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs"
                : "bg-red-500/10 text-red-600 border-red-500/20 text-xs"
            }
          >
            {trade.side?.toUpperCase()}
          </Badge>
        </div>
        <span>{trade.shares?.toLocaleString()} @ {formatPrice(trade.price)}</span>
      </div>
    </div>
  );
}
