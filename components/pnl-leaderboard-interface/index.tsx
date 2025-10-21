"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import { ArrowUpDown, Eye } from "lucide-react";
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
import type { PnLLeaderboardRow } from "./types";

export function PnLLeaderboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<keyof PnLLeaderboardRow>("realized_pnl_usd");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Mock data - will be replaced with API call
  const wallets: PnLLeaderboardRow[] = [
    {
      wallet_id: "0x1a2b3c",
      wallet_alias: "WhaleTrader42",
      wis: 85,
      realized_pnl_usd: 125000,
      total_invested_usd: 500000,
      roi: 25.0,
      trades_total: 156,
      win_rate: 68.5,
      contrarian_score: 42.3,
      contrarian_win_rate: 71.2,
      last_trade_date: "2025-10-19",
    },
    {
      wallet_id: "0x4d5e6f",
      wallet_alias: "ContraCaptain",
      wis: 72,
      realized_pnl_usd: 89000,
      total_invested_usd: 300000,
      roi: 29.7,
      trades_total: 203,
      win_rate: 65.0,
      contrarian_score: 78.5,
      contrarian_win_rate: 82.1,
      last_trade_date: "2025-10-20",
    },
    {
      wallet_id: "0x7g8h9i",
      wallet_alias: "MomentumMaster",
      wis: 68,
      realized_pnl_usd: 67000,
      total_invested_usd: 250000,
      roi: 26.8,
      trades_total: 98,
      win_rate: 72.4,
      contrarian_score: 18.4,
      contrarian_win_rate: 55.6,
      last_trade_date: "2025-10-19",
    },
    {
      wallet_id: "0xjklmno",
      wallet_alias: "SmartInvestor",
      wis: 91,
      realized_pnl_usd: 156000,
      total_invested_usd: 400000,
      roi: 39.0,
      trades_total: 124,
      win_rate: 78.2,
      contrarian_score: 35.5,
      contrarian_win_rate: 79.5,
      last_trade_date: "2025-10-20",
    },
    {
      wallet_id: "0xpqrstu",
      wallet_alias: "RiskTaker",
      wis: -15,
      realized_pnl_usd: -45000,
      total_invested_usd: 600000,
      roi: -7.5,
      trades_total: 289,
      win_rate: 42.6,
      contrarian_score: 62.1,
      contrarian_win_rate: 38.9,
      last_trade_date: "2025-10-18",
    },
    {
      wallet_id: "0xvwxyz1",
      wallet_alias: "SafeBets",
      wis: 45,
      realized_pnl_usd: 32000,
      total_invested_usd: 150000,
      roi: 21.3,
      trades_total: 67,
      win_rate: 59.7,
      contrarian_score: 12.3,
      contrarian_win_rate: 62.5,
      last_trade_date: "2025-10-17",
    },
  ];

  // Filtering
  const filteredWallets = useMemo(() => {
    return wallets.filter((wallet) => {
      return (
        wallet.wallet_alias.toLowerCase().includes(searchQuery.toLowerCase()) ||
        wallet.wallet_id.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [wallets, searchQuery]);

  // Sorting
  const sortedWallets = useMemo(() => {
    const sorted = [...filteredWallets];
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
  }, [filteredWallets, sortField, sortDirection]);

  const handleSort = (field: keyof PnLLeaderboardRow) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  // Get color for ROI
  const getROIColor = (roi: number) => {
    if (roi > 30) return "#16a34a";      // Dark Green
    if (roi > 10) return "#4ade80";      // Light Green
    if (roi > -10) return "#9ca3af";     // Gray
    if (roi > -30) return "#f87171";     // Light Red
    return "#dc2626";                     // Dark Red
  };

  // Scatter plot configuration
  const scatterOption = {
    tooltip: {
      formatter: (params: any) => {
        const data = params.data;
        return `
          <div style="padding: 8px;">
            <strong style="font-size: 14px;">${data.wallet_alias}</strong><br/>
            <div style="margin-top: 4px;">
              Realized PnL: <strong>$${data.realized_pnl_usd.toLocaleString()}</strong><br/>
              Total Invested: <strong>$${data.total_invested_usd.toLocaleString()}</strong><br/>
              ROI: <strong>${data.roi.toFixed(1)}%</strong><br/>
              WIS: <strong>${data.wis}</strong>
            </div>
          </div>
        `;
      },
    },
    xAxis: {
      type: "value",
      name: "Realized PnL (USD)",
      nameLocation: "middle",
      nameGap: 30,
      axisLabel: {
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
      },
    },
    yAxis: {
      type: "value",
      name: "Total Invested (USD)",
      nameLocation: "middle",
      nameGap: 50,
      axisLabel: {
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
      },
    },
    series: [
      {
        type: "scatter",
        data: filteredWallets.map((w) => ({
          value: [w.realized_pnl_usd, w.total_invested_usd],
          wallet_alias: w.wallet_alias,
          realized_pnl_usd: w.realized_pnl_usd,
          total_invested_usd: w.total_invested_usd,
          roi: w.roi,
          wis: w.wis,
          itemStyle: {
            color: getROIColor(w.roi),
          },
        })),
        symbolSize: 15,
      },
    ],
  };

  const getWISColor = (wis: number) => {
    if (wis > 70) return "text-green-600 font-bold";
    if (wis > 0) return "text-green-500";
    if (wis > -70) return "text-red-500";
    return "text-red-600 font-bold";
  };

  const getROITextColor = (roi: number) => {
    if (roi > 20) return "text-green-600 font-bold";
    if (roi > 0) return "text-green-500";
    if (roi > -20) return "text-red-500";
    return "text-red-600 font-bold";
  };

  return (
    <div className="flex flex-col h-full space-y-4 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">PnL Leaderboard</h1>
        <p className="text-muted-foreground">
          Top traders ranked by performance, profitability, and contrarian success
        </p>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <Input
          placeholder="Search wallets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* Scatter Plot */}
      <div className="border rounded-lg p-4">
        <h2 className="text-xl font-semibold mb-4">PnL vs Investment</h2>
        <div className="h-[400px]">
          <ReactECharts
            option={scatterOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
          />
        </div>
        <div className="flex gap-6 text-sm mt-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: "#16a34a" }} />
            <span>ROI &gt; 30%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: "#4ade80" }} />
            <span>ROI 10-30%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: "#9ca3af" }} />
            <span>ROI -10 to 10%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: "#f87171" }} />
            <span>ROI -30 to -10%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: "#dc2626" }} />
            <span>ROI &lt; -30%</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[150px]">Wallet</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("wis")}>
                <div className="flex items-center gap-1">
                  WIS
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("realized_pnl_usd")}>
                <div className="flex items-center gap-1">
                  Realized PnL
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("total_invested_usd")}>
                <div className="flex items-center gap-1">
                  Total Invested
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("roi")}>
                <div className="flex items-center gap-1">
                  ROI
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("trades_total")}>
                <div className="flex items-center gap-1">
                  Trades
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("win_rate")}>
                <div className="flex items-center gap-1">
                  Win Rate
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("contrarian_score")}>
                <div className="flex items-center gap-1">
                  Contrarian %
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("contrarian_win_rate")}>
                <div className="flex items-center gap-1">
                  Contrarian Win
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead>Last Trade</TableHead>
              <TableHead className="w-[80px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedWallets.map((wallet) => (
              <TableRow key={wallet.wallet_id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/analysis/wallet/${wallet.wallet_id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {wallet.wallet_alias}
                  </Link>
                </TableCell>
                <TableCell className={getWISColor(wallet.wis)}>
                  {wallet.wis}
                </TableCell>
                <TableCell className={getROITextColor(wallet.roi)}>
                  ${wallet.realized_pnl_usd.toLocaleString()}
                </TableCell>
                <TableCell>
                  ${wallet.total_invested_usd.toLocaleString()}
                </TableCell>
                <TableCell className={getROITextColor(wallet.roi)}>
                  {wallet.roi.toFixed(1)}%
                </TableCell>
                <TableCell>{wallet.trades_total}</TableCell>
                <TableCell>{wallet.win_rate.toFixed(1)}%</TableCell>
                <TableCell>{wallet.contrarian_score.toFixed(1)}%</TableCell>
                <TableCell className={wallet.contrarian_win_rate > 60 ? "text-green-600 font-bold" : ""}>
                  {wallet.contrarian_win_rate.toFixed(1)}%
                </TableCell>
                <TableCell>{wallet.last_trade_date}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/traders/wallet/${wallet.wallet_id}`}>
                      <Eye className="h-4 w-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        Showing {sortedWallets.length} of {wallets.length} wallets
      </div>
    </div>
  );
}
