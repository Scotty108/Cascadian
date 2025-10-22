"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactECharts from "echarts-for-react";
import {
  TrendingUp,
  ArrowLeft,
  Calendar,
  ExternalLink,
  Users,
  Clock,
  DollarSign,
  Info,
  Activity,
  BarChart3,
  Wallet,
  TrendingDown
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { TruncatedTable } from "@/components/ui/truncated-table";
import { Separator } from "@/components/ui/separator";
import {
  generateMarketDetail,
  generatePriceHistory,
  generateHolders,
  generateWhaleTrades,
  generateSIIHistory,
  generateSignalBreakdown,
  generateRelatedMarkets,
} from "@/lib/generate-market-detail";
import type {
  MarketDetail as MarketDetailType,
  PriceHistoryPoint,
  SignalBreakdown,
  WhaleTradeForMarket,
  OrderBook,
  SIIHistoryPoint,
  RelatedMarket,
  HolderPosition,
  HoldersSummary,
  OHLCDataPoint,
} from "./types";

interface MarketDetailProps {
  marketId: string;
}

export function MarketDetail({ marketId }: MarketDetailProps) {
  const router = useRouter();
  const [priceTimeframe, setPriceTimeframe] = useState<"1h" | "24h" | "7d" | "30d">("7d");

  // Generate data using generators
  const market = generateMarketDetail('Politics');

  // Mock additional market data
  const marketData = {
    ...market,
    tradersCount: 12345,
    startDate: "2023-01-15T00:00:00Z",
    polymarketUrl: "https://polymarket.com/market/will-donald-trump-win-2024",
    rules: "This market resolves to YES if Donald Trump wins the 2024 United States Presidential Election, as determined by the official certification of electoral college votes. The market will resolve once the election results are certified by Congress in January 2025.",
  };

  const eventSlug = "2024-presidential-election";
  const priceHistory = generatePriceHistory(market.current_price, 168);
  const yesHolders = generateHolders('YES', 156, market.current_price);
  const noHolders = generateHolders('NO', 98, market.current_price);
  const whaleTrades = generateWhaleTrades(20, market.current_price);
  const siiHistory = generateSIIHistory(market.sii, 48);
  const signalBreakdown = generateSignalBreakdown();
  const relatedMarkets = generateRelatedMarkets(market.category, 3);

  // Calculate holder summaries
  const yesSummary: HoldersSummary = {
    side: "YES",
    holders_count: 156,
    profit_usd: yesHolders.filter(h => h.pnl_total > 0).reduce((sum, h) => sum + h.pnl_total, 0),
    loss_usd: yesHolders.filter(h => h.pnl_total < 0).reduce((sum, h) => sum + h.pnl_total, 0),
    realized_price: yesHolders.reduce((sum, h) => sum + h.avg_entry, 0) / yesHolders.length,
  };

  const noSummary: HoldersSummary = {
    side: "NO",
    holders_count: 98,
    profit_usd: noHolders.filter(h => h.pnl_total > 0).reduce((sum, h) => sum + h.pnl_total, 0),
    loss_usd: noHolders.filter(h => h.pnl_total < 0).reduce((sum, h) => sum + h.pnl_total, 0),
    realized_price: noHolders.reduce((sum, h) => sum + h.avg_entry, 0) / noHolders.length,
  };

  // Order book
  const orderBook: OrderBook = {
    bids: [
      { price: 0.6295, size: 10000, total: 10000 },
      { price: 0.6290, size: 15000, total: 25000 },
      { price: 0.6285, size: 20000, total: 45000 },
      { price: 0.6280, size: 25000, total: 70000 },
      { price: 0.6275, size: 30000, total: 100000 },
    ],
    asks: [
      { price: 0.6305, size: 12000, total: 12000 },
      { price: 0.6310, size: 18000, total: 30000 },
      { price: 0.6315, size: 22000, total: 52000 },
      { price: 0.6320, size: 28000, total: 80000 },
      { price: 0.6325, size: 35000, total: 115000 },
    ],
    timestamp: new Date().toISOString(),
  };

  // OHLC data (7 days, 4h candles)
  const ohlcData: OHLCDataPoint[] = Array.from({ length: 42 }, (_, i) => {
    const basePrice = 0.55 + (i / 42) * 0.08;
    const volatility = 0.02;
    return {
      timestamp: new Date(Date.now() - (42 - i) * 4 * 3600000).toISOString(),
      open: basePrice + (Math.random() - 0.5) * volatility,
      high: basePrice + Math.random() * volatility,
      low: basePrice - Math.random() * volatility,
      close: basePrice + (Math.random() - 0.5) * volatility,
      volume: 15000 + Math.random() * 35000,
    };
  });

  // Price chart option with modern styling
  const priceChartOption = {
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
        lineStyle: {
          color: '#00E0AA',
          opacity: 0.3
        }
      },
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: '#00E0AA',
      borderWidth: 1,
      textStyle: {
        color: '#fff'
      },
      formatter: (params: any) => {
        const timestamp = params[0].name;
        const yesValue = params[0].value;
        const noValue = params[1].value;
        return `
          <div style="padding: 12px; font-family: system-ui;">
            <div style="font-weight: 600; margin-bottom: 8px;">${new Date(timestamp).toLocaleString()}</div>
            <div style="margin-top: 6px; color: #00E0AA; font-size: 14px;">
              YES: <strong>${(yesValue * 100).toFixed(1)}¢</strong>
            </div>
            <div style="color: #f59e0b; font-size: 14px;">
              NO: <strong>${(noValue * 100).toFixed(1)}¢</strong>
            </div>
          </div>
        `;
      },
    },
    legend: {
      data: ["YES Price", "NO Price"],
      top: 0,
      textStyle: {
        color: '#888',
        fontSize: 12
      }
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "12%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: priceHistory.map((p) => p.timestamp),
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          if (priceTimeframe === "1h") {
            return `${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}`;
          } else if (priceTimeframe === "24h") {
            return `${date.getHours()}:00`;
          } else {
            return `${date.getMonth() + 1}/${date.getDate()}`;
          }
        },
        color: '#888'
      },
      axisLine: {
        lineStyle: {
          color: '#333'
        }
      }
    },
    yAxis: {
      type: "value",
      name: "Price",
      nameTextStyle: {
        color: '#888',
        fontSize: 12
      },
      axisLabel: {
        formatter: (value: number) => `${(value * 100).toFixed(0)}¢`,
        color: '#888'
      },
      splitLine: {
        lineStyle: {
          color: '#222',
          opacity: 0.3
        }
      },
      min: 0,
      max: 1,
    },
    series: [
      {
        name: "YES Price",
        type: "line",
        smooth: true,
        data: priceHistory.map((p) => p.price),
        lineStyle: { width: 3, color: "#00E0AA" },
        itemStyle: { color: "#00E0AA" },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 224, 170, 0.3)' },
              { offset: 1, color: 'rgba(0, 224, 170, 0.05)' }
            ]
          }
        },
        symbol: 'none',
        emphasis: {
          focus: 'series',
          lineStyle: {
            width: 4
          }
        }
      },
      {
        name: "NO Price",
        type: "line",
        smooth: true,
        data: priceHistory.map((p) => 1 - p.price),
        lineStyle: { width: 3, color: "#f59e0b" },
        itemStyle: { color: "#f59e0b" },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(245, 158, 11, 0.3)' },
              { offset: 1, color: 'rgba(245, 158, 11, 0.05)' }
            ]
          }
        },
        symbol: 'none',
        emphasis: {
          focus: 'series',
          lineStyle: {
            width: 4
          }
        }
      },
    ],
    animation: true,
    animationDuration: 1000,
    animationEasing: 'cubicOut'
  };

  // SII chart with modern styling
  const siiChartOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: '#00E0AA',
      borderWidth: 1,
      textStyle: {
        color: '#fff'
      }
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "8%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: siiHistory.map((s) => s.timestamp),
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          return `${date.getHours()}:00`;
        },
        color: '#888'
      },
      axisLine: {
        lineStyle: {
          color: '#333'
        }
      }
    },
    yAxis: {
      type: "value",
      name: "SII Score",
      nameTextStyle: {
        color: '#888',
        fontSize: 12
      },
      axisLabel: {
        color: '#888'
      },
      splitLine: {
        lineStyle: {
          color: '#222',
          opacity: 0.3
        }
      },
      min: 0,
      max: 100,
    },
    series: [
      {
        type: "line",
        data: siiHistory.map((s) => s.sii),
        smooth: true,
        lineStyle: {
          width: 3,
          color: '#00E0AA'
        },
        itemStyle: {
          color: '#00E0AA',
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 224, 170, 0.3)' },
              { offset: 1, color: 'rgba(0, 224, 170, 0.05)' }
            ]
          }
        },
        symbol: 'none',
        emphasis: {
          lineStyle: {
            width: 4
          }
        }
      },
    ],
    animation: true,
    animationDuration: 1000,
    animationEasing: 'cubicOut'
  };

  // Order book depth chart with modern styling
  const orderBookOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: '#00E0AA',
      borderWidth: 1,
      textStyle: {
        color: '#fff'
      }
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "8%",
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: "Price",
      nameTextStyle: {
        color: '#888',
        fontSize: 12
      },
      axisLabel: {
        formatter: (value: number) => `${(value * 100).toFixed(1)}¢`,
        color: '#888'
      },
      axisLine: {
        lineStyle: {
          color: '#333'
        }
      }
    },
    yAxis: {
      type: "value",
      name: "Cumulative Size",
      nameTextStyle: {
        color: '#888',
        fontSize: 12
      },
      axisLabel: {
        color: '#888'
      },
      splitLine: {
        lineStyle: {
          color: '#222',
          opacity: 0.3
        }
      }
    },
    series: [
      {
        name: "Bids",
        type: "line",
        data: orderBook.bids.map((b) => [b.price, b.total]),
        step: "end",
        lineStyle: {
          width: 2,
          color: '#00E0AA'
        },
        itemStyle: {
          color: "#00E0AA",
        },
        areaStyle: {
          color: "rgba(0, 224, 170, 0.2)",
        },
        symbol: 'none'
      },
      {
        name: "Asks",
        type: "line",
        data: orderBook.asks.map((a) => [a.price, a.total]),
        step: "start",
        lineStyle: {
          width: 2,
          color: '#ef4444'
        },
        itemStyle: {
          color: "#ef4444",
        },
        areaStyle: {
          color: "rgba(239, 68, 68, 0.2)",
        },
        symbol: 'none'
      },
    ],
    animation: true,
    animationDuration: 800,
    animationEasing: 'cubicOut'
  };

  const getSIIColor = (sii: number) => {
    if (sii >= 70) return "text-[#00E0AA] font-bold";
    if (sii > 50) return "text-[#00E0AA]";
    if (sii > 30) return "text-muted-foreground";
    if (sii > 0) return "text-red-500";
    return "text-red-600 font-bold";
  };

  const getRecommendationBadge = (rec: string) => {
    if (rec === "BUY_YES") return <Badge className="bg-[#00E0AA] hover:bg-[#00E0AA]/90 text-black font-semibold">BUY YES</Badge>;
    if (rec === "BUY_NO") return <Badge className="bg-red-600 hover:bg-red-700">BUY NO</Badge>;
    if (rec === "SELL") return <Badge className="bg-orange-600 hover:bg-orange-700">SELL</Badge>;
    return <Badge variant="secondary">HOLD</Badge>;
  };

  const getTimeAgo = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffHours > 24) {
      const days = Math.floor(diffHours / 24);
      return `${days}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else {
      return `${diffMins}m ago`;
    }
  };

  // Calculate smart money percentage
  const smartMoneyYes = yesHolders.filter(h => h.smart_score >= 70).length / yesHolders.length * 100;

  return (
    <div className="flex flex-col h-full space-y-8 p-6 max-w-[1600px] mx-auto">
      {/* Header Section */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">{market.title}</h1>
              <Badge variant="outline" className="text-sm">{market.category}</Badge>
            </div>
            <p className="text-base text-muted-foreground leading-relaxed max-w-4xl">{market.description}</p>
          </div>
          <Button variant="outline" asChild className="gap-2 shrink-0">
            <Link href={`/events/${eventSlug}`}>
              <Calendar className="h-4 w-4" />
              View Event
            </Link>
          </Button>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard
          icon={<BarChart3 className="h-5 w-5 text-[#00E0AA]" />}
          label="Current Price"
          value={`${(market.current_price * 100).toFixed(1)}¢`}
          change="+2.4%"
          changeType="positive"
        />
        <MetricCard
          icon={<Activity className="h-5 w-5 text-[#00E0AA]" />}
          label="SII Score"
          value={market.sii.toString()}
          subtitle={`${(market.signal_confidence * 100).toFixed(0)}% confidence`}
          valueClassName={getSIIColor(market.sii)}
        />
        <MetricCard
          icon={<TrendingUp className="h-5 w-5 text-[#00E0AA]" />}
          label="24h Volume"
          value={`$${(market.volume_24h / 1000000).toFixed(2)}M`}
          subtitle={`Total: $${(market.volume_total / 1000000).toFixed(1)}M`}
        />
        <MetricCard
          icon={<DollarSign className="h-5 w-5 text-[#00E0AA]" />}
          label="Liquidity"
          value={`$${(market.liquidity_usd / 1000).toFixed(0)}k`}
          subtitle={`Spread: ${market.spread_bps} bps`}
        />
        <MetricCard
          icon={<Info className="h-5 w-5 text-[#00E0AA]" />}
          label="Signal"
          value={getRecommendationBadge(market.signal_recommendation)}
          subtitle={`Edge: ${market.edge_bp} bp`}
        />
        <MetricCard
          icon={<Clock className="h-5 w-5 text-[#00E0AA]" />}
          label="Closes In"
          value={`${market.hours_to_close}h`}
          subtitle={new Date(market.end_date).toLocaleDateString()}
        />
      </div>

      {/* Market Sentiment Hero Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 border-[#00E0AA]/20 bg-gradient-to-br from-[#00E0AA]/5 to-transparent">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Market Sentiment</span>
          </div>
          <div className="flex items-baseline gap-3">
            <div className="text-2xl font-bold text-[#00E0AA]">
              YES {(market.current_price * 100).toFixed(0)}%
            </div>
            <div className="text-2xl font-bold text-amber-600">
              NO {((1 - market.current_price) * 100).toFixed(0)}%
            </div>
          </div>
          <div className="flex items-center gap-1 mt-2 text-xs text-[#00E0AA]">
            <TrendingUp className="h-3 w-3" />
            <span>+12% (24h)</span>
          </div>
        </Card>

        <Card className="p-5 border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Smart Money</span>
          </div>
          <div className="text-2xl font-bold">{smartMoneyYes.toFixed(0)}% YES</div>
          <p className="text-xs text-muted-foreground mt-2">
            High-WIS wallets favor YES
          </p>
        </Card>

        <Card className="p-5 border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Recent Momentum</span>
          </div>
          <div className="text-2xl font-bold text-[#00E0AA]">↑ +12%</div>
          <p className="text-xs text-muted-foreground mt-2">
            24h price • +85% volume
          </p>
        </Card>

        <Card className="p-5 border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">AI Signal</span>
          </div>
          <div className="mb-2">
            {getRecommendationBadge(market.signal_recommendation)}
          </div>
          <p className="text-xs text-muted-foreground">
            {(market.signal_confidence * 100).toFixed(0)}% confidence
          </p>
        </Card>
      </div>

      {/* Price Chart */}
      <Card className="p-6 border-border/50">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold tracking-tight">Price History</h2>
          <div className="flex gap-1 border rounded-lg p-1">
            {(["1h", "24h", "7d", "30d"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setPriceTimeframe(tf)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  priceTimeframe === tf
                    ? "bg-[#00E0AA] text-black"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Current Prices */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="border border-[#00E0AA]/30 rounded-lg p-4 bg-[#00E0AA]/5">
            <div className="text-xs font-semibold text-[#00E0AA] mb-2 uppercase tracking-wider">YES Price</div>
            <div className="text-3xl font-bold text-[#00E0AA]">
              {(market.current_price * 100).toFixed(1)}¢
            </div>
          </div>
          <div className="border border-amber-600/30 rounded-lg p-4 bg-amber-600/5">
            <div className="text-xs font-semibold text-amber-600 mb-2 uppercase tracking-wider">NO Price</div>
            <div className="text-3xl font-bold text-amber-600">
              {((1 - market.current_price) * 100).toFixed(1)}¢
            </div>
          </div>
        </div>

        <div className="h-[400px]">
          <ReactECharts
            option={priceChartOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
          />
        </div>
      </Card>

      {/* Position Analysis */}
      <Card className="p-6 border-border/50">
        <h2 className="text-xl font-semibold mb-6 tracking-tight">Position Analysis</h2>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="border border-[#00E0AA]/30 rounded-lg p-5 bg-[#00E0AA]/5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-2 w-2 rounded-full bg-[#00E0AA]"></div>
              <span className="text-sm font-semibold text-[#00E0AA] uppercase tracking-wider">YES Side</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>{yesSummary.holders_count} holders</span>
              </div>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-[#00E0AA] font-semibold">+${(yesSummary.profit_usd / 1000).toFixed(0)}k PnL</span>
              </div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <span>Avg Entry: {(yesSummary.realized_price * 100).toFixed(0)}¢</span>
              </div>
            </div>
          </div>

          <div className="border border-amber-600/30 rounded-lg p-5 bg-amber-600/5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-2 w-2 rounded-full bg-amber-600"></div>
              <span className="text-sm font-semibold text-amber-600 uppercase tracking-wider">NO Side</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>{noSummary.holders_count} holders</span>
              </div>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-red-500 font-semibold">${(noSummary.loss_usd / 1000).toFixed(0)}k PnL</span>
              </div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <span>Avg Entry: {(noSummary.realized_price * 100).toFixed(0)}¢</span>
              </div>
            </div>
          </div>
        </div>

        {/* Holders Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top YES Holders */}
          <div>
            <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[#00E0AA]"></div>
              Top YES Holders
            </h3>
            <TruncatedTable
              data={yesHolders}
              initialRows={3}
              renderHeader={() => (
                <TableHeader>
                  <TableRow>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>PnL</TableHead>
                    <TableHead>Score</TableHead>
                  </TableRow>
                </TableHeader>
              )}
              renderRow={(holder) => (
                <TableRow key={holder.wallet_address}>
                  <TableCell>
                    <Link href={`/analysis/wallet/${holder.wallet_address}`} className="text-[#00E0AA] hover:underline font-medium">
                      {holder.wallet_alias}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{holder.supply_pct.toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">${(holder.position_usd / 1000).toFixed(1)}k</div>
                  </TableCell>
                  <TableCell className={holder.pnl_total >= 0 ? 'text-[#00E0AA] font-semibold' : 'text-red-600 font-semibold'}>
                    {holder.pnl_total >= 0 ? '+' : ''}${(holder.pnl_total / 1000).toFixed(1)}k
                  </TableCell>
                  <TableCell>
                    <Badge variant={holder.smart_score >= 80 ? 'default' : 'secondary'} className={holder.smart_score >= 80 ? 'bg-[#00E0AA] text-black' : ''}>
                      {holder.smart_score}
                    </Badge>
                  </TableCell>
                </TableRow>
              )}
              expandText="Show All YES Holders"
            />
          </div>

          {/* Top NO Holders */}
          <div>
            <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-amber-600"></div>
              Top NO Holders
            </h3>
            <TruncatedTable
              data={noHolders}
              initialRows={3}
              renderHeader={() => (
                <TableHeader>
                  <TableRow>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>PnL</TableHead>
                    <TableHead>Score</TableHead>
                  </TableRow>
                </TableHeader>
              )}
              renderRow={(holder) => (
                <TableRow key={holder.wallet_address}>
                  <TableCell>
                    <Link href={`/analysis/wallet/${holder.wallet_address}`} className="text-[#00E0AA] hover:underline font-medium">
                      {holder.wallet_alias}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{holder.supply_pct.toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">${(holder.position_usd / 1000).toFixed(1)}k</div>
                  </TableCell>
                  <TableCell className={holder.pnl_total >= 0 ? 'text-[#00E0AA] font-semibold' : 'text-red-600 font-semibold'}>
                    {holder.pnl_total >= 0 ? '+' : ''}${(holder.pnl_total / 1000).toFixed(1)}k
                  </TableCell>
                  <TableCell>
                    <Badge variant={holder.smart_score >= 80 ? 'default' : 'secondary'} className={holder.smart_score >= 80 ? 'bg-[#00E0AA] text-black' : ''}>
                      {holder.smart_score}
                    </Badge>
                  </TableCell>
                </TableRow>
              )}
              expandText="Show All NO Holders"
            />
          </div>
        </div>
      </Card>

      {/* Whale Activity */}
      <CollapsibleSection
        title="Recent Whale Activity"
        defaultExpanded={false}
        showCount={whaleTrades.length}
        compactView={
          <div className="space-y-3">
            {whaleTrades.slice(0, 5).map((trade) => (
              <div key={trade.trade_id} className="flex items-center justify-between text-sm border-b border-border/50 pb-3">
                <div className="flex items-center gap-3">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  <Link href={`/analysis/wallet/${trade.wallet_address}`} className={`font-medium hover:underline ${trade.side === 'YES' ? 'text-[#00E0AA]' : 'text-amber-600'}`}>
                    {trade.wallet_alias}
                  </Link>
                  <Badge variant="outline" className="text-xs">WIS {trade.wis}</Badge>
                </div>
                <div className="text-right">
                  <div>
                    <span className="font-medium">{(trade.shares / 1000).toFixed(0)}k {trade.side}</span>
                    <span className="text-muted-foreground mx-1">@</span>
                    <span className="font-medium">{(trade.price * 100).toFixed(0)}¢</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {getTimeAgo(trade.timestamp)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>WIS</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Shares</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {whaleTrades.map((trade) => (
              <TableRow key={trade.trade_id}>
                <TableCell className="text-sm">{getTimeAgo(trade.timestamp)}</TableCell>
                <TableCell>
                  <Link
                    href={`/analysis/wallet/${trade.wallet_address}`}
                    className="font-medium text-[#00E0AA] hover:underline"
                  >
                    {trade.wallet_alias}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={trade.wis > 70 ? "default" : "secondary"} className={trade.wis > 70 ? 'bg-[#00E0AA] text-black' : ''}>
                    {trade.wis}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={trade.action === "BUY" ? "default" : "secondary"}>
                    {trade.action}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={trade.side === "YES" ? "bg-[#00E0AA] text-black" : "bg-amber-600"}>
                    {trade.side}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">{trade.shares.toLocaleString()}</TableCell>
                <TableCell className="font-semibold">${trade.amount_usd.toLocaleString()}</TableCell>
                <TableCell className="font-mono">{(trade.price * 100).toFixed(1)}¢</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleSection>

      {/* SII Trend + Signal Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SII Trend */}
        <Card className="p-6 border-border/50">
          <h2 className="text-lg font-semibold mb-6 tracking-tight">SII Trend (48 Hours)</h2>
          <div className="h-[280px]">
            <ReactECharts option={siiChartOption} style={{ height: '100%' }} opts={{ renderer: 'canvas' }} />
          </div>
        </Card>

        {/* Signal Breakdown */}
        <Card className="p-6 border-border/50">
          <h2 className="text-lg font-semibold mb-6 tracking-tight">Signal Breakdown</h2>
          <div className="space-y-5">
            <SignalComponent
              name="PSP Ensemble"
              weight={signalBreakdown.psp_weight}
              contribution={signalBreakdown.psp_contribution}
              confidence={signalBreakdown.psp_confidence}
            />
            <SignalComponent
              name="Crowd Wisdom"
              weight={signalBreakdown.crowd_weight}
              contribution={signalBreakdown.crowd_contribution}
              confidence={signalBreakdown.crowd_confidence}
            />
            <SignalComponent
              name="Momentum"
              weight={signalBreakdown.momentum_weight}
              contribution={signalBreakdown.momentum_contribution}
              confidence={signalBreakdown.momentum_confidence}
            />
            <SignalComponent
              name="Microstructure"
              weight={signalBreakdown.microstructure_weight}
              contribution={signalBreakdown.microstructure_contribution}
              confidence={signalBreakdown.microstructure_confidence}
            />
          </div>
        </Card>
      </div>

      {/* Order Book */}
      <CollapsibleSection
        title="Order Book"
        defaultExpanded={false}
        compactView={
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-sm font-semibold text-[#00E0AA] mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Top 5 Bids
              </div>
              <div className="space-y-2">
                {orderBook.bids.slice(0, 5).map((bid, i) => (
                  <div key={i} className="flex justify-between items-center text-sm">
                    <span className="font-mono font-semibold">{(bid.price * 100).toFixed(2)}¢</span>
                    <span className="text-muted-foreground font-mono">{bid.size.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold text-red-600 mb-3 flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                Top 5 Asks
              </div>
              <div className="space-y-2">
                {orderBook.asks.slice(0, 5).map((ask, i) => (
                  <div key={i} className="flex justify-between items-center text-sm">
                    <span className="font-mono font-semibold">{(ask.price * 100).toFixed(2)}¢</span>
                    <span className="text-muted-foreground font-mono">{ask.size.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        }
      >
        {/* Depth Chart */}
        <div className="mb-6">
          <h3 className="text-base font-semibold mb-4">Order Book Depth</h3>
          <div className="h-[320px]">
            <ReactECharts
              option={orderBookOption}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
            />
          </div>
        </div>

        {/* Order Book Tables */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-semibold mb-4 text-[#00E0AA] flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              All Bids
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Price</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderBook.bids.map((bid, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono font-semibold">{(bid.price * 100).toFixed(2)}¢</TableCell>
                    <TableCell className="font-mono">{bid.size.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground font-mono">{bid.total.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-4 text-red-600 flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              All Asks
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Price</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderBook.asks.map((ask, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono font-semibold">{(ask.price * 100).toFixed(2)}¢</TableCell>
                    <TableCell className="font-mono">{ask.size.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground font-mono">{ask.total.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CollapsibleSection>

      {/* OHLC Candlestick Chart */}
      <CollapsibleSection
        title="OHLC Candlestick Chart"
        defaultExpanded={false}
        compactView={
          <p className="text-sm text-muted-foreground">
            View detailed candlestick chart with 4-hour intervals over the past 7 days
          </p>
        }
      >
        <div className="h-[500px]">
          <ReactECharts
            option={{
              tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                borderColor: '#00E0AA',
                borderWidth: 1,
                textStyle: {
                  color: '#fff'
                }
              },
              grid: {
                left: "3%",
                right: "4%",
                bottom: "3%",
                top: "8%",
                containLabel: true,
              },
              xAxis: {
                type: 'category',
                data: ohlcData.map((d) => new Date(d.timestamp).toLocaleString()),
                axisLabel: {
                  formatter: (value: string) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
                  },
                  color: '#888'
                },
                axisLine: {
                  lineStyle: {
                    color: '#333'
                  }
                }
              },
              yAxis: {
                type: 'value',
                name: 'Price',
                nameTextStyle: {
                  color: '#888',
                  fontSize: 12
                },
                axisLabel: {
                  formatter: (value: number) => `${(value * 100).toFixed(0)}¢`,
                  color: '#888'
                },
                splitLine: {
                  lineStyle: {
                    color: '#222',
                    opacity: 0.3
                  }
                }
              },
              series: [
                {
                  type: 'candlestick',
                  data: ohlcData.map((d) => [d.open, d.close, d.low, d.high]),
                  itemStyle: {
                    color: '#00E0AA',
                    color0: '#ef4444',
                    borderColor: '#00E0AA',
                    borderColor0: '#ef4444',
                  },
                },
              ],
            }}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      </CollapsibleSection>

      {/* Market Information */}
      <Card className="p-6 border-border/50">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 tracking-tight">
          <Info className="h-5 w-5 text-[#00E0AA]" />
          Market Information
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Key Stats */}
          <div className="space-y-4">
            <InfoRow
              icon={<Calendar className="h-4 w-4" />}
              label="Start Date"
              value={new Date(marketData.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            />
            <InfoRow
              icon={<Clock className="h-4 w-4" />}
              label="End Date"
              value={new Date(market.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            />
            <InfoRow
              icon={<DollarSign className="h-4 w-4" />}
              label="Liquidity"
              value={`$${(market.liquidity_usd / 1000).toFixed(1)}k`}
            />
            <InfoRow
              icon={<TrendingUp className="h-4 w-4" />}
              label="24h Volume"
              value={`$${(market.volume_24h / 1000).toFixed(1)}k`}
            />
            <InfoRow
              icon={<Users className="h-4 w-4" />}
              label="Traders"
              value={marketData.tradersCount.toLocaleString()}
            />

            <Separator className="my-4" />

            <Button variant="outline" className="w-full gap-2" asChild>
              <a href={marketData.polymarketUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                View on Polymarket
              </a>
            </Button>
          </div>

          {/* Right Column - Rules */}
          <div>
            <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Resolution Rules</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {marketData.rules}
            </p>
          </div>
        </div>
      </Card>

      {/* Related Markets */}
      <Card className="p-6 border-border/50">
        <h2 className="text-lg font-semibold mb-6 tracking-tight">Related Markets</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {relatedMarkets.map((rm) => (
            <Link
              key={rm.market_id}
              href={`/analysis/market/${rm.market_id}`}
              className="group border border-border/50 rounded-lg p-5 hover:border-[#00E0AA]/50 hover:bg-[#00E0AA]/5 transition-all cursor-pointer"
            >
              <h3 className="font-medium text-sm mb-4 line-clamp-2 group-hover:text-[#00E0AA] transition-colors">{rm.title}</h3>
              <div className="flex gap-2 mb-4">
                {rm.outcome_chips.map((chip) => (
                  <Badge
                    key={chip.side}
                    className={chip.side === "YES" ? "bg-[#00E0AA] text-black" : "bg-amber-600"}
                  >
                    {chip.side} {(chip.price * 100).toFixed(0)}¢
                  </Badge>
                ))}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Vol: ${(rm.volume_24h / 1000).toFixed(0)}k</span>
                <span>Liq: ${(rm.liquidity / 1000).toFixed(0)}k</span>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

// Helper Components

function MetricCard({
  icon,
  label,
  value,
  subtitle,
  change,
  changeType,
  valueClassName = "",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | React.ReactNode;
  subtitle?: string;
  change?: string;
  changeType?: "positive" | "negative";
  valueClassName?: string;
}) {
  return (
    <Card className="p-4 border-border/50 hover:border-[#00E0AA]/30 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl font-bold mb-1 ${valueClassName}`}>
        {value}
      </div>
      {change && (
        <div className={`flex items-center gap-1 text-xs ${changeType === 'positive' ? 'text-[#00E0AA]' : 'text-red-500'}`}>
          {changeType === 'positive' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span>{change}</span>
        </div>
      )}
      {subtitle && !change && (
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      )}
    </Card>
  );
}

function SignalComponent({
  name,
  weight,
  contribution,
  confidence,
}: {
  name: string;
  weight: number;
  contribution: number;
  confidence: number;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground font-mono">{(weight * 100).toFixed(0)}% weight</span>
      </div>
      <div className="flex gap-3 items-center">
        <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#00E0AA] to-[#00E0AA]/70 transition-all duration-500"
            style={{ width: `${contribution * 100}%` }}
          />
        </div>
        <span className="text-xs font-semibold font-mono min-w-[3rem] text-right">{(confidence * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-muted-foreground">{icon}</div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-sm font-semibold mt-0.5">{value}</p>
      </div>
    </div>
  );
}
