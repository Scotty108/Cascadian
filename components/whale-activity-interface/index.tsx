"use client";

import { useState } from "react";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import { TrendingUp, TrendingDown, Eye, Wallet, DollarSign, Activity, BarChart3, Filter, ArrowUpRight, ArrowDownRight } from "lucide-react";
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
import type { WhaleTransaction, WhaleActivitySummary, MarketWhaleActivity } from "./types";

export function WhaleActivity() {
  const [timeframe, setTimeframe] = useState<"24h" | "7d" | "30d">("24h");

  // Mock data - will be replaced with API call
  const summary: WhaleActivitySummary = {
    total_volume_24h: 2450000,
    total_transactions_24h: 156,
    avg_transaction_size: 15705,
    top_market: "Will Trump win the 2024 election?",
  };

  const transactions: WhaleTransaction[] = [
    {
      txn_id: "0xabc123",
      wallet_id: "0x1a2b3c",
      wallet_alias: "WhaleTrader42",
      wis: 85,
      market_id: "1",
      market_title: "Will Trump win the 2024 election?",
      outcome: "YES",
      action: "BUY",
      shares: 50000,
      amount_usd: 31500,
      price: 0.63,
      timestamp: "2025-10-20T14:32:00Z",
    },
    {
      txn_id: "0xdef456",
      wallet_id: "0x4d5e6f",
      wallet_alias: "ContraCaptain",
      wis: 72,
      market_id: "2",
      market_title: "Will Bitcoin reach $100k by end of 2024?",
      outcome: "NO",
      action: "BUY",
      shares: 75000,
      amount_usd: 54000,
      price: 0.72,
      timestamp: "2025-10-20T14:15:00Z",
    },
    {
      txn_id: "0xghi789",
      wallet_id: "0xjklmno",
      wallet_alias: "SmartInvestor",
      wis: 91,
      market_id: "1",
      market_title: "Will Trump win the 2024 election?",
      outcome: "YES",
      action: "SELL",
      shares: 30000,
      amount_usd: 19200,
      price: 0.64,
      timestamp: "2025-10-20T13:45:00Z",
    },
    {
      txn_id: "0xjkl012",
      wallet_id: "0x7g8h9i",
      wallet_alias: "MomentumMaster",
      wis: 68,
      market_id: "5",
      market_title: "Will Ethereum reach $10k in 2025?",
      outcome: "YES",
      action: "BUY",
      shares: 100000,
      amount_usd: 72000,
      price: 0.72,
      timestamp: "2025-10-20T12:20:00Z",
    },
  ];

  const marketActivity: MarketWhaleActivity[] = [
    {
      market_id: "1",
      market_title: "Will Trump win the 2024 election?",
      whale_volume_24h: 485000,
      whale_transactions: 42,
      net_whale_sentiment: "BULLISH",
    },
    {
      market_id: "5",
      market_title: "Will Ethereum reach $10k in 2025?",
      whale_volume_24h: 390000,
      whale_transactions: 35,
      net_whale_sentiment: "BULLISH",
    },
    {
      market_id: "2",
      market_title: "Will Bitcoin reach $100k by end of 2024?",
      whale_volume_24h: 320000,
      whale_transactions: 28,
      net_whale_sentiment: "BEARISH",
    },
    {
      market_id: "7",
      market_title: "Will S&P 500 hit 6000 in 2025?",
      whale_volume_24h: 245000,
      whale_transactions: 19,
      net_whale_sentiment: "NEUTRAL",
    },
  ];

  // Volume over time (mock hourly data for last 24h)
  const volumeData = [
    { hour: "00:00", volume: 45000 },
    { hour: "02:00", volume: 32000 },
    { hour: "04:00", volume: 28000 },
    { hour: "06:00", volume: 52000 },
    { hour: "08:00", volume: 78000 },
    { hour: "10:00", volume: 95000 },
    { hour: "12:00", volume: 125000 },
    { hour: "14:00", volume: 142000 },
    { hour: "16:00", volume: 118000 },
    { hour: "18:00", volume: 89000 },
    { hour: "20:00", volume: 67000 },
    { hour: "22:00", volume: 54000 },
  ];

  // Volume over time chart
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
          color: "#00E0AA",
        },
        lineStyle: {
          width: 3,
          color: "#00E0AA",
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
                color: "rgba(0, 224, 170, 0.3)",
              },
              {
                offset: 1,
                color: "rgba(0, 224, 170, 0.05)",
              },
            ],
          },
        },
      },
    ],
  };

  // Top markets by whale volume
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
        data: marketActivity.map((m) => m.whale_volume_24h),
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
                color: "rgba(0, 224, 170, 0.6)",
              },
              {
                offset: 1,
                color: "rgba(0, 224, 170, 1)",
              },
            ],
          },
          borderRadius: [0, 8, 8, 0],
        },
        barWidth: "60%",
      },
    ],
  };

  // Whale sentiment by market
  const sentimentOption = {
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
      bottom: "20%",
      top: "10%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: marketActivity.map((m) => m.market_title.substring(0, 20) + "..."),
      axisLabel: {
        rotate: 45,
        color: "#94a3b8",
        fontSize: 10,
      },
      axisLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.2)",
        },
      },
    },
    yAxis: {
      type: "value",
      name: "Transactions",
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
        name: "Whale Transactions",
        type: "bar",
        data: marketActivity.map((m) => ({
          value: m.whale_transactions,
          itemStyle: {
            color:
              m.net_whale_sentiment === "BULLISH"
                ? "#00E0AA"
                : m.net_whale_sentiment === "BEARISH"
                ? "#ef4444"
                : "#64748b",
            borderRadius: [8, 8, 0, 0],
          },
        })),
        barWidth: "50%",
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

  const getWISColor = (wis: number) => {
    if (wis >= 80) return "text-[#00E0AA]";
    if (wis >= 60) return "text-yellow-500";
    return "text-orange-500";
  };

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
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00E0AA]/10 text-[#00E0AA] shadow-lg shadow-[#00E0AA]/20">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Whale Activity</h1>
              <p className="text-muted-foreground">
                Track large transactions from high-WIS wallets in real-time
              </p>
            </div>
          </div>

          {/* Timeframe Selector */}
          <div className="flex gap-2 pt-2">
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
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">24h Volume</CardTitle>
              <div className="rounded-full bg-[#00E0AA]/10 p-2">
                <DollarSign className="h-4 w-4 text-[#00E0AA]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">
              ${(summary.total_volume_24h / 1000000).toFixed(2)}M
            </div>
            <div className="flex items-center gap-1 text-sm text-[#00E0AA]">
              <TrendingUp className="h-3 w-3" />
              <span>+12.5% vs yesterday</span>
            </div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Transactions</CardTitle>
              <div className="rounded-full bg-[#00E0AA]/10 p-2">
                <BarChart3 className="h-4 w-4 text-[#00E0AA]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">{summary.total_transactions_24h}</div>
            <div className="text-sm text-muted-foreground">Last 24 hours</div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Size</CardTitle>
              <div className="rounded-full bg-[#00E0AA]/10 p-2">
                <Wallet className="h-4 w-4 text-[#00E0AA]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">
              ${(summary.avg_transaction_size / 1000).toFixed(1)}k
            </div>
            <div className="text-sm text-muted-foreground">Per transaction</div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Top Market</CardTitle>
              <div className="rounded-full bg-[#00E0AA]/10 p-2">
                <Eye className="h-4 w-4 text-[#00E0AA]" />
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
        {/* Volume Over Time */}
        <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold tracking-tight">Volume Over Time</CardTitle>
            <CardDescription>Whale trading volume in the last 24 hours</CardDescription>
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

        {/* Top Markets by Volume */}
        <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold tracking-tight">Top Markets</CardTitle>
            <CardDescription>Markets with highest whale volume</CardDescription>
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

        {/* Whale Sentiment */}
        <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold tracking-tight">Whale Sentiment</CardTitle>
            <CardDescription>Net sentiment by market transactions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ReactECharts
                option={sentimentOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </div>
            <div className="mt-6 flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-[#00E0AA]" />
                <span className="text-muted-foreground">Bullish</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-slate-500" />
                <span className="text-muted-foreground">Neutral</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <span className="text-muted-foreground">Bearish</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Market Activity Table */}
        <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold tracking-tight">Market Activity</CardTitle>
            <CardDescription>Detailed whale activity by market</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {marketActivity.map((market) => (
                <div
                  key={market.market_id}
                  className="group rounded-xl border border-border/50 bg-muted/30 p-4 transition hover:border-[#00E0AA]/40 hover:bg-muted/50"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <Link
                      href={`/discovery/markets/${market.market_id}`}
                      className="flex-1 text-sm font-semibold leading-tight transition hover:text-[#00E0AA]"
                    >
                      {market.market_title}
                    </Link>
                    <Badge className={`shrink-0 rounded-full border ${getSentimentColor(market.net_whale_sentiment)}`}>
                      {market.net_whale_sentiment}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-4 text-muted-foreground">
                      <span>
                        <strong className="font-semibold text-foreground">
                          {formatCurrency(market.whale_volume_24h)}
                        </strong>{" "}
                        volume
                      </span>
                      <span>
                        <strong className="font-semibold text-foreground">
                          {market.whale_transactions}
                        </strong>{" "}
                        txns
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold tracking-tight">Recent Whale Transactions</CardTitle>
              <CardDescription>Live feed of large wallet activity</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-full border-border/60 transition hover:border-[#00E0AA]/60 hover:text-[#00E0AA]"
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
                    <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">WIS</th>
                    <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Market</th>
                    <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Action</th>
                    <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Amount</th>
                    <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider">Price</th>
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
                          className={`rounded-full border-transparent ${getWISColor(txn.wis)}`}
                        >
                          {txn.wis}
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
                      <td className="px-2 py-1.5 align-middle text-right text-xs text-muted-foreground">
                        ${txn.price.toFixed(2)}
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
