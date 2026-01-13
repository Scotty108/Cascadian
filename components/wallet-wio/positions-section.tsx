"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Layers, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { OpenPosition, ClosedPosition, formatPnL, formatPercent } from "@/hooks/use-wallet-wio";
import Link from "next/link";

interface PositionsSectionProps {
  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];
}

const ITEMS_PER_PAGE = 10;

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

function formatHoldTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

export function PositionsSection({ openPositions, closedPositions }: PositionsSectionProps) {
  const [openShowAll, setOpenShowAll] = useState(false);
  const [closedShowAll, setClosedShowAll] = useState(false);

  const displayedOpen = openShowAll ? openPositions : openPositions.slice(0, ITEMS_PER_PAGE);
  const displayedClosed = closedShowAll ? closedPositions : closedPositions.slice(0, ITEMS_PER_PAGE);

  return (
    <Card className="p-6 border-border/50">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Layers className="h-5 w-5 text-[#00E0AA]" />
          Positions
        </h2>
      </div>

      <Tabs defaultValue="open" className="w-full">
        <TabsList className="bg-muted/50 mb-4">
          <TabsTrigger value="open" className="text-sm">
            Open ({openPositions.length})
          </TabsTrigger>
          <TabsTrigger value="closed" className="text-sm">
            Closed ({closedPositions.length})
          </TabsTrigger>
        </TabsList>

        {/* Open Positions */}
        <TabsContent value="open">
          {openPositions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No open positions
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40%]">Market</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Mark</TableHead>
                      <TableHead className="text-right">Unrealized PnL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedOpen.map((position, index) => (
                      <TableRow key={`${position.market_id}-${position.side}-${index}`}>
                        <TableCell>
                          <div className="max-w-xs">
                            <Link
                              href={`/analysis/market/${position.market_id}`}
                              className="font-medium line-clamp-2 hover:text-[#00E0AA] transition-colors"
                            >
                              {position.question || `Market ${position.market_id.slice(0, 8)}...`}
                            </Link>
                            {position.category && (
                              <span className="text-xs text-muted-foreground">{position.category}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={position.side === 'YES' ? 'default' : 'secondary'}>
                            {position.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatPnL(position.open_cost_usd)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${position.avg_entry_price.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${position.mark_price.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className={`font-semibold ${position.unrealized_pnl_usd >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                            {formatPnL(position.unrealized_pnl_usd)}
                          </div>
                          <div className={`text-xs ${position.unrealized_roi >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                            {formatPercent(position.unrealized_roi)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {openPositions.length > ITEMS_PER_PAGE && (
                <div className="mt-4 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenShowAll(!openShowAll)}
                  >
                    {openShowAll ? (
                      <>
                        <ChevronUp className="h-4 w-4 mr-1" />
                        Show Less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        Show All {openPositions.length} Open Positions
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Closed Positions */}
        <TabsContent value="closed">
          {closedPositions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No closed positions
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[35%]">Market</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">PnL</TableHead>
                      <TableHead className="text-right">ROI</TableHead>
                      <TableHead className="text-right">Hold</TableHead>
                      <TableHead>Opened</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedClosed.map((position) => (
                      <TableRow key={position.position_id}>
                        <TableCell>
                          <div className="max-w-xs">
                            <Link
                              href={`/analysis/market/${position.market_id}`}
                              className="font-medium line-clamp-2 hover:text-[#00E0AA] transition-colors"
                            >
                              {position.question || `Market ${position.market_id.slice(0, 8)}...`}
                            </Link>
                            <div className="flex items-center gap-2 mt-0.5">
                              {position.category && (
                                <span className="text-xs text-muted-foreground">{position.category}</span>
                              )}
                              {position.is_resolved === 1 && (
                                <Badge variant="outline" className="text-xs h-4 px-1">
                                  Resolved
                                </Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={position.side === 'YES' ? 'default' : 'secondary'}>
                            {position.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatPnL(position.cost_usd)}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${position.pnl_usd >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                          {formatPnL(position.pnl_usd)}
                        </TableCell>
                        <TableCell className={`text-right ${position.roi >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                          {formatPercent(position.roi)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatHoldTime(position.hold_minutes)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatTimeAgo(position.ts_open)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {closedPositions.length > ITEMS_PER_PAGE && (
                <div className="mt-4 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setClosedShowAll(!closedShowAll)}
                  >
                    {closedShowAll ? (
                      <>
                        <ChevronUp className="h-4 w-4 mr-1" />
                        Show Less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        Show All {closedPositions.length} Closed Positions
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
