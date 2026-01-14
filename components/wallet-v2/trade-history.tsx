"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, ChevronDown } from "lucide-react";
import type { Trade } from "@/hooks/use-wallet-wio";

interface TradeHistoryProps {
  trades: Trade[];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
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

export function TradeHistory({ trades }: TradeHistoryProps) {
  const [showAll, setShowAll] = useState(false);

  if (!trades || trades.length === 0) {
    return null;
  }

  const displayedTrades = showAll ? trades : trades.slice(0, 15);

  return (
    <Card className="p-6 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-[#00E0AA]" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Recent Trades
          </h2>
        </div>
        <Badge variant="outline" className="font-mono">
          {trades.length}
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedTrades.map((trade, index) => (
              <TableRow key={trade.event_id || index}>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {formatTimeAgo(trade.trade_time)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      trade.action === "maker"
                        ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                        : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                    }
                  >
                    {trade.action.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      trade.side === "sell"
                        ? "bg-red-500/10 text-red-600 border-red-500/20"
                        : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    }
                  >
                    {trade.side.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {trade.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(trade.price)}
                </TableCell>
                <TableCell className="text-right font-semibold font-mono">
                  {formatCurrency(trade.amount_usd)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {trades.length > 15 && (
        <div className="mt-4 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll(!showAll)}
            className="gap-1"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showAll ? "rotate-180" : ""}`}
            />
            {showAll ? "Show Less" : `Show All ${trades.length} Trades`}
          </Button>
        </div>
      )}
    </Card>
  );
}
