"use client";

import { useState } from "react";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import { TrendingUp, TrendingDown, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      formatter: (params: any) => {
        const data = params[0];
        return `
          <div style="padding: 8px;">
            <strong>${data.axisValue}</strong><br/>
            Volume: <strong>$${data.data.toLocaleString()}</strong>
          </div>
        `;
      },
    },
    xAxis: {
      type: "category",
      data: volumeData.map((d) => d.hour),
      name: "Time (24h)",
    },
    yAxis: {
      type: "value",
      name: "Volume (USD)",
      axisLabel: {
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
      },
    },
    series: [
      {
        type: "line",
        data: volumeData.map((d) => d.volume),
        smooth: true,
        itemStyle: {
          color: "#3b82f6",
        },
        areaStyle: {
          color: "rgba(59, 130, 246, 0.2)",
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
      formatter: (params: any) => {
        const data = params[0];
        return `
          <div style="padding: 8px;">
            <strong>${data.name}</strong><br/>
            Volume: <strong>$${data.data.toLocaleString()}</strong>
          </div>
        `;
      },
    },
    xAxis: {
      type: "value",
      name: "Volume (USD)",
      axisLabel: {
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
      },
    },
    yAxis: {
      type: "category",
      data: marketActivity.map((m) => m.market_title.substring(0, 30) + "..."),
    },
    series: [
      {
        type: "bar",
        data: marketActivity.map((m) => m.whale_volume_24h),
        itemStyle: {
          color: "#3b82f6",
        },
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
    },
    xAxis: {
      type: "category",
      data: marketActivity.map((m) => m.market_title.substring(0, 20) + "..."),
      axisLabel: {
        rotate: 45,
      },
    },
    yAxis: {
      type: "value",
      name: "Transactions",
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
                ? "#16a34a"
                : m.net_whale_sentiment === "BEARISH"
                ? "#dc2626"
                : "#9ca3af",
          },
        })),
      },
    ],
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col h-full space-y-4 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Whale Activity</h1>
        <p className="text-muted-foreground">
          Track large transactions from high-WIS wallets in real-time
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">24h Volume</p>
          <p className="text-2xl font-bold">${(summary.total_volume_24h / 1000000).toFixed(2)}M</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Transactions</p>
          <p className="text-2xl font-bold">{summary.total_transactions_24h}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Avg Size</p>
          <p className="text-2xl font-bold">${(summary.avg_transaction_size / 1000).toFixed(1)}k</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Top Market</p>
          <p className="text-sm font-semibold truncate">{summary.top_market}</p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Volume Over Time */}
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">Volume Over Time (24h)</h2>
          <div className="h-[300px]">
            <ReactECharts
              option={volumeOption}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
            />
          </div>
        </div>

        {/* Top Markets by Volume */}
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">Top Markets by Whale Volume</h2>
          <div className="h-[300px]">
            <ReactECharts
              option={topMarketsOption}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
            />
          </div>
        </div>

        {/* Whale Sentiment */}
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">Whale Sentiment by Market</h2>
          <div className="h-[300px]">
            <ReactECharts
              option={sentimentOption}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
            />
          </div>
          <div className="flex gap-6 text-sm mt-4">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#16a34a" }} />
              <span>Bullish</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#9ca3af" }} />
              <span>Neutral</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#dc2626" }} />
              <span>Bearish</span>
            </div>
          </div>
        </div>

        {/* Recent Transactions Table */}
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">Recent Whale Transactions</h2>
          <div className="overflow-auto max-h-[300px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((txn) => (
                  <TableRow key={txn.txn_id}>
                    <TableCell className="text-xs">{formatTime(txn.timestamp)}</TableCell>
                    <TableCell>
                      <Link
                        href={`/analysis/wallet/${txn.wallet_id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        {txn.wallet_alias}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {txn.action === "BUY" ? (
                          <TrendingUp className="h-3 w-3 text-green-600" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-red-600" />
                        )}
                        <span
                          className={`text-xs font-semibold ${
                            txn.action === "BUY" ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {txn.action}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-semibold">
                      ${txn.amount_usd.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
