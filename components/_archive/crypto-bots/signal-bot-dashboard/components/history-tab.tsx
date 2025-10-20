"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Clock, Download, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { Signal } from "../types";
import { formatDate, getProfitColor, getSignalTypeColor, getStatusColor } from "../utils";

interface HistoryTabProps {
  signalHistory: Signal[];
  historyFilter: string;
  weeklyPerformanceData: any[];
  onFilterChange: (filter: string) => void;
  onExport: () => void;
}

const ITEMS_PER_PAGE = 10;

export function HistoryTab({ signalHistory, historyFilter, weeklyPerformanceData, onFilterChange, onExport }: HistoryTabProps) {
  const [currentPage, setCurrentPage] = useState(1);

  const filteredHistory = useMemo(() => {
    return signalHistory.filter((signal) => {
      if (historyFilter === "all") return true;
      return signal.status === historyFilter;
    });
  }, [signalHistory, historyFilter]);

  const totalPages = Math.ceil(filteredHistory.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentPageData = filteredHistory.slice(startIndex, endIndex);

  const handlePreviousPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  };

  // Reset to first page when filter changes
  const handleFilterChange = (filter: string) => {
    setCurrentPage(1);
    onFilterChange(filter);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Signal History</CardTitle>
              <CardDescription>View your past signals and performance</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={historyFilter} onValueChange={handleFilterChange}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Signals</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="stopped">Stopped</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" className="gap-2 bg-transparent" onClick={onExport}>
                <Download className="h-4 w-4" />
                <span>Export</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 overflow-x-auto">
            <div className="rounded-md border min-w-[800px]">
              <div className="grid grid-cols-12 gap-2 border-b bg-muted/50 p-4 font-medium">
                <div className="col-span-4">Signal</div>
                <div className="col-span-2 text-center">Type</div>
                <div className="col-span-2 text-center">Entry Price</div>
                <div className="col-span-2 text-center">Status</div>
                <div className="col-span-2 text-right">Profit/Loss</div>
              </div>
              <ScrollArea className="h-[400px]">
                {currentPageData.length > 0 ? (
                  currentPageData.map((signal) => (
                    <div key={signal.id} className="grid grid-cols-12 gap-2 border-b p-4 last:border-0 hover:bg-muted/30">
                      <div className="col-span-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={signal.providerAvatar || "/placeholder.svg"} alt={signal.provider} />
                            <AvatarFallback>{signal.provider.substring(0, 2)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{signal.asset}</div>
                            <div className="text-xs text-muted-foreground">
                              {signal.provider} • {formatDate(signal.timestamp)}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2 flex items-center justify-center">
                        <Badge variant="outline" className={cn("text-xs", getSignalTypeColor(signal.type))}>
                          {signal.type}
                        </Badge>
                      </div>
                      <div className="col-span-2 flex items-center justify-center">${signal.entryPrice.toLocaleString()}</div>
                      <div className="col-span-2 flex items-center justify-center">
                        <Badge variant="outline" className={cn("text-xs", getStatusColor(signal.status))}>
                          {signal.status.charAt(0).toUpperCase() + signal.status.slice(1)}
                        </Badge>
                      </div>
                      <div className="col-span-2 flex items-center justify-end">
                        {signal.profit !== null ? (
                          <span className={cn("font-medium", getProfitColor(signal.profit))}>
                            {signal.profit > 0 ? "+" : ""}
                            {signal.profit}%
                          </span>
                        ) : (
                          <span className="font-medium">In Progress</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">No signals found for the selected filter.</div>
                )}
              </ScrollArea>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between gap-3 flex-wrap">
          <div className="text-sm text-muted-foreground">
            Showing {startIndex + 1}-{Math.min(endIndex, filteredHistory.length)} of {filteredHistory.length} signals
            {totalPages > 1 && ` (Page ${currentPage} of ${totalPages})`}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePreviousPage} disabled={currentPage === 1}>
              Previous
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              {currentPage} / {totalPages}
            </span>
            <Button variant="outline" size="sm" onClick={handleNextPage} disabled={currentPage === totalPages}>
              Next
            </Button>
          </div>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance Analytics</CardTitle>
          <CardDescription>Analyze your signal bot performance over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="h-[300px] w-full">
              <ChartContainer
                config={{
                  profit: {
                    label: "Cumulative Profit",
                    color: "hsl(var(--chart-1))",
                  },
                  winRate: {
                    label: "Win Rate",
                    color: "hsl(var(--chart-2))",
                  },
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyPerformanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" />
                    <YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="profit" stroke="var(--color-profit)" name="Profit %" />
                    <Line type="monotone" dataKey="winRate" stroke="var(--color-winRate)" name="Win Rate %" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-1 text-center">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                    <h4 className="text-sm font-medium">Average Signal Duration</h4>
                    <p className="text-2xl font-bold">18.5h</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-1 text-center">
                    <TrendingUp className="h-5 w-5 text-green-500" />
                    <h4 className="text-sm font-medium">Win Rate</h4>
                    <p className="text-2xl font-bold">78%</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-1 text-center">
                    <TrendingDown className="h-5 w-5 text-red-500" />
                    <h4 className="text-sm font-medium">Loss Rate</h4>
                    <p className="text-2xl font-bold">22%</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-1 text-center">
                    <Wallet className="h-5 w-5 text-muted-foreground" />
                    <h4 className="text-sm font-medium">Total Profit</h4>
                    <p className="text-2xl font-bold">$12,450</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
