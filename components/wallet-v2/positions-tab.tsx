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
import { OpenPosition, ClosedPosition } from "@/hooks/use-wallet-wio";

interface PositionsTabProps {
  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];
}

type SortField = "value" | "pnl" | "roi" | "date";
type SortDirection = "asc" | "desc";

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "" : "-";
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function formatPrice(value: number): string {
  return `${Math.round(value * 100)}¢`;
}

export function PositionsTab({ openPositions, closedPositions }: PositionsTabProps) {
  const [activeTab, setActiveTab] = useState<"active" | "closed">("closed");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Auto-sort by date when switching to closed tab
  const handleTabChange = (tab: "active" | "closed") => {
    setActiveTab(tab);
    if (tab === "closed") {
      setSortField("date");
      setSortDirection("desc");
    } else {
      setSortField("value");
      setSortDirection("desc");
    }
  };

  // Helper to get common fields from both position types
  const getPositionValue = (p: OpenPosition | ClosedPosition): number => {
    if ("open_cost_usd" in p) return p.open_cost_usd;
    return p.cost_usd;
  };

  const getPositionPnl = (p: OpenPosition | ClosedPosition): number => {
    if ("unrealized_pnl_usd" in p) return p.unrealized_pnl_usd;
    return p.pnl_usd;
  };

  const getPositionRoi = (p: OpenPosition | ClosedPosition): number => {
    if ("unrealized_roi" in p) return p.unrealized_roi;
    return p.roi;
  };

  const positions = activeTab === "active"
    ? openPositions as (OpenPosition | ClosedPosition)[]
    : closedPositions as (OpenPosition | ClosedPosition)[];

  const filteredAndSorted = useMemo(() => {
    let result = [...positions];

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.question?.toLowerCase().includes(query) ||
          p.category?.toLowerCase().includes(query)
      );
    }

    // Sort
    result.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case "value":
          aVal = getPositionValue(a);
          bVal = getPositionValue(b);
          break;
        case "pnl":
          aVal = getPositionPnl(a);
          bVal = getPositionPnl(b);
          break;
        case "roi":
          aVal = getPositionRoi(a);
          bVal = getPositionRoi(b);
          break;
        case "date":
          if ("ts_open" in a && "ts_open" in b) {
            aVal = new Date(a.ts_open || 0).getTime();
            bVal = new Date(b.ts_open || 0).getTime();
          } else {
            aVal = 0;
            bVal = 0;
          }
          break;
        default:
          aVal = 0;
          bVal = 0;
      }
      return sortDirection === "desc" ? bVal - aVal : aVal - bVal;
    });

    return result;
  }, [positions, searchQuery, sortField, sortDirection]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  return (
    <Card className="overflow-hidden border-border/50">
      {/* Header with tabs, search, and sort */}
      <div className="p-4 border-b border-border/50">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Active/Closed tabs */}
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => handleTabChange("active")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "active"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Active ({openPositions.length})
            </button>
            <button
              onClick={() => handleTabChange("closed")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "closed"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Closed ({closedPositions.length})
            </button>
          </div>

          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search positions"
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
              <DropdownMenuItem onClick={() => toggleSort("value")}>
                Value {sortField === "value" && (sortDirection === "desc" ? "↓" : "↑")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleSort("pnl")}>
                PnL {sortField === "pnl" && (sortDirection === "desc" ? "↓" : "↑")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleSort("roi")}>
                ROI {sortField === "roi" && (sortDirection === "desc" ? "↓" : "↑")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleSort("date")}>
                Date {sortField === "date" && (sortDirection === "desc" ? "↓" : "↑")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table header */}
      <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 border-b border-border/50 text-xs font-medium text-muted-foreground uppercase">
        <div className="col-span-6">Market</div>
        <div className="col-span-2 text-right">Avg</div>
        <div className="col-span-2 text-right">{activeTab === "active" ? "Current" : "Exit"}</div>
        <div className="col-span-2 text-right">Value</div>
      </div>

      {/* Positions list */}
      <div className="divide-y divide-border/50">
        {filteredAndSorted.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {searchQuery ? "No positions match your search" : "No positions"}
          </div>
        ) : (
          filteredAndSorted.slice(0, 50).map((position, idx) => (
            <PositionRow
              key={"position_id" in position ? position.position_id : position.market_id + idx}
              position={position}
              isActive={activeTab === "active"}
            />
          ))
        )}
      </div>

      {/* Show more indicator */}
      {filteredAndSorted.length > 50 && (
        <div className="p-4 text-center text-sm text-muted-foreground border-t border-border/50">
          Showing 50 of {filteredAndSorted.length} positions
        </div>
      )}
    </Card>
  );
}

function PositionRow({ position, isActive }: { position: OpenPosition | ClosedPosition; isActive: boolean }) {
  const side = position.side === "YES" ? "Yes" : "No";
  const sideColor = position.side === "YES" ? "text-[#00E0AA]" : "text-red-400";

  // Get values based on position type
  const isOpen = "open_cost_usd" in position;

  const avgPrice = isOpen ? position.avg_entry_price : 0;
  const currentPrice = isOpen ? position.mark_price : ("payout_rate" in position ? 1 : 0);
  const value = isOpen ? position.open_cost_usd : position.cost_usd;
  const pnl = isOpen ? position.unrealized_pnl_usd : position.pnl_usd;
  const roi = isOpen ? position.unrealized_roi : position.roi;
  const shares = isOpen ? position.open_shares_net : value / (avgPrice || 1);

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 p-4 hover:bg-muted/50 transition-colors">
      {/* Market info */}
      <div className="col-span-1 md:col-span-6 flex items-start gap-3">
        {/* Market image */}
        {position.image_url ? (
          <img
            src={position.image_url}
            alt=""
            className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-muted flex-shrink-0 flex items-center justify-center text-xs font-medium">
            {position.category?.[0]?.toUpperCase() || "?"}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm leading-tight line-clamp-2">
            {position.question || "Unknown Market"}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className={`${sideColor} border-0 bg-transparent px-0 text-xs font-medium`}>
              {side}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {shares.toLocaleString(undefined, { maximumFractionDigits: 1 })} shares at {formatPrice(avgPrice)}
            </span>
          </div>
        </div>
      </div>

      {/* Avg price */}
      <div className="hidden md:flex col-span-2 items-center justify-end">
        <span className="text-sm">{formatPrice(avgPrice)}</span>
      </div>

      {/* Current/Exit price */}
      <div className="hidden md:flex col-span-2 items-center justify-end">
        <span className="text-sm">
          {isActive ? formatPrice(currentPrice) : formatPrice(currentPrice)}
        </span>
      </div>

      {/* Value + PnL */}
      <div className="col-span-1 md:col-span-2 flex flex-col items-end justify-center">
        <span className="font-medium">{formatCurrency(value)}</span>
        <span className={`text-sm ${pnl >= 0 ? "text-[#00E0AA]" : "text-red-500"}`}>
          {formatCurrency(pnl)} ({formatPercent(roi)})
        </span>
      </div>

      {/* Mobile: show avg/current inline */}
      <div className="md:hidden flex justify-between text-xs text-muted-foreground">
        <span>Avg: {formatPrice(avgPrice)}</span>
        <span>Current: {formatPrice(currentPrice)}</span>
      </div>
    </div>
  );
}
