"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import { ArrowLeft, Wallet, TrendingUp, TrendingDown, Trophy, Target, Calendar, BarChart3, Copy, Award, Zap, Medal, Star } from "lucide-react";
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
  ActiveBet,
  FinishedBet,
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
    contrarian_pct: 62, // 62% of entries below 0.5
    lottery_ticket_count: 3, // 3 lottery ticket positions
    is_senior: false, // < 1000 total positions
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
    risk_metrics: {
      sharpe_ratio_30d: 1.85,
      sharpe_level: 'Good',
      traded_volume_30d_daily: Array.from({ length: 30 }, (_, i) => ({
        date: new Date(Date.now() - (30 - i) * 86400000).toISOString(),
        volume_usd: 2000 + Math.random() * 8000 + Math.sin(i / 5) * 3000,
      })),
      traded_volume_30d_total: 150000,
    },
    pnl_ranks: {
      d1: { period: '1D', rank: 45, pnl_usd: 850 },
      d7: { period: '7D', rank: 28, pnl_usd: 4200 },
      d30: { period: '30D', rank: 23, pnl_usd: 12800 },
      all: { period: 'All', rank: 23, pnl_usd: 57000 },
    },
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

  // Active positions
  const activeBets: ActiveBet[] = [
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
      market_end_date: "2024-12-31T23:59:59Z",
    },
    {
      position_id: "3",
      market_id: "ai-agi-2025",
      market_title: "Will AGI be achieved by 2025?",
      category: "Tech",
      side: "NO",
      shares: 120000,
      avg_entry_price: 0.35,
      current_price: 0.32,
      invested: 42000,
      current_value: 38400,
      unrealized_pnl: -3600,
      unrealized_pnl_pct: -8.57,
      market_end_date: "2025-12-31T23:59:59Z",
    },
  ];

  // Finished positions
  const finishedBets: FinishedBet[] = [
    {
      position_id: "f1",
      market_id: "btc-100k",
      market_title: "Will BTC hit $100k in 2024?",
      category: "Crypto",
      side: "NO",
      shares: 30000,
      avg_entry_price: 0.30,
      exit_price: 0.85,
      invested: 9000,
      final_value: 25500,
      realized_pnl: 16500,
      realized_pnl_pct: 183.33,
      roi: 183.33,
      closed_date: "2025-10-15T18:30:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f2",
      market_id: "fed-rate-cut",
      market_title: "Will Fed cut rates in Sept 2024?",
      category: "Finance",
      side: "YES",
      shares: 50000,
      avg_entry_price: 0.72,
      exit_price: 0.95,
      invested: 36000,
      final_value: 47500,
      realized_pnl: 11500,
      realized_pnl_pct: 31.94,
      roi: 31.94,
      closed_date: "2024-09-18T14:00:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f3",
      market_id: "taylor-swift-grammys",
      market_title: "Will Taylor Swift win Album of the Year?",
      category: "Pop Culture",
      side: "YES",
      shares: 25000,
      avg_entry_price: 0.65,
      exit_price: 0.15,
      invested: 16250,
      final_value: 3750,
      realized_pnl: -12500,
      realized_pnl_pct: -76.92,
      roi: -76.92,
      closed_date: "2025-02-02T22:00:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f4",
      market_id: "apple-vision-sales",
      market_title: "Will Apple sell 1M Vision Pros in Q1?",
      category: "Tech",
      side: "NO",
      shares: 40000,
      avg_entry_price: 0.58,
      exit_price: 0.88,
      invested: 23200,
      final_value: 35200,
      realized_pnl: 12000,
      realized_pnl_pct: 51.72,
      roi: 51.72,
      closed_date: "2024-04-01T00:00:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f5",
      market_id: "nfl-chiefs-superbowl",
      market_title: "Will Chiefs win Super Bowl 2024?",
      category: "Sports",
      side: "YES",
      shares: 35000,
      avg_entry_price: 0.45,
      exit_price: 0.92,
      invested: 15750,
      final_value: 32200,
      realized_pnl: 16450,
      realized_pnl_pct: 104.44,
      roi: 104.44,
      closed_date: "2024-02-11T23:00:00Z",
      market_outcome: "YES",
    },
  ];

  // Calculate best and worst trades
  const bestTrade = finishedBets.reduce((best, bet) =>
    bet.realized_pnl > best.realized_pnl ? bet : best
  , finishedBets[0]);

  const worstTrade = finishedBets.reduce((worst, bet) =>
    bet.realized_pnl < worst.realized_pnl ? bet : worst
  , finishedBets[0]);

  // Calculate totals for finished bets
  const finishedTotals = {
    invested: finishedBets.reduce((sum, bet) => sum + bet.invested, 0),
    final_value: finishedBets.reduce((sum, bet) => sum + bet.final_value, 0),
    realized_pnl: finishedBets.reduce((sum, bet) => sum + bet.realized_pnl, 0),
  };

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

  const getSharpeLevelBadge = (level: string) => {
    if (level === 'Excellent') return <Badge className="bg-green-600">Excellent (≥2.0)</Badge>;
    if (level === 'Good') return <Badge className="bg-blue-600">Good (≥1.0)</Badge>;
    if (level === 'Fair') return <Badge className="bg-yellow-600">Fair (≥0.5)</Badge>;
    return <Badge variant="destructive">Poor (&lt;0.5)</Badge>;
  };

  // 30d traded volume chart
  const volumeChartOption = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const data = params[0];
        return `
          <div style="padding: 8px;">
            <div><strong>${new Date(data.name).toLocaleDateString()}</strong></div>
            <div style="margin-top: 4px;">
              Volume: <strong>$${(data.value / 1000).toFixed(1)}k</strong>
            </div>
          </div>
        `;
      },
    },
    xAxis: {
      type: 'category',
      data: wallet.risk_metrics?.traded_volume_30d_daily.map((d) => d.date) || [],
      show: false,
    },
    yAxis: {
      type: 'value',
      show: false,
    },
    grid: {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
    series: [
      {
        type: 'line',
        data: wallet.risk_metrics?.traded_volume_30d_daily.map((d) => d.volume_usd) || [],
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: '#3b82f6',
          width: 2,
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0.05)' },
            ],
          },
        },
      },
    ],
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
          {/* Style Badges */}
          <div className="flex items-center gap-2 mt-2">
            {wallet.contrarian_pct >= 50 && (
              <Badge variant="outline" className="bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20">
                <Target className="h-3 w-3 mr-1" />
                Contrarian ({wallet.contrarian_pct}%)
              </Badge>
            )}
            {wallet.lottery_ticket_count > 0 && (
              <Badge variant="outline" className="bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20">
                <Zap className="h-3 w-3 mr-1" />
                Lottery Ticket ({wallet.lottery_ticket_count})
              </Badge>
            )}
            {wallet.is_senior && (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">
                <Medal className="h-3 w-3 mr-1" />
                Senior (1k+ positions)
              </Badge>
            )}
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

      {/* Risk & Rankings Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* PnL Rankings */}
        {wallet.pnl_ranks && (
          <div className="border rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-3">Rank by PnL</h3>
            <div className="grid grid-cols-4 gap-3">
              {[wallet.pnl_ranks.d1, wallet.pnl_ranks.d7, wallet.pnl_ranks.d30, wallet.pnl_ranks.all].map((rank) => (
                <div key={rank.period} className="text-center border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">{rank.period}</div>
                  <div className="text-2xl font-bold text-primary">#{rank.rank}</div>
                  <div className={`text-xs mt-1 ${rank.pnl_usd >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {rank.pnl_usd >= 0 ? '+' : ''}${(rank.pnl_usd / 1000).toFixed(1)}k
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Risk Block */}
        {wallet.risk_metrics && (
          <div className="border rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-3">Risk Metrics</h3>
            <div className="space-y-3">
              {/* Sharpe Ratio */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">Sharpe Ratio (30d)</span>
                  {getSharpeLevelBadge(wallet.risk_metrics.sharpe_level)}
                </div>
                <div className="text-3xl font-bold">{wallet.risk_metrics.sharpe_ratio_30d.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">Annualized (sqrt 252)</div>
              </div>

              {/* 30d Traded Volume */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">Traded Volume (30d)</span>
                  <span className="text-sm font-bold">${(wallet.risk_metrics.traded_volume_30d_total / 1000).toFixed(0)}k</span>
                </div>
                <div className="h-[60px]">
                  <ReactECharts
                    option={volumeChartOption}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'canvas' }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
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
                    <TableCell className="max-w-[200px] truncate">
                      <Link
                        href={`/analysis/market/${trade.market_id}`}
                        className="font-medium text-blue-600 hover:underline cursor-pointer"
                      >
                        {trade.market_title}
                      </Link>
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
        <TabsContent value="positions" className="space-y-6">
          {/* Active Bets Section */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Active Bets ({activeBets.length})</h2>
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
                  {activeBets.map((bet) => (
                    <TableRow key={bet.position_id}>
                      <TableCell className="max-w-[250px]">
                        <Link
                          href={`/analysis/market/${bet.market_id}`}
                          className="font-medium text-blue-600 hover:underline cursor-pointer"
                        >
                          {bet.market_title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{bet.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={bet.side === "YES" ? "default" : "destructive"}>
                          {bet.side}
                        </Badge>
                      </TableCell>
                      <TableCell>{bet.shares.toLocaleString()}</TableCell>
                      <TableCell>{(bet.avg_entry_price * 100).toFixed(1)}¢</TableCell>
                      <TableCell>{(bet.current_price * 100).toFixed(1)}¢</TableCell>
                      <TableCell>${bet.invested.toLocaleString()}</TableCell>
                      <TableCell>${bet.current_value.toLocaleString()}</TableCell>
                      <TableCell className={bet.unrealized_pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                        {bet.unrealized_pnl >= 0 ? "+" : ""}${bet.unrealized_pnl.toLocaleString()} ({bet.unrealized_pnl_pct.toFixed(2)}%)
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(bet.market_end_date).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Finished Bets Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Finished Bets ({finishedBets.length})</h2>
              <div className="flex gap-4 text-sm">
                <span className="text-muted-foreground">
                  Invested: <span className="font-bold">${finishedTotals.invested.toLocaleString()}</span>
                </span>
                <span className="text-muted-foreground">
                  Final Value: <span className="font-bold">${finishedTotals.final_value.toLocaleString()}</span>
                </span>
                <span className={finishedTotals.realized_pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                  PnL: {finishedTotals.realized_pnl >= 0 ? "+" : ""}${finishedTotals.realized_pnl.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Best and Worst Trade Badges */}
            <div className="flex gap-3 mb-3">
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                <Star className="h-4 w-4 text-green-600 dark:text-green-400 fill-current" />
                <span className="text-sm text-muted-foreground">Best Trade:</span>
                <Link href={`/analysis/market/${bestTrade.market_id}`}>
                  <Badge variant="outline" className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700 hover:bg-green-200 dark:hover:bg-green-900/50 cursor-pointer transition-colors">
                    {bestTrade.market_title}
                  </Badge>
                </Link>
                <span className="text-sm font-bold text-green-600 dark:text-green-400">
                  +${bestTrade.realized_pnl.toLocaleString()} ({bestTrade.realized_pnl_pct.toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
                <Star className="h-4 w-4 text-red-600 dark:text-red-400 fill-current" />
                <span className="text-sm text-muted-foreground">Worst Trade:</span>
                <Link href={`/analysis/market/${worstTrade.market_id}`}>
                  <Badge variant="outline" className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700 hover:bg-red-200 dark:hover:bg-red-900/50 cursor-pointer transition-colors">
                    {worstTrade.market_title}
                  </Badge>
                </Link>
                <span className="text-sm font-bold text-red-600 dark:text-red-400">
                  ${worstTrade.realized_pnl.toLocaleString()} ({worstTrade.realized_pnl_pct.toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Shares</TableHead>
                    <TableHead>Entry Price</TableHead>
                    <TableHead>Exit Price</TableHead>
                    <TableHead>Invested</TableHead>
                    <TableHead>Final Value</TableHead>
                    <TableHead>PnL</TableHead>
                    <TableHead>ROI</TableHead>
                    <TableHead>Closed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finishedBets.map((bet) => (
                    <TableRow key={bet.position_id}>
                      <TableCell className="max-w-[250px]">
                        <div className="flex items-center gap-1">
                          {bet === bestTrade && (
                            <Star className="h-3 w-3 text-green-600 dark:text-green-400 fill-current flex-shrink-0" />
                          )}
                          {bet === worstTrade && (
                            <Star className="h-3 w-3 text-red-600 dark:text-red-400 fill-current flex-shrink-0" />
                          )}
                          <Link
                            href={`/analysis/market/${bet.market_id}`}
                            className="font-medium text-blue-600 hover:underline cursor-pointer truncate"
                          >
                            {bet.market_title}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{bet.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={bet.side === "YES" ? "default" : "destructive"}>
                          {bet.side}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={bet.market_outcome === bet.side ? "default" : "destructive"}>
                          {bet.market_outcome}
                        </Badge>
                      </TableCell>
                      <TableCell>{bet.shares.toLocaleString()}</TableCell>
                      <TableCell>{(bet.avg_entry_price * 100).toFixed(1)}¢</TableCell>
                      <TableCell>{(bet.exit_price * 100).toFixed(1)}¢</TableCell>
                      <TableCell>${bet.invested.toLocaleString()}</TableCell>
                      <TableCell>${bet.final_value.toLocaleString()}</TableCell>
                      <TableCell className={bet.realized_pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                        {bet.realized_pnl >= 0 ? "+" : ""}${bet.realized_pnl.toLocaleString()} ({bet.realized_pnl_pct.toFixed(2)}%)
                      </TableCell>
                      <TableCell className={bet.roi >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                        {bet.roi >= 0 ? "+" : ""}{bet.roi.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(bet.closed_date).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
