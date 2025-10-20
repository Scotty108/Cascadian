"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Percent } from "lucide-react";
import type { FilterParams } from "../../types";

interface FilterControlsProps {
  filterParams: FilterParams;
  onUpdateFilters: (updates: Partial<FilterParams>) => void;
}

export function FilterControls({ filterParams, onUpdateFilters }: FilterControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="min-price-change" className="text-xs">
          Min Price Change:
        </Label>
        <div className="flex items-center gap-1">
          <Select value={filterParams.minPriceChange.toString()} onValueChange={(value) => onUpdateFilters({ minPriceChange: Number(value) })}>
            <SelectTrigger className="h-8 w-[80px]">
              <SelectValue placeholder="%" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1%</SelectItem>
              <SelectItem value="3">3%</SelectItem>
              <SelectItem value="5">5%</SelectItem>
              <SelectItem value="10">10%</SelectItem>
              <SelectItem value="15">15%</SelectItem>
              <SelectItem value="20">20%</SelectItem>
            </SelectContent>
          </Select>
          <Percent className="h-3 w-3 text-muted-foreground" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="min-volume-change" className="text-xs">
          Min Volume Change:
        </Label>
        <div className="flex items-center gap-1">
          <Select value={filterParams.minVolumeChange.toString()} onValueChange={(value) => onUpdateFilters({ minVolumeChange: Number(value) })}>
            <SelectTrigger className="h-8 w-[80px]">
              <SelectValue placeholder="%" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="100">100%</SelectItem>
              <SelectItem value="200">200%</SelectItem>
              <SelectItem value="300">300%</SelectItem>
              <SelectItem value="500">500%</SelectItem>
              <SelectItem value="1000">1000%</SelectItem>
            </SelectContent>
          </Select>
          <Percent className="h-3 w-3 text-muted-foreground" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="timeframe" className="text-xs">
          Timeframe:
        </Label>
        <Select value={filterParams.timeFrame} onValueChange={(value) => onUpdateFilters({ timeFrame: value })}>
          <SelectTrigger className="h-8 w-[80px]">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="1m">1m</SelectItem>
            <SelectItem value="5m">5m</SelectItem>
            <SelectItem value="15m">15m</SelectItem>
            <SelectItem value="30m">30m</SelectItem>
            <SelectItem value="1h">1h</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="risk-level" className="text-xs">
          Risk Level:
        </Label>
        <Select value={filterParams.riskLevel} onValueChange={(value) => onUpdateFilters({ riskLevel: value })}>
          <SelectTrigger className="h-8 w-[100px]">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="very high">Very High</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="exchange" className="text-xs">
          Exchange:
        </Label>
        <Select value={filterParams.exchanges.includes("all") ? "all" : filterParams.exchanges[0]} onValueChange={(value) => onUpdateFilters({ exchanges: [value] })}>
          <SelectTrigger className="h-8 w-[100px]">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="Binance">Binance</SelectItem>
            <SelectItem value="Coinbase">Coinbase</SelectItem>
            <SelectItem value="Kraken">Kraken</SelectItem>
            <SelectItem value="KuCoin">KuCoin</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
