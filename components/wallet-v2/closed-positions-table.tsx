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
import type { WalletClosedPosition } from "@/hooks/use-wallet-closed-positions";

interface ClosedPositionsTableProps {
  positions: WalletClosedPosition[];
  isLoading?: boolean;
}

export function ClosedPositionsTable({ positions, isLoading }: ClosedPositionsTableProps) {
  const [showAll, setShowAll] = useState(false);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const displayedPositions = showAll ? positions : positions.slice(0, 10);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.45, duration: 0.4 }}
    >
      <Card className="p-6 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Closed Positions
          </h2>
          <Badge variant="outline" className="font-mono">
            {positions.length}
          </Badge>
        </div>

        {positions.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No closed positions
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Market</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Entry Price</TableHead>
                    <TableHead className="text-right">Exit Price</TableHead>
                    <TableHead className="text-right">Realized PnL</TableHead>
                    <TableHead>Closed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedPositions.map((position, index) => {
                    const realizedPnL =
                      position.realizedPnL || position.realized_pnl || position.profit || 0;
                    const entryPrice =
                      position.entryPrice || position.entry_price || 0;
                    const exitPrice =
                      position.exitPrice || position.exit_price || 0;

                    return (
                      <TableRow key={position.id || position.position_id || index}>
                        <TableCell className="font-medium max-w-xs">
                          <span className="line-clamp-2">
                            {position.market || position.question || `Position #${index + 1}`}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={position.side === "YES" ? "default" : "secondary"}
                            className={
                              position.side === "YES"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : "bg-red-500/10 text-red-600 border-red-500/20"
                            }
                          >
                            {position.side || position.outcome || "N/A"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(entryPrice)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(exitPrice)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-semibold ${
                            realizedPnL >= 0 ? "text-emerald-500" : "text-red-500"
                          }`}
                        >
                          {formatCurrency(realizedPnL)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(position.closed_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {positions.length > 10 && (
              <div className="mt-4 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? "Show Less" : `Show All ${positions.length} Positions`}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </motion.div>
  );
}
