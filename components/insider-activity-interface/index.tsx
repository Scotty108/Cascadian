"use client";

import { useState } from "react";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import {
  TrendingUp,
  TrendingDown,
  Eye,
  Wallet,
  DollarSign,
  Shield,
  BarChart3,
  Filter,
  ArrowUpRight,
  AlertTriangle,
  Clock,
  Target,
  Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  InsiderTransaction,
  InsiderActivitySummary,
  InsiderMarketActivity,
  InsiderWallet
} from "./types";

export function InsiderActivity() {
  const [timeframe, setTimeframe] = useState<"24h" | "7d" | "30d">("24h");
  const [riskFilter, setRiskFilter] = useState<"ALL" | "HIGH" | "MEDIUM" | "LOW">("ALL");

  // Mock data - will be replaced with API call
  const summary: InsiderActivitySummary = {
    total_insider_volume_24h: 1850000,
    total_insider_transactions_24h: 89,
    avg_insider_score: 78,
    top_market: "Will Trump win the 2024 election?",
    suspected_insider_wallets: 23,
  };

  const insiderWallets: InsiderWallet[] = [
    {
      wallet_id: "0x1a2b3c",
      wallet_alias: "EarlyBird_Pro",
      wis: 92,
      insider_score: 95,
      total_trades: 145,
      win_rate: 87.5,
      avg_entry_timing: 8.2,
      total_profit: 125000,
      active_positions: 12,
      last_activity: "2025-10-21T10:30:00Z",
      risk_level: "HIGH",
    },
    {
      wallet_id: "0x4d5e6f",
      wallet_alias: "InfoEdge",
      wis: 88,
      insider_score: 91,
      total_trades: 98,
      win_rate: 84.2,
      avg_entry_timing: 6.5,
      total_profit: 98000,
      active_positions: 8,
      last_activity: "2025-10-21T09:15:00Z",
      risk_level: "HIGH",
    },
    {
      wallet_id: "0x7g8h9i",
      wallet_alias: "TimingMaster",
      wis: 85,
      insider_score: 87,
      total_trades: 127,
      win_rate: 81.0,
      avg_entry_timing: 12.3,
      total_profit: 76000,
      active_positions: 15,
      last_activity: "2025-10-21T08:45:00Z",
      risk_level: "MEDIUM",
    },
    {
      wallet_id: "0xjklmno",
      wallet_alias: "QuickIntel",
      wis: 79,
      insider_score: 82,
      total_trades: 164,
      win_rate: 78.5,
      avg_entry_timing: 15.7,
      total_profit: 54000,
      active_positions: 9,
      last_activity: "2025-10-21T07:20:00Z",
      risk_level: "MEDIUM",
    },
  ];

  const transactions: InsiderTransaction[] = [
    {
      txn_id: "0xabc123",
      wallet_id: "0x1a2b3c",
      wallet_alias: "EarlyBird_Pro",
      insider_score: 95,
      market_id: "1",
      market_title: "Will Trump win the 2024 election?",
      outcome: "YES",
      action: "BUY",
      shares: 75000,
      amount_usd: 48500,
      price: 0.65,
      timestamp: "2025-10-21T10:30:00Z",
      time_before_resolution: 6.5,
      information_advantage: "CONFIRMED",
    },
    {
      txn_id: "0xdef456",
      wallet_id: "0x4d5e6f",
      wallet_alias: "InfoEdge",
      insider_score: 91,
      market_id: "5",
      market_title: "Will Bitcoin reach $100k by end of 2024?",
      outcome: "NO",
      action: "BUY",
      shares: 90000,
      amount_usd: 63000,
      price: 0.70,
      timestamp: "2025-10-21T09:15:00Z",
      time_before_resolution: 4.2,
      information_advantage: "LIKELY",
    },
    {
      txn_id: "0xghi789",
      wallet_id: "0x7g8h9i",
      wallet_alias: "TimingMaster",
      insider_score: 87,
      market_id: "3",
      market_title: "Will S&P 500 hit 6000 in 2025?",
      outcome: "YES",
      action: "BUY",
      shares: 55000,
      amount_usd: 38500,
      price: 0.70,
      timestamp: "2025-10-21T08:45:00Z",
      time_before_resolution: 12.0,
      information_advantage: "LIKELY",
    },
    {
      txn_id: "0xjkl012",
      wallet_id: "0xjklmno",
      wallet_alias: "QuickIntel",
      insider_score: 82,
      market_id: "7",
      market_title: "Will Ethereum reach $10k in 2025?",
      outcome: "YES",
      action: "BUY",
      shares: 42000,
      amount_usd: 29400,
      price: 0.70,
      timestamp: "2025-10-21T07:20:00Z",
      time_before_resolution: 18.5,
      information_advantage: "SUSPECTED",
    },
  ];

  const marketActivity: InsiderMarketActivity[] = [
    {
      market_id: "1",
      market_title: "Will Trump win the 2024 election?",
      insider_volume_24h: 485000,
      insider_transactions: 28,
      insider_sentiment: "BULLISH",
      suspicious_activity_score: 85,
      avg_entry_timing: 7.2,
      resolution_date: "2025-10-28T00:00:00Z",
    },
    {
      market_id: "5",
      market_title: "Will Bitcoin reach $100k by end of 2024?",
      insider_volume_24h: 392000,
      insider_transactions: 22,
      insider_sentiment: "BEARISH",
      suspicious_activity_score: 78,
      avg_entry_timing: 5.8,
      resolution_date: "2025-10-25T00:00:00Z",
    },
    {
      market_id: "3",
      market_title: "Will S&P 500 hit 6000 in 2025?",
      insider_volume_24h: 275000,
      insider_transactions: 18,
      insider_sentiment: "BULLISH",
      suspicious_activity_score: 72,
      avg_entry_timing: 10.5,
      resolution_date: "2025-10-30T00:00:00Z",
    },
    {
      market_id: "7",
      market_title: "Will Ethereum reach $10k in 2025?",
      insider_volume_24h: 198000,
      insider_transactions: 14,
      insider_sentiment: "BULLISH",
      suspicious_activity_score: 65,
      avg_entry_timing: 14.3,
      resolution_date: "2025-11-02T00:00:00Z",
    },
  ];

  // Insider volume over time (mock hourly data for last 24h)
  const volumeData = [
    { hour: "00:00", volume: 28000 },
    { hour: "02:00", volume: 22000 },
    { hour: "04:00", volume: 35000 },
    { hour: "06:00", volume: 48000 },
    { hour: "08:00", volume: 67000 },
    { hour: "10:00", volume: 95000 },
    { hour: "12:00", volume: 125000 },
    { hour: "14:00", volume: 158000 },
    { hour: "16:00", volume: 142000 },
    { hour: "18:00", volume: 98000 },
    { hour: "20:00", volume: 75000 },
    { hour: "22:00", volume: 52000 },
  ];

  // Insider score distribution
  const scoreDistributionData = [
    { range: "60-69", count: 8 },
    { range: "70-79", count: 15 },
    { range: "80-89", count: 22 },
    { range: "90-100", count: 12 },
  ];

  // Volume chart option
  const volumeOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      borderColor: "rgba(0, 224, 170, 0.3)",
      borderWidth: 1,
      textStyle: {
        color: "#ffffff",
      },
      formatter: (params: any) => {
        const data = params[0];
        return `
          <div style="padding: 8px;">
            <strong style="color: #00E0AA;">${data.axisValue}</strong><br/>
            Volume: <strong>$${data.data.toLocaleString()}</strong>
          </div>
        `;
      },
    },
    grid: {
      left: "3%",
      right: "3%",
      bottom: "15%",
      top: "10%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: volumeData.map((d) => d.hour),
      name: "Time (24h)",
      nameTextStyle: {
        color: "#94a3b8",
        fontSize: 12,
      },
      axisLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.2)",
        },
      },
      axisLabel: {
        color: "#94a3b8",
        fontSize: 11,
      },
    },
    yAxis: {
      type: "value",
      name: "Volume (USD)",
      nameTextStyle: {
        color: "#94a3b8",
        fontSize: 12,
      },
      axisLine: {
        show: false,
      },
      splitLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.1)",
        },
      },
      axisLabel: {
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
        color: "#94a3b8",
        fontSize: 11,
      },
    },
    series: [
      {
        type: "line",
        data: volumeData.map((d) => d.volume),
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        itemStyle: {
          color: "#ef4444",
        },
        lineStyle: {
          width: 3,
          color: "#ef4444",
        },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              {
                offset: 0,
                color: "rgba(239, 68, 68, 0.3)",
              },
              {
                offset: 1,
                color: "rgba(239, 68, 68, 0.05)",
              },
            ],
          },
        },
      },
    ],
  };

  // Insider score distribution chart
  const scoreDistributionOption = {
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      borderColor: "rgba(0, 224, 170, 0.3)",
      borderWidth: 1,
      textStyle: {
        color: "#ffffff",
      },
    },
    grid: {
      left: "3%",
      right: "3%",
      bottom: "15%",
      top: "10%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: scoreDistributionData.map((d) => d.range),
      name: "Insider Score Range",
      nameTextStyle: {
        color: "#94a3b8",
        fontSize: 12,
      },
      axisLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.2)",
        },
      },
      axisLabel: {
        color: "#94a3b8",
        fontSize: 11,
      },
    },
    yAxis: {
      type: "value",
      name: "Number of Wallets",
      nameTextStyle: {
        color: "#94a3b8",
        fontSize: 12,
      },
      axisLine: {
        show: false,
      },
      splitLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.1)",
        },
      },
      axisLabel: {
        color: "#94a3b8",
        fontSize: 11,
      },
    },
    series: [
      {
        type: "bar",
        data: scoreDistributionData.map((d) => d.count),
        itemStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 1,
            x2: 0,
            y2: 0,
            colorStops: [
              {
                offset: 0,
                color: "rgba(239, 68, 68, 0.6)",
              },
              {
                offset: 1,
                color: "rgba(239, 68, 68, 1)",
              },
            ],
          },
          borderRadius: [8, 8, 0, 0],
        },
        barWidth: "60%",
      },
    ],
  };

  // Top markets by insider activity
  const topMarketsOption = {
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      borderColor: "rgba(0, 224, 170, 0.3)",
      borderWidth: 1,
      textStyle: {
        color: "#ffffff",
      },
      formatter: (params: any) => {
        const data = params[0];
        return `
          <div style="padding: 8px;">
            <strong style="color: #00E0AA;">${data.name}</strong><br/>
            Volume: <strong>$${data.data.toLocaleString()}</strong>
          </div>
        `;
      },
    },
    grid: {
      left: "3%",
      right: "3%",
      bottom: "3%",
      top: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: "Volume (USD)",
      nameTextStyle: {
        color: "#94a3b8",
        fontSize: 12,
      },
      axisLine: {
        show: false,
      },
      splitLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.1)",
        },
      },
      axisLabel: {
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
        color: "#94a3b8",
        fontSize: 11,
      },
    },
    yAxis: {
      type: "category",
      data: marketActivity.map((m) => m.market_title.substring(0, 30) + "..."),
      axisLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.2)",
        },
      },
      axisLabel: {
        color: "#94a3b8",
        fontSize: 11,
      },
    },
    series: [
      {
        type: "bar",
        data: marketActivity.map((m) => m.insider_volume_24h),
        itemStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              {
                offset: 0,
                color: "rgba(239, 68, 68, 0.6)",
              },
              {
                offset: 1,
                color: "rgba(239, 68, 68, 1)",
              },
            ],
          },
          borderRadius: [0, 8, 8, 0],
        },
        barWidth: "60%",
      },
    ],
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case "BULLISH":
        return "bg-[#00E0AA]/10 text-[#00E0AA] border-[#00E0AA]/30";
      case "BEARISH":
        return "bg-red-500/10 text-red-500 border-red-500/30";
      default:
        return "bg-slate-500/10 text-slate-500 border-slate-500/30";
    }
  };

  const getInsiderScoreColor = (score: number) => {
    if (score >= 90) return "text-red-500";
    if (score >= 80) return "text-orange-500";
    if (score >= 70) return "text-yellow-500";
    return "text-[#00E0AA]";
  };

  const getAdvantageColor = (advantage: string) => {
    switch (advantage) {
      case "CONFIRMED":
        return "bg-red-500/10 text-red-500 border-red-500/30";
      case "LIKELY":
        return "bg-orange-500/10 text-orange-500 border-orange-500/30";
      default:
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/30";
    }
  };

  const getRiskLevelColor = (risk: string) => {
    switch (risk) {
      case "HIGH":
        return "bg-red-500/10 text-red-500 border-red-500/30";
      case "MEDIUM":
        return "bg-orange-500/10 text-orange-500 border-orange-500/30";
      default:
        return "bg-[#00E0AA]/10 text-[#00E0AA] border-[#00E0AA]/30";
    }
  };

  const filteredWallets = riskFilter === "ALL"
    ? insiderWallets
    : insiderWallets.filter(w => w.risk_level === riskFilter);

  return (
    <div className="flex flex-col space-y-8 p-4 sm:p-6 lg:p-8">
      {/* Header with Gradient Background */}
      <div className="relative overflow-hidden rounded-3xl border border-border/40 bg-gradient-to-br from-background via-background to-background p-8 shadow-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(circle at 20% 20%, rgba(0,224,170,0.15), transparent 50%), radial-gradient(circle at 85% 30%, rgba(0,224,170,0.08), transparent 45%)",
          }}
          aria-hidden="true"
        />
        <div className="relative space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500 shadow-lg shadow-red-500/20">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Insider Activity</h1>
              <p className="text-muted-foreground">
                Track wallets with suspected information advantages and early market moves
              </p>
            </div>
          </div>

          {/* Control Bar */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {/* Timeframe Selector */}
            <div className="flex gap-2">
              {(["24h", "7d", "30d"] as const).map((tf) => (
                <Button
                  key={tf}
                  variant={timeframe === tf ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTimeframe(tf)}
                  className={
                    timeframe === tf
                      ? "rounded-full bg-[#00E0AA] text-slate-950 shadow-lg shadow-[#00E0AA]/30 hover:bg-[#00E0AA]/90"
                      : "rounded-full border-border/60 transition hover:border-[#00E0AA]/60 hover:text-[#00E0AA]"
                  }
                >
                  {tf.toUpperCase()}
                </Button>
              ))}
            </div>

            {/* Risk Filter */}
            <div className="flex gap-2">
              {(["ALL", "HIGH", "MEDIUM", "LOW"] as const).map((risk) => (
                <Button
                  key={risk}
                  variant={riskFilter === risk ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRiskFilter(risk)}
                  className={
                    riskFilter === risk
                      ? "rounded-full bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-500/90"
                      : "rounded-full border-border/60 transition hover:border-red-500/60 hover:text-red-500"
                  }
                >
                  {risk}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-red-500/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">24h Volume</CardTitle>
              <div className="rounded-full bg-red-500/10 p-2">
                <DollarSign className="h-4 w-4 text-red-500" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">
              ${(summary.total_insider_volume_24h / 1000000).toFixed(2)}M
            </div>
            <div className="flex items-center gap-1 text-sm text-red-500">
              <AlertTriangle className="h-3 w-3" />
              <span>Insider volume</span>
            </div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-red-500/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Transactions</CardTitle>
              <div className="rounded-full bg-red-500/10 p-2">
                <BarChart3 className="h-4 w-4 text-red-500" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">{summary.total_insider_transactions_24h}</div>
            <div className="text-sm text-muted-foreground">Last 24 hours</div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-red-500/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Score</CardTitle>
              <div className="rounded-full bg-red-500/10 p-2">
                <Target className="h-4 w-4 text-red-500" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">{summary.avg_insider_score}</div>
            <div className="text-sm text-muted-foreground">Insider score</div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-red-500/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Suspected</CardTitle>
              <div className="rounded-full bg-red-500/10 p-2">
                <Wallet className="h-4 w-4 text-red-500" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">{summary.suspected_insider_wallets}</div>
            <div className="text-sm text-muted-foreground">Active wallets</div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-red-500/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Top Market</CardTitle>
              <div className="rounded-full bg-red-500/10 p-2">
                <Eye className="h-4 w-4 text-red-500" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="line-clamp-2 text-sm font-semibold leading-tight">
              {summary.top_market}
            </div>
            <div className="text-sm text-muted-foreground">Most activity</div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Insider Volume Over Time */}
        <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold tracking-tight">Insider Volume Over Time</CardTitle>
            <CardDescription>Suspicious trading volume in the last 24 hours</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ReactECharts
                option={volumeOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Insider Score Distribution */}
        <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold tracking-tight">Insider Score Distribution</CardTitle>
            <CardDescription>Distribution of suspected insider wallets by score</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ReactECharts
                option={scoreDistributionOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Top Markets by Insider Activity */}
        <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold tracking-tight">Top Markets</CardTitle>
            <CardDescription>Markets with highest insider activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ReactECharts
                option={topMarketsOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Market Activity Details */}
        <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold tracking-tight">Market Analysis</CardTitle>
            <CardDescription>Detailed insider activity by market</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {marketActivity.map((market) => (
                <div
                  key={market.market_id}
                  className="group rounded-xl border border-border/50 bg-muted/30 p-4 transition hover:border-red-500/40 hover:bg-muted/50"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <Link
                      href={`/discovery/markets/${market.market_id}`}
                      className="flex-1 text-sm font-semibold leading-tight transition hover:text-[#00E0AA]"
                    >
                      {market.market_title}
                    </Link>
                    <Badge className={`shrink-0 rounded-full border ${getSentimentColor(market.insider_sentiment)}`}>
                      {market.insider_sentiment}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                      <span>
                        <strong className="font-semibold text-foreground">
                          {formatCurrency(market.insider_volume_24h)}
                        </strong>{" "}
                        volume
                      </span>
                      <span>
                        <strong className="font-semibold text-foreground">
                          {market.insider_transactions}
                        </strong>{" "}
                        txns
                      </span>
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-500" />
                        <strong className="font-semibold text-red-500">
                          {market.suspicious_activity_score}
                        </strong>{" "}
                        risk
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <strong className="font-semibold text-foreground">
                          {market.avg_entry_timing.toFixed(1)}h
                        </strong>{" "}
                        before
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Suspected Insider Wallets */}
      <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold tracking-tight">Suspected Insider Wallets</CardTitle>
              <CardDescription>Wallets showing signs of information advantage</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-full border-border/60 transition hover:border-red-500/60 hover:text-red-500"
            >
              <Filter className="h-4 w-4" />
              Filter
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredWallets.map((wallet) => (
              <div
                key={wallet.wallet_id}
                className="group rounded-2xl border border-border/50 bg-muted/30 p-5 transition hover:border-red-500/40 hover:bg-muted/50"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/analysis/wallet/${wallet.wallet_id}`}
                        className="inline-flex items-center gap-1.5 text-lg font-bold transition hover:text-[#00E0AA]"
                      >
                        {wallet.wallet_alias}
                        <ArrowUpRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" />
                      </Link>
                      <Badge className={`rounded-full border ${getRiskLevelColor(wallet.risk_level)}`}>
                        {wallet.risk_level} RISK
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Target className="h-4 w-4 text-red-500" />
                        <span className={`font-bold ${getInsiderScoreColor(wallet.insider_score)}`}>
                          {wallet.insider_score}
                        </span>
                        <span>Insider Score</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Activity className="h-4 w-4" />
                        <span className="font-semibold text-foreground">{wallet.wis}</span>
                        <span>WIS</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <BarChart3 className="h-4 w-4" />
                        <span className="font-semibold text-foreground">{wallet.win_rate}%</span>
                        <span>Win Rate</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4" />
                        <span className="font-semibold text-foreground">{wallet.avg_entry_timing.toFixed(1)}h</span>
                        <span>Avg Entry Time</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-6 lg:flex-col lg:items-end lg:gap-1">
                    <div className="text-right">
                      <div className="text-2xl font-bold tracking-tight text-[#00E0AA]">
                        {formatCurrency(wallet.total_profit)}
                      </div>
                      <div className="text-xs text-muted-foreground">Total Profit</div>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <div className="text-right">
                        <div className="font-bold text-foreground">{wallet.total_trades}</div>
                        <div className="text-xs text-muted-foreground">Trades</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-foreground">{wallet.active_positions}</div>
                        <div className="text-xs text-muted-foreground">Active</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Insider Transactions */}
      <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold tracking-tight">Recent Insider Transactions</CardTitle>
              <CardDescription>Live feed of suspected insider trading activity</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-full border-border/60 transition hover:border-red-500/60 hover:text-red-500"
            >
              <Filter className="h-4 w-4" />
              Filter
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <div
              className="overflow-x-auto"
              style={{
                maxHeight: '600px',
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
                <thead className="sticky top-0 z-40 bg-background border-b border-border">
                  <tr>
                    <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Time</th>
                    <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Wallet</th>
                    <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Score</th>
                    <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Market</th>
                    <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Action</th>
                    <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Amount</th>
                    <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Entry Time</th>
                    <th className="px-2 py-3 text-center align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Advantage</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn) => (
                    <tr
                      key={txn.txn_id}
                      className="group border-b border-border hover:bg-muted/30 transition"
                    >
                      <td className="px-2 py-1.5 align-middle text-xs text-muted-foreground">
                        {formatTime(txn.timestamp)}
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <Link
                          href={`/analysis/wallet/${txn.wallet_id}`}
                          className="inline-flex items-center gap-1 text-sm font-medium transition hover:text-[#00E0AA]"
                        >
                          {txn.wallet_alias}
                          <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <Badge
                          variant="outline"
                          className={`rounded-full border-transparent ${getInsiderScoreColor(txn.insider_score)}`}
                        >
                          {txn.insider_score}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 align-middle max-w-[200px]">
                        <Link
                          href={`/discovery/markets/${txn.market_id}`}
                          className="line-clamp-1 text-xs text-muted-foreground transition hover:text-[#00E0AA]"
                        >
                          {txn.market_title}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <div className="flex items-center gap-1.5">
                          {txn.action === "BUY" ? (
                            <div className="rounded-full bg-[#00E0AA]/10 p-1">
                              <TrendingUp className="h-3 w-3 text-[#00E0AA]" />
                            </div>
                          ) : (
                            <div className="rounded-full bg-red-500/10 p-1">
                              <TrendingDown className="h-3 w-3 text-red-500" />
                            </div>
                          )}
                          <span
                            className={`text-xs font-semibold ${
                              txn.action === "BUY" ? "text-[#00E0AA]" : "text-red-500"
                            }`}
                          >
                            {txn.action}
                          </span>
                          <Badge variant="outline" className="ml-1 rounded-full text-[10px]">
                            {txn.outcome}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-middle text-right text-sm font-semibold">
                        {formatCurrency(txn.amount_usd)}
                      </td>
                      <td className="px-2 py-1.5 align-middle text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Clock className="h-3 w-3 text-red-500" />
                          <span className="text-xs font-semibold text-red-500">
                            {txn.time_before_resolution.toFixed(1)}h
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-middle text-center">
                        <Badge className={`rounded-full border text-[10px] ${getAdvantageColor(txn.information_advantage)}`}>
                          {txn.information_advantage}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
