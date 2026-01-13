"use client";

import { useState } from "react";
import { motion } from "framer-motion";
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
import type { WalletTrade } from "@/hooks/use-wallet-trades";

interface TradeHistoryTableProps {
  trades: WalletTrade[];
  totalTrades: number;
  isLoading?: boolean;
}

export function TradeHistoryTable({ trades, totalTrades, isLoading }: TradeHistoryTableProps) {
  const [showAll, setShowAll] = useState(false);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  const displayedTrades = showAll ? trades : trades.slice(0, 20);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.4 }}
    >
      <Card className="p-6 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Trade History
          </h2>
          <Badge variant="outline" className="font-mono">
            {totalTrades}
          </Badge>
        </div>

        {trades.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No trade history
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Time</TableHead>
                    <TableHead className="min-w-[200px]">Market</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedTrades.map((trade, index) => (
                    <TableRow key={trade.id || trade.trade_id || index}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatTimeAgo(trade.timestamp || trade.created_at)}
                      </TableCell>
                      <TableCell className="font-medium max-w-xs">
                        <span className="line-clamp-2">
                          {trade.market || trade.question || `Trade #${index + 1}`}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            trade.action === "BUY" || trade.type === "BUY"
                              ? "default"
                              : "secondary"
                          }
                          className={
                            trade.action === "BUY" || trade.type === "BUY"
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                          }
                        >
                          {trade.action || trade.type || "N/A"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={trade.side === "YES" ? "outline" : "outline"}
                          className={
                            trade.side === "YES"
                              ? "border-emerald-500/30 text-emerald-600"
                              : "border-red-500/30 text-red-600"
                          }
                        >
                          {trade.side || trade.outcome || "N/A"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(trade.shares || trade.size || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(trade.price || 0)}
                      </TableCell>
                      <TableCell className="text-right font-semibold font-mono">
                        {formatCurrency(trade.amount || trade.amount_usd || 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {trades.length > 20 && (
              <div className="mt-4 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? "Show Less" : `Show All ${trades.length} Trades`}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </motion.div>
  );
}
