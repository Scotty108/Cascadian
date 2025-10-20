"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ChevronRight, Clock4, Filter, Star, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { PumpAlert } from "../../types";
import { formatRelativeTime } from "../../utils";
import { RiskBadge } from "../shared/risk-badge";

interface EnhancedPumpAlertsTableProps {
  alerts: PumpAlert[];
  selectedAlert: number | null;
  onSelectAlert: (id: number) => void;
  favorites: Set<string>;
  onToggleFavorite: (symbol: string) => void;
  sortBy: "timestamp" | "priceChange" | "volumeChange" | "confidence" | "risk";
  sortOrder: "asc" | "desc";
  onUpdateSorting: (sortBy: any, sortOrder?: "asc" | "desc") => void;
}

export function EnhancedPumpAlertsTable({ alerts, selectedAlert, onSelectAlert, favorites, onToggleFavorite, sortBy, sortOrder, onUpdateSorting }: EnhancedPumpAlertsTableProps) {
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(alerts.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedAlerts = alerts.slice(startIndex, startIndex + pageSize);

  const getSortIcon = (column: string) => {
    if (sortBy !== column) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortOrder === "desc" ? "↓" : "↑";
  };

  const handleSort = (column: any) => {
    onUpdateSorting(column);
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              Pump Alerts
              <Badge variant="outline" className="gap-1">
                <Clock4 className="h-3 w-3" />
                Live
              </Badge>
            </CardTitle>
            <CardDescription>
              {alerts.length} potential pumps detected • Page {currentPage} of {totalPages}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("symbol")}>
                  <div className="flex items-center gap-1">
                    Symbol
                    {getSortIcon("symbol")}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("priceChange")}>
                  <div className="flex items-center gap-1">
                    Price Change
                    {getSortIcon("priceChange")}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("volumeChange")}>
                  <div className="flex items-center gap-1">
                    Volume Change
                    {getSortIcon("volumeChange")}
                  </div>
                </TableHead>
                <TableHead>Time Frame</TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("risk")}>
                  <div className="flex items-center gap-1">
                    Risk
                    {getSortIcon("risk")}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("confidence")}>
                  <div className="flex items-center gap-1">
                    Confidence
                    {getSortIcon("confidence")}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("timestamp")}>
                  <div className="flex items-center gap-1">
                    Detected
                    {getSortIcon("timestamp")}
                  </div>
                </TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedAlerts.length > 0 ? (
                paginatedAlerts.map((alert) => (
                  <TableRow
                    key={alert.id}
                    className={cn("cursor-pointer transition-colors hover:bg-muted/50", selectedAlert === alert.id ? "bg-muted/50 border-l-4 border-l-primary" : "")}
                    onClick={() => onSelectAlert(alert.id)}
                  >
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(alert.symbol);
                        }}
                      >
                        <Star className={cn("h-3 w-3", favorites.has(alert.symbol) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground")} />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{alert.symbol}</span>
                        <span className="text-xs text-muted-foreground">{alert.exchange}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-green-500" />
                        <span className="text-green-500 font-medium">+{alert.priceChange}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">+{alert.volumeChange}%</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{alert.timeFrame}</Badge>
                    </TableCell>
                    <TableCell>
                      <RiskBadge risk={alert.risk} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                        <span className="text-sm">{alert.confidence}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatRelativeTime(alert.timestamp)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Filter className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">No pump alerts match your current filters</p>
                      <p className="text-sm text-muted-foreground">Try adjusting your filter criteria</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between flex-wrap px-4 py-3 border-t gap-4">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(startIndex + pageSize, alerts.length)} of {alerts.length} alerts
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const page = i + 1;
                  return (
                    <Button key={page} variant={currentPage === page ? "default" : "outline"} size="sm" className="w-8 h-8 p-0" onClick={() => setCurrentPage(page)}>
                      {page}
                    </Button>
                  );
                })}
                {totalPages > 5 && (
                  <>
                    <span className="text-muted-foreground">...</span>
                    <Button variant={currentPage === totalPages ? "default" : "outline"} size="sm" className="w-8 h-8 p-0" onClick={() => setCurrentPage(totalPages)}>
                      {totalPages}
                    </Button>
                  </>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
