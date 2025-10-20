"use client";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search } from "lucide-react";
import { useState } from "react";
import { signalBots, signalProviders, traders } from "../data";
import type { ColumnVisibility, Filters, SignalBot, SignalProvider, Trader } from "../types";
import { ColumnSelector } from "./column-selector";
import { DataTable } from "./data-table";
import { FiltersComponent } from "./filters";

interface AnalyticsTabsProps {
  filters: Filters;
  visibleColumns: ColumnVisibility;
  onFilterChange: (category: "profitability" | "status" | "timeframe", item: any) => void;
  onResetFilters: () => void;
  onColumnChange: (column: any) => void;
  onResetColumns: () => void;
  onEdit?: (item: SignalBot | Trader | SignalProvider) => void;
  onFollow?: (item: Trader) => void;
  onSubscribe?: (item: SignalProvider) => void;
}

export function AnalyticsTabs({ filters, visibleColumns, onFilterChange, onResetFilters, onColumnChange, onResetColumns, onEdit, onFollow, onSubscribe }: AnalyticsTabsProps) {
  const [activeTab, setActiveTab] = useState("signal-bots");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnSelectorOpen, setColumnSelectorOpen] = useState(false);

  // Filter data based on search query and filters
  const filteredSignalBots = signalBots.filter((bot) => {
    // Search filter
    if (searchQuery && !bot.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    // Profitability filter
    if ((bot.profit > 0 && !filters.profitability.profitable) || (bot.profit <= 0 && !filters.profitability.unprofitable)) {
      return false;
    }

    // Status filter
    if ((bot.status === "Active" && !filters.status.active) || (bot.status === "Paused" && !filters.status.paused) || (bot.status === "Stopped" && !filters.status.stopped)) {
      return false;
    }

    return true;
  });

  const filteredTraders = traders.filter((trader) => {
    // Search filter
    if (searchQuery && !trader.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    // Profitability filter
    if ((trader.profit > 0 && !filters.profitability.profitable) || (trader.profit <= 0 && !filters.profitability.unprofitable)) {
      return false;
    }

    // Status filter
    if ((trader.status === "Active" && !filters.status.active) || (trader.status === "Paused" && !filters.status.paused) || (trader.status === "Stopped" && !filters.status.stopped)) {
      return false;
    }

    return true;
  });

  const filteredSignalProviders = signalProviders.filter((provider) => {
    // Search filter
    if (searchQuery && !provider.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    // Profitability filter
    if ((provider.profit > 0 && !filters.profitability.profitable) || (provider.profit <= 0 && !filters.profitability.unprofitable)) {
      return false;
    }

    // Status filter
    if ((provider.status === "Active" && !filters.status.active) || (provider.status === "Paused" && !filters.status.paused) || (provider.status === "Stopped" && !filters.status.stopped)) {
      return false;
    }

    return true;
  });

  return (
    <Tabs defaultValue="signal-bots" onValueChange={setActiveTab} className="w-full">
      <div className="md:flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between flex-wrap">
        <div className="overflow-x-auto">
          <TabsList className="mb-2 sm:mb-0 min-w-[400px] ">
            <TabsTrigger value="signal-bots">Signal Bots</TabsTrigger>
            <TabsTrigger value="traders">Traders</TabsTrigger>
            <TabsTrigger value="signal-providers">Signals Providers</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center max-md:mt-4">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search..." className="pl-8" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>

          <FiltersComponent open={filterOpen} setOpen={setFilterOpen} filters={filters} onFilterChange={onFilterChange} onResetFilters={onResetFilters} />

          <ColumnSelector open={columnSelectorOpen} setOpen={setColumnSelectorOpen} visibleColumns={visibleColumns} onColumnChange={onColumnChange} onResetColumns={onResetColumns} />
        </div>
      </div>

      <TabsContent value="signal-bots" className="mt-4">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.name && <TableHead>Name</TableHead>}
                {visibleColumns.status && <TableHead>Status</TableHead>}
                {visibleColumns.trades && <TableHead className="text-right">Trades</TableHead>}
                {visibleColumns.winRate && <TableHead className="text-right">Win Rate</TableHead>}
                {visibleColumns.profit && <TableHead className="text-right">Profit</TableHead>}
                {visibleColumns.profitPercent && <TableHead className="text-right">Profit %</TableHead>}
                {visibleColumns.volume && <TableHead className="text-right">Volume</TableHead>}
                {visibleColumns.timeframe && <TableHead>Timeframe</TableHead>}
                {visibleColumns.actions && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              <DataTable data={filteredSignalBots} visibleColumns={visibleColumns} type="signal-bots" onEdit={onEdit} onFollow={onFollow} onSubscribe={onSubscribe} />
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="traders" className="mt-4">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.name && <TableHead>Name</TableHead>}
                {visibleColumns.status && <TableHead>Status</TableHead>}
                <TableHead className="text-right">Followers</TableHead>
                {visibleColumns.winRate && <TableHead className="text-right">Win Rate</TableHead>}
                {visibleColumns.profit && <TableHead className="text-right">Profit</TableHead>}
                {visibleColumns.profitPercent && <TableHead className="text-right">Profit %</TableHead>}
                {visibleColumns.volume && <TableHead className="text-right">Volume</TableHead>}
                {visibleColumns.timeframe && <TableHead>Timeframe</TableHead>}
                {visibleColumns.actions && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              <DataTable data={filteredTraders} visibleColumns={visibleColumns} type="traders" onEdit={onEdit} onFollow={onFollow} onSubscribe={onSubscribe} />
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="signal-providers" className="mt-4">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.name && <TableHead>Name</TableHead>}
                {visibleColumns.status && <TableHead>Status</TableHead>}
                <TableHead className="text-right">Subscribers</TableHead>
                {visibleColumns.winRate && <TableHead className="text-right">Win Rate</TableHead>}
                {visibleColumns.profit && <TableHead className="text-right">Profit</TableHead>}
                {visibleColumns.profitPercent && <TableHead className="text-right">Profit %</TableHead>}
                <TableHead className="text-right">Signals</TableHead>
                {visibleColumns.timeframe && <TableHead>Timeframe</TableHead>}
                {visibleColumns.actions && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              <DataTable data={filteredSignalProviders} visibleColumns={visibleColumns} type="signal-providers" onEdit={onEdit} onFollow={onFollow} onSubscribe={onSubscribe} />
            </TableBody>
          </Table>
        </div>
      </TabsContent>
    </Tabs>
  );
}
