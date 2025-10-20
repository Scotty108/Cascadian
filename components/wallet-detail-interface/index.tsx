"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReactECharts from "echarts-for-react";
import { ArrowLeft, Wallet, TrendingUp, TrendingDown, Trophy, Target, Calendar, BarChart3, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  WalletProfile,
  WalletTrade,
  WalletPosition,
  PnLHistoryPoint,
  WinRateHistoryPoint,
  MarketDistributionItem,
  WalletComparison,
} from "./types";

interface WalletDetailProps {
  walletAddress: string;
}

export function WalletDetail({ walletAddress }: WalletDetailProps) {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState("overview");

  // Mock wallet profile data
  const wallet: WalletProfile = {
    wallet_address: walletAddress,
    wallet_alias: "WhaleTrader42",
    wis: 85,
    total_invested: 250000,
    realized_pnl: 45000,
    realized_pnl_pct: 18.0,
    unrealized_pnl: 12000,
    unrealized_pnl_pct: 4.8,
    total_pnl: 57000,
    total_pnl_pct: 22.8,
    total_trades: 156,
    winning_trades: 98,
    losing_trades: 58,
    win_rate: 0.628,
    avg_trade_size: 1602,
    largest_win: 8500,
    largest_loss: -3200,
    markets_traded: 42,
    active_positions: 8,
    first_trade_date: "2024-01-15T00:00:00Z",
    last_trade_date: "2025-10-20T14:32:00Z",
    days_active: 279,
    rank_by_pnl: 23,
    rank_by_wis: 45,
    rank_by_volume: 18,
  };

  // PnL history (90 days)
  const pnlHistory: PnLHistoryPoint[] = Array.from({ length: 90 }, (_, i) => {
    const realized = 10000 + (i / 90) * 35000 + Math.sin(i / 10) * 3000;
    const unrealized = 5000 + Math.sin(i / 5) * 7000;
    return {
      date: new Date(Date.now() - (90 - i) * 86400000).toISOString(),
      realized_pnl: realized,
      unrealized_pnl: unrealized,
      total_pnl: realized + unrealized,
      total_invested: 100000 + (i / 90) * 150000,
    };
  });

  // Win rate history
  const winRateHistory: WinRateHistoryPoint[] = Array.from({ length: 90 }, (_, i) => ({
    date: new Date(Date.now() - (90 - i) * 86400000).toISOString(),
    win_rate: 0.55 + Math.sin(i / 15) * 0.08 + (i / 90) * 0.05,
    total_trades: Math.floor((i / 90) * 156),
    winning_trades: Math.floor((i / 90) * 98),
  }));

  // Trading history
  const tradingHistory: WalletTrade[] = [
    {
      trade_id: "1",
      timestamp: "2025-10-20T14:32:00Z",
      market_id: "trump-2024",
      market_title: "Will Trump win 2024?",
      side: "YES",
      action: "BUY",
      shares: 50000,
      price: 0.63,
      amount_usd: 31500,
      market_outcome: "OPEN",
      pnl: null,
      pnl_pct: null,
    },
    {
      trade_id: "2",
      timestamp: "2025-10-19T11:20:00Z",
      market_id: "btc-100k",
      market_title: "Will BTC hit $100k in 2024?",
      side: "NO",
      action: "SELL",
      shares: 30000,
      price: 0.45,
      amount_usd: 13500,
      market_outcome: "NO",
      pnl: 4500,
      pnl_pct: 33.3,
    },
    {
      trade_id: "3",
      timestamp: "2025-10-18T09:15:00Z",
      market_id: "eth-5k",
      market_title: "Will ETH reach $5k?",
      side: "YES",
      action: "BUY",
      shares: 40000,
      price: 0.72,
      amount_usd: 28800,
      market_outcome: "OPEN",
      pnl: null,
      pnl_pct: null,
    },
  ];

  // Current positions
  const positions: WalletPosition[] = [
    {
      position_id: "1",
      market_id: "trump-2024",
      market_title: "Will Trump win 2024?",
      category: "Politics",
      side: "YES",
      shares: 150000,
      avg_entry_price: 0.61,
      current_price: 0.63,
      invested: 91500,
      current_value: 94500,
      unrealized_pnl: 3000,
      unrealized_pnl_pct: 3.28,
      market_active: true,
      market_end_date: "2024-11-05T23:59:59Z",
    },
    {
      position_id: "2",
      market_id: "eth-5k",
      market_title: "Will ETH reach $5k?",
      category: "Crypto",
      side: "YES",
      shares: 80000,
      avg_entry_price: 0.70,
      current_price: 0.68,
      invested: 56000,
      current_value: 54400,
      unrealized_pnl: -1600,
      unrealized_pnl_pct: -2.86,
      market_active: true,
      market_end_date: "2024-12-31T23:59:59Z",
    },
  ];

  // Market distribution
  const marketDistribution: MarketDistributionItem[] = [
    { category: "Politics", trades: 45, volume: 85000, pnl: 18000, win_rate: 0.67 },
    { category: "Crypto", trades: 38, volume: 72000, pnl: 15000, win_rate: 0.63 },
    { category: "Sports", trades: 32, volume: 48000, pnl: 9500, win_rate: 0.59 },
    { category: "Finance", trades: 25, volume: 35000, pnl: 8200, win_rate: 0.64 },
    { category: "Pop Culture", trades: 16, volume: 22000, pnl: 6300, win_rate: 0.56 },
  ];

  // Comparison data
  const comparisons: WalletComparison[] = [
    { metric: "Total PnL %", wallet_value: 22.8, platform_avg: 8.5, top_10_pct_avg: 32.4, percentile: 78 },
    { metric: "Win Rate", wallet_value: 62.8, platform_avg: 52.3, top_10_pct_avg: 68.2, percentile: 72 },
    { metric: "WIS Score", wallet_value: 85, platform_avg: 50, top_10_pct_avg: 88, percentile: 89 },
    { metric: "Avg Trade Size", wallet_value: 1602, platform_avg: 450, top_10_pct_avg: 2100, percentile: 81 },
    { metric: "Markets Traded", wallet_value: 42, platform_avg: 12, top_10_pct_avg: 56, percentile: 76 },
  ];

  // PnL chart
  const pnlChartOption = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    legend: {
      data: ["Realized PnL", "Unrealized PnL", "Total PnL"],
      bottom: 0,
    },
    xAxis: {
      type: "category",
      data: pnlHistory.map((p) => p.date),
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        },
      },
    },
    yAxis: {
      type: "value",
      name: "PnL (USD)",
      axisLabel: {
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
      },
    },
    series: [
      {
        name: "Realized PnL",
        type: "line",
        data: pnlHistory.map((p) => p.realized_pnl),
        smooth: true,
        itemStyle: { color: "#10b981" },
      },
      {
        name: "Unrealized PnL",
        type: "line",
        data: pnlHistory.map((p) => p.unrealized_pnl),
        smooth: true,
        itemStyle: { color: "#f59e0b" },
      },
      {
        name: "Total PnL",
        type: "line",
        data: pnlHistory.map((p) => p.total_pnl),
        smooth: true,
        itemStyle: { color: "#3b82f6" },
        lineStyle: { width: 3 },
      },
    ],
  };

  // Win rate chart
  const winRateChartOption = {
    tooltip: {
      trigger: "axis",
    },
    xAxis: {
      type: "category",
      data: winRateHistory.map((w) => w.date),
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        },
      },
    },
    yAxis: {
      type: "value",
      name: "Win Rate",
      min: 0,
      max: 1,
      axisLabel: {
        formatter: (value: number) => `${(value * 100).toFixed(0)}%`,
      },
    },
    series: [
      {
        type: "line",
        data: winRateHistory.map((w) => w.win_rate),
        smooth: true,
        itemStyle: { color: "#8b5cf6" },
        areaStyle: { color: "rgba(139, 92, 246, 0.1)" },
      },
    ],
  };

  // Market distribution chart
  const distributionChartOption = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    legend: {
      data: ["Volume", "PnL"],
      bottom: 0,
    },
    xAxis: {
      type: "category",
      data: marketDistribution.map((m) => m.category),
    },
    yAxis: [
      {
        type: "value",
        name: "Volume (USD)",
        position: "left",
        axisLabel: {
          formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
        },
      },
      {
        type: "value",
        name: "PnL (USD)",
        position: "right",
        axisLabel: {
          formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
        },
      },
    ],
    series: [
      {
        name: "Volume",
        type: "bar",
        data: marketDistribution.map((m) => m.volume),
        itemStyle: { color: "#3b82f6" },
        yAxisIndex: 0,
      },
      {
        name: "PnL",
        type: "bar",
        data: marketDistribution.map((m) => m.pnl),
        itemStyle: { color: "#10b981" },
        yAxisIndex: 1,
      },
    ],
  };

  const formatAddress = (addr: string) => {
    if (addr.length < 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(wallet.wallet_address);
  };

  const getWISBadge = (wis: number) => {
    if (wis >= 80) return <Badge className="bg-purple-600">Elite (WIS {wis})</Badge>;
    if (wis >= 60) return <Badge className="bg-blue-600">Expert (WIS {wis})</Badge>;
    if (wis >= 40) return <Badge className="bg-green-600">Skilled (WIS {wis})</Badge>;
    return <Badge variant="secondary">WIS {wis}</Badge>;
  };

  return (
    <div className="flex flex-col h-full space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <Wallet className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">{wallet.wallet_alias}</h1>
            {getWISBadge(wallet.wis)}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-muted-foreground font-mono">{formatAddress(wallet.wallet_address)}</p>
            <Button variant="ghost" size="sm" onClick={copyAddress} className="h-6 px-2">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Performance Metrics Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Total PnL</div>
          <div className={`text-2xl font-bold ${wallet.total_pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
            ${(wallet.total_pnl / 1000).toFixed(1)}k
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            {wallet.total_pnl_pct >= 0 ? <TrendingUp className="h-3 w-3 text-green-600" /> : <TrendingDown className="h-3 w-3 text-red-600" />}
            {wallet.total_pnl_pct >= 0 ? "+" : ""}{wallet.total_pnl_pct.toFixed(1)}%
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Win Rate</div>
          <div className="text-2xl font-bold">{(wallet.win_rate * 100).toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground">{wallet.winning_trades}W / {wallet.losing_trades}L</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Total Trades</div>
          <div className="text-2xl font-bold">{wallet.total_trades}</div>
          <div className="text-xs text-muted-foreground">{wallet.markets_traded} markets</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Invested</div>
          <div className="text-2xl font-bold">${(wallet.total_invested / 1000).toFixed(0)}k</div>
          <div className="text-xs text-muted-foreground">{wallet.active_positions} active</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Avg Trade</div>
          <div className="text-2xl font-bold">${wallet.avg_trade_size.toFixed(0)}</div>
          <div className="text-xs text-muted-foreground">per trade</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Best Win</div>
          <div className="text-2xl font-bold text-green-600">${(wallet.largest_win / 1000).toFixed(1)}k</div>
          <div className="text-xs text-muted-foreground">single trade</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">PnL Rank</div>
          <div className="text-2xl font-bold flex items-center gap-1">
            <Trophy className="h-5 w-5 text-yellow-500" />
            #{wallet.rank_by_pnl}
          </div>
          <div className="text-xs text-muted-foreground">leaderboard</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Days Active</div>
          <div className="text-2xl font-bold">{wallet.days_active}</div>
          <div className="text-xs text-muted-foreground">since {new Date(wallet.first_trade_date).toLocaleDateString()}</div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="flex-1">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">Trading History</TabsTrigger>
          <TabsTrigger value="positions">Positions</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {/* PnL Chart */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">PnL Performance (90 Days)</h2>
            <div className="h-[300px]">
              <ReactECharts
                option={pnlChartOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          </div>

          {/* Win Rate Chart */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">Win Rate Trend (90 Days)</h2>
            <div className="h-[250px]">
              <ReactECharts
                option={winRateChartOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border rounded-lg p-4">
              <h3 className="text-md font-semibold mb-3">Recent Performance</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Last 7 days:</span>
                  <span className="text-sm font-bold text-green-600">+$4.2k</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Last 30 days:</span>
                  <span className="text-sm font-bold text-green-600">+$12.8k</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Last 90 days:</span>
                  <span className="text-sm font-bold text-green-600">+$28.5k</span>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4">
              <h3 className="text-md font-semibold mb-3">Trading Activity</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Trades this week:</span>
                  <span className="text-sm font-bold">12</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Trades this month:</span>
                  <span className="text-sm font-bold">45</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Avg per week:</span>
                  <span className="text-sm font-bold">3.9</span>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4">
              <h3 className="text-md font-semibold mb-3">Risk Metrics</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Max drawdown:</span>
                  <span className="text-sm font-bold text-red-600">-$8.2k</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Sharpe ratio:</span>
                  <span className="text-sm font-bold">1.85</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Avg hold time:</span>
                  <span className="text-sm font-bold">4.2 days</span>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Trading History Tab */}
        <TabsContent value="history">
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Market</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Shares</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tradingHistory.map((trade) => (
                  <TableRow key={trade.trade_id}>
                    <TableCell className="text-xs">{new Date(trade.timestamp).toLocaleString()}</TableCell>
                    <TableCell className="font-medium text-blue-600 hover:underline cursor-pointer max-w-[200px] truncate">
                      {trade.market_title}
                    </TableCell>
                    <TableCell>
                      <Badge variant={trade.action === "BUY" ? "default" : "secondary"}>
                        {trade.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={trade.side === "YES" ? "default" : "destructive"}>
                        {trade.side}
                      </Badge>
                    </TableCell>
                    <TableCell>{trade.shares.toLocaleString()}</TableCell>
                    <TableCell>{(trade.price * 100).toFixed(1)}¢</TableCell>
                    <TableCell>${trade.amount_usd.toLocaleString()}</TableCell>
                    <TableCell>
                      {trade.market_outcome === "OPEN" ? (
                        <Badge variant="outline">OPEN</Badge>
                      ) : (
                        <Badge variant={trade.market_outcome === trade.side ? "default" : "destructive"}>
                          {trade.market_outcome}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {trade.pnl !== null ? (
                        <span className={trade.pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                          {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toLocaleString()} ({trade.pnl_pct?.toFixed(1)}%)
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Positions Tab */}
        <TabsContent value="positions">
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Market</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Shares</TableHead>
                  <TableHead>Entry Price</TableHead>
                  <TableHead>Current Price</TableHead>
                  <TableHead>Invested</TableHead>
                  <TableHead>Current Value</TableHead>
                  <TableHead>PnL</TableHead>
                  <TableHead>Closes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((pos) => (
                  <TableRow key={pos.position_id}>
                    <TableCell className="font-medium text-blue-600 hover:underline cursor-pointer max-w-[250px]">
                      {pos.market_title}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{pos.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={pos.side === "YES" ? "default" : "destructive"}>
                        {pos.side}
                      </Badge>
                    </TableCell>
                    <TableCell>{pos.shares.toLocaleString()}</TableCell>
                    <TableCell>{(pos.avg_entry_price * 100).toFixed(1)}¢</TableCell>
                    <TableCell>{(pos.current_price * 100).toFixed(1)}¢</TableCell>
                    <TableCell>${pos.invested.toLocaleString()}</TableCell>
                    <TableCell>${pos.current_value.toLocaleString()}</TableCell>
                    <TableCell className={pos.unrealized_pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                      {pos.unrealized_pnl >= 0 ? "+" : ""}${pos.unrealized_pnl.toLocaleString()} ({pos.unrealized_pnl_pct.toFixed(2)}%)
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(pos.market_end_date).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          {/* Market Distribution Chart */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">Market Category Distribution</h2>
            <div className="h-[300px]">
              <ReactECharts
                option={distributionChartOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          </div>

          {/* Category Breakdown Table */}
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Volume</TableHead>
                  <TableHead>PnL</TableHead>
                  <TableHead>Win Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marketDistribution.map((dist) => (
                  <TableRow key={dist.category}>
                    <TableCell className="font-medium">{dist.category}</TableCell>
                    <TableCell>{dist.trades}</TableCell>
                    <TableCell>${dist.volume.toLocaleString()}</TableCell>
                    <TableCell className={dist.pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                      ${dist.pnl.toLocaleString()}
                    </TableCell>
                    <TableCell>{(dist.win_rate * 100).toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Compare Tab */}
        <TabsContent value="compare">
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Your Value</TableHead>
                  <TableHead>Platform Avg</TableHead>
                  <TableHead>Top 10% Avg</TableHead>
                  <TableHead>Percentile</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisons.map((comp) => (
                  <TableRow key={comp.metric}>
                    <TableCell className="font-medium">{comp.metric}</TableCell>
                    <TableCell className="font-bold text-blue-600">
                      {comp.metric.includes("%") || comp.metric === "Win Rate"
                        ? `${comp.wallet_value.toFixed(1)}%`
                        : comp.wallet_value.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {comp.metric.includes("%") || comp.metric === "Win Rate"
                        ? `${comp.platform_avg.toFixed(1)}%`
                        : comp.platform_avg.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {comp.metric.includes("%") || comp.metric === "Win Rate"
                        ? `${comp.top_10_pct_avg.toFixed(1)}%`
                        : comp.top_10_pct_avg.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden max-w-[100px]">
                          <div
                            className={`h-full ${comp.percentile >= 75 ? "bg-green-600" : comp.percentile >= 50 ? "bg-blue-600" : "bg-orange-600"}`}
                            style={{ width: `${comp.percentile}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium">{comp.percentile}th</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="border rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3">Performance Summary</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This wallet ranks in the <strong>top 22%</strong> of all traders on the platform.
              Their win rate of <strong>62.8%</strong> is significantly above the platform average of 52.3%.
              With a WIS score of <strong>85</strong>, they are considered an <strong>Elite</strong> trader.
            </p>
            <div className="flex gap-2">
              <Badge className="bg-purple-600">Elite Trader</Badge>
              <Badge className="bg-green-600">Above Average Returns</Badge>
              <Badge className="bg-blue-600">High Activity</Badge>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
