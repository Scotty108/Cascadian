"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowUpDown, Eye, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MarketScreenerRow } from "./types";

export function MarketScreener() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<keyof MarketScreenerRow>("sii");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Mock data - will be replaced with API call
  const markets: MarketScreenerRow[] = [
    {
      market_id: "1",
      title: "Will Trump win the 2024 election?",
      outcome: "YES",
      last_price: 0.63,
      price_delta: 2.4,
      volume_24h: 125000,
      trades_24h: 450,
      buyers_24h: 180,
      sellers_24h: 120,
      unique_addresses_24h: 285,
      whale_buys_24h: 12,
      whale_sells_24h: 8,
      whale_volume_buy_24h: 45000,
      whale_volume_sell_24h: 28000,
      whale_pressure: 17000,
      whale_buy_sell_ratio: 1.61,
      buy_sell_ratio: 1.5,
      volatility: 0.15,
      spread_bps: 25,
      smart_buyers_24h: 35,
      smart_sellers_24h: 22,
      smart_volume_buy_24h: 62000,
      smart_volume_sell_24h: 38000,
      smart_buy_sell_ratio: 1.59,
      smart_pressure: 24000,
      sii: 75,
      momentum: 82,
      category: "Politics",
    },
    {
      market_id: "2",
      title: "Will Bitcoin reach $100k by end of 2024?",
      outcome: "YES",
      last_price: 0.28,
      price_delta: -3.2,
      volume_24h: 89000,
      trades_24h: 320,
      buyers_24h: 95,
      sellers_24h: 150,
      unique_addresses_24h: 230,
      whale_buys_24h: 6,
      whale_sells_24h: 14,
      whale_volume_buy_24h: 22000,
      whale_volume_sell_24h: 48000,
      whale_pressure: -26000,
      whale_buy_sell_ratio: 0.46,
      buy_sell_ratio: 0.63,
      volatility: 0.22,
      spread_bps: 35,
      smart_buyers_24h: 18,
      smart_sellers_24h: 42,
      smart_volume_buy_24h: 28000,
      smart_volume_sell_24h: 54000,
      smart_buy_sell_ratio: 0.43,
      smart_pressure: -26000,
      sii: -45,
      momentum: 35,
      category: "Crypto",
    },
    {
      market_id: "3",
      title: "Will Lakers win NBA Championship 2025?",
      outcome: "YES",
      last_price: 0.42,
      price_delta: 1.8,
      volume_24h: 45000,
      trades_24h: 210,
      buyers_24h: 110,
      sellers_24h: 95,
      unique_addresses_24h: 195,
      whale_buys_24h: 8,
      whale_sells_24h: 7,
      whale_volume_buy_24h: 18000,
      whale_volume_sell_24h: 16000,
      whale_pressure: 2000,
      whale_buy_sell_ratio: 1.13,
      buy_sell_ratio: 1.16,
      volatility: 0.18,
      spread_bps: 30,
      smart_buyers_24h: 24,
      smart_sellers_24h: 21,
      smart_volume_buy_24h: 22000,
      smart_volume_sell_24h: 19000,
      smart_buy_sell_ratio: 1.14,
      smart_pressure: 3000,
      sii: 12,
      momentum: 58,
      category: "Sports",
    },
  ];

  // Filtering
  const filteredMarkets = useMemo(() => {
    return markets.filter((market) => {
      const matchesSearch = market.title
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const matchesCategory =
        categoryFilter === "all" || market.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [markets, searchQuery, categoryFilter]);

  // Sorting
  const sortedMarkets = useMemo(() => {
    const sorted = [...filteredMarkets];
    sorted.sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === "asc"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return 0;
    });
    return sorted;
  }, [filteredMarkets, sortField, sortDirection]);

  const handleSort = (field: keyof MarketScreenerRow) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const getSIIColor = (sii: number) => {
    if (sii > 50) return "text-green-600 font-bold";
    if (sii > 0) return "text-green-500";
    if (sii > -50) return "text-red-500";
    return "text-red-600 font-bold";
  };

  const getMomentumColor = (momentum: number) => {
    if (momentum > 70) return "text-green-600";
    if (momentum > 40) return "text-gray-600";
    return "text-red-600";
  };

  return (
    <div className="flex flex-col h-full space-y-4 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Market Screener</h1>
        <p className="text-muted-foreground">
          Find high-conviction prediction markets using SII and momentum signals
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <Input
          placeholder="Search markets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="Politics">Politics</SelectItem>
            <SelectItem value="Sports">Sports</SelectItem>
            <SelectItem value="Crypto">Crypto</SelectItem>
            <SelectItem value="Entertainment">Entertainment</SelectItem>
            <SelectItem value="Other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px] sticky left-0 bg-background z-10">Market</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("sii")}>
                <div className="flex items-center gap-1">
                  SII
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("momentum")}>
                <div className="flex items-center gap-1">
                  Momentum
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead>Price</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("price_delta")}>
                <div className="flex items-center gap-1">
                  Price Δ
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("volume_24h")}>
                <div className="flex items-center gap-1">
                  Volume ($)
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead># Trades</TableHead>
              <TableHead># Buyers</TableHead>
              <TableHead># Sellers</TableHead>
              <TableHead># Unique</TableHead>
              <TableHead>Whale Buys</TableHead>
              <TableHead>Whale Sells</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("whale_volume_buy_24h")}>
                <div className="flex items-center gap-1">
                  Whale Vol Buy
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("whale_volume_sell_24h")}>
                <div className="flex items-center gap-1">
                  Whale Vol Sell
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("whale_pressure")}>
                <div className="flex items-center gap-1">
                  Whale Pressure
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead>B/S Ratio</TableHead>
              <TableHead>Whale B/S</TableHead>
              <TableHead>Volatility (σ)</TableHead>
              <TableHead>Spread</TableHead>
              <TableHead>Smart Buyers</TableHead>
              <TableHead>Smart Sellers</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("smart_volume_buy_24h")}>
                <div className="flex items-center gap-1">
                  Smart Vol Buy
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("smart_volume_sell_24h")}>
                <div className="flex items-center gap-1">
                  Smart Vol Sell
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead>Smart B/S</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("smart_pressure")}>
                <div className="flex items-center gap-1">
                  Smart Pressure
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="w-[100px] sticky right-0 bg-background z-10">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedMarkets.map((market) => (
              <TableRow key={market.market_id}>
                <TableCell className="font-medium sticky left-0 bg-background z-10">
                  <Link
                    href={`/analysis/market/${market.market_id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {market.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <span
                    className={
                      market.outcome === "YES" ? "text-green-600" : "text-red-600"
                    }
                  >
                    {market.outcome}
                  </span>
                </TableCell>
                <TableCell className={getSIIColor(market.sii)}>
                  {market.sii}
                </TableCell>
                <TableCell className={getMomentumColor(market.momentum)}>
                  {market.momentum}
                </TableCell>
                <TableCell>{(market.last_price * 100).toFixed(1)}¢</TableCell>
                <TableCell className={market.price_delta > 0 ? "text-green-600" : market.price_delta < 0 ? "text-red-600" : ""}>
                  {market.price_delta > 0 ? "+" : ""}{market.price_delta.toFixed(1)}%
                </TableCell>
                <TableCell>${(market.volume_24h / 1000).toFixed(1)}k</TableCell>
                <TableCell>{market.trades_24h}</TableCell>
                <TableCell>{market.buyers_24h}</TableCell>
                <TableCell>{market.sellers_24h}</TableCell>
                <TableCell>{market.unique_addresses_24h}</TableCell>
                <TableCell>{market.whale_buys_24h}</TableCell>
                <TableCell>{market.whale_sells_24h}</TableCell>
                <TableCell>${(market.whale_volume_buy_24h / 1000).toFixed(1)}k</TableCell>
                <TableCell>${(market.whale_volume_sell_24h / 1000).toFixed(1)}k</TableCell>
                <TableCell className={market.whale_pressure > 0 ? "text-green-600 font-bold" : market.whale_pressure < 0 ? "text-red-600 font-bold" : ""}>
                  ${(Math.abs(market.whale_pressure) / 1000).toFixed(1)}k
                  {market.whale_pressure > 0 ? " ↑" : market.whale_pressure < 0 ? " ↓" : ""}
                </TableCell>
                <TableCell>{market.buy_sell_ratio.toFixed(2)}</TableCell>
                <TableCell className={market.whale_buy_sell_ratio > 1 ? "text-green-600" : "text-red-600"}>
                  {market.whale_buy_sell_ratio.toFixed(2)}
                </TableCell>
                <TableCell>{market.volatility.toFixed(2)}</TableCell>
                <TableCell>{market.spread_bps} bps</TableCell>
                <TableCell>{market.smart_buyers_24h}</TableCell>
                <TableCell>{market.smart_sellers_24h}</TableCell>
                <TableCell>${(market.smart_volume_buy_24h / 1000).toFixed(1)}k</TableCell>
                <TableCell>${(market.smart_volume_sell_24h / 1000).toFixed(1)}k</TableCell>
                <TableCell className={market.smart_buy_sell_ratio > 1 ? "text-green-600" : "text-red-600"}>
                  {market.smart_buy_sell_ratio.toFixed(2)}
                </TableCell>
                <TableCell className={market.smart_pressure > 0 ? "text-green-600 font-bold" : market.smart_pressure < 0 ? "text-red-600 font-bold" : ""}>
                  ${(Math.abs(market.smart_pressure) / 1000).toFixed(1)}k
                  {market.smart_pressure > 0 ? " ↑" : market.smart_pressure < 0 ? " ↓" : ""}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
                    {market.category}
                  </span>
                </TableCell>
                <TableCell className="sticky right-0 bg-background z-10">
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/analysis/market/${market.market_id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button size="sm" variant="ghost">
                      <Star className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        Showing {sortedMarkets.length} of {markets.length} markets
      </div>
    </div>
  );
}
