"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, Clock, DollarSign, ExternalLink, Users, Calendar, Info } from "lucide-react";
import ReactECharts from "echarts-for-react";
import { generateMarketDetail, generatePriceHistory } from "@/lib/generate-market-detail";
import Link from "next/link";

// Mock event data
const mockEvent = {
  event_id: "event-1",
  event_slug: "2024-presidential-election",
  title: "2024 Presidential Election",
  description: "Who will win the 2024 United States Presidential Election?",
  category: "Politics",
  totalVolume: 125000000,
  volume24h: 8500000,
  totalLiquidity: 12500000,
  marketCount: 8,
  tradersCount: 45678,
  startDate: "2023-01-15T00:00:00Z",
  endDate: "2024-11-05T00:00:00Z",
  polymarketUrl: "https://polymarket.com/event/2024-presidential-election",
  rules: "This event resolves to YES for the candidate who wins the 2024 United States Presidential Election, as determined by the official certification of electoral college votes. The market will resolve once the election results are certified by Congress in January 2025. In the event of a disputed election, resolution will be based on the candidate who is ultimately inaugurated as President on January 20, 2025.",
};

// Generate mock markets for this event
const marketTitles = [
  "Will Donald Trump win the 2024 Presidential Election?",
  "Will Joe Biden win the 2024 Presidential Election?",
  "Will a Republican win the 2024 Presidential Election?",
  "Will a Democrat win the 2024 Presidential Election?",
  "Will Donald Trump be the Republican nominee?",
  "Will Joe Biden be the Democratic nominee?",
  "Will voter turnout exceed 65%?",
  "Will there be a disputed election result?",
];

const mockMarkets = marketTitles.map((title, index) => ({
  ...generateMarketDetail('Politics'),
  market_id: `event-market-${index + 1}`,
  title,
}));

interface EventDetailProps {
  eventSlug: string;
}

export function EventDetail({ eventSlug }: EventDetailProps) {
  const [selectedMarket, setSelectedMarket] = useState(mockMarkets[0]);
  const priceHistory = generatePriceHistory(selectedMarket.current_price, 168);

  // Price chart for selected market
  const priceChartOption = {
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
        lineStyle: {
          color: "#00E0AA",
          opacity: 0.3
        }
      },
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      borderColor: "#00E0AA",
      borderWidth: 1,
      textStyle: {
        color: "#fff"
      },
      formatter: (params: any) => {
        if (!params || !params[0]) return '';
        return `${new Date(params[0].name).toLocaleDateString()}<br/>
                YES: <strong>${(params[0].value * 100).toFixed(1)}¢</strong><br/>
                NO: <strong>${((1 - params[0].value) * 100).toFixed(1)}¢</strong>`;
      },
    },
    legend: {
      data: ["YES Price", "NO Price"],
      top: 0,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "15%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: priceHistory.map((p) => p.timestamp),
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        },
      },
    },
    yAxis: {
      type: "value",
      name: "Price",
      axisLabel: {
        formatter: (value: number) => `${(value * 100).toFixed(0)}¢`,
      },
      min: 0,
      max: 1,
    },
    series: [
      {
        name: "YES Price",
        type: "line",
        smooth: true,
        symbol: 'none',
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
        emphasis: {
          focus: 'series',
          lineStyle: {
            width: 4
          }
        },
        animation: true,
        animationDuration: 1000,
        animationEasing: 'cubicOut'
      },
      {
        name: "NO Price",
        type: "line",
        smooth: true,
        symbol: 'none',
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
        emphasis: {
          focus: 'series',
          lineStyle: {
            width: 4
          }
        },
        animation: true,
        animationDuration: 1000,
        animationEasing: 'cubicOut'
      },
    ],
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto p-6">
      {/* Event Header */}
      <div className="border rounded-lg p-6 bg-gradient-to-r from-[#00E0AA]/5 to-transparent border-border/50">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">{mockEvent.title}</h1>
            <p className="text-muted-foreground">{mockEvent.description}</p>
          </div>
          <Badge className="text-lg px-4 py-2">{mockEvent.category}</Badge>
        </div>

        {/* Event Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-[#00E0AA]" />
            <div>
              <p className="text-xs text-muted-foreground">Total Volume</p>
              <p className="text-lg font-bold">${(mockEvent.totalVolume / 1000000).toFixed(1)}M</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#00E0AA]" />
            <div>
              <p className="text-xs text-muted-foreground">Markets</p>
              <p className="text-lg font-bold">{mockEvent.marketCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-[#00E0AA]" />
            <div>
              <p className="text-xs text-muted-foreground">Liquidity</p>
              <p className="text-lg font-bold">${(mockEvent.totalLiquidity / 1000000).toFixed(1)}M</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            <div>
              <p className="text-xs text-muted-foreground">Closes</p>
              <p className="text-lg font-bold">{new Date(mockEvent.endDate).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content: 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Market List */}
        <Card className="lg:col-span-3 p-4 h-fit">
          <h2 className="text-xl font-semibold tracking-tight mb-4">Markets ({mockMarkets.length})</h2>
          <div className="space-y-2">
            {mockMarkets.map((market) => (
              <div
                key={market.market_id}
                className={`relative w-full p-3 rounded-lg border transition-all ${
                  selectedMarket.market_id === market.market_id
                    ? "border-[#00E0AA] bg-[#00E0AA]/10"
                    : "border-border hover:border-[#00E0AA]/50"
                }`}
              >
                <button
                  onClick={() => setSelectedMarket(market)}
                  className="w-full text-left pr-8"
                >
                  <p className="text-sm font-medium line-clamp-2 mb-2">{market.title}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#00E0AA] font-semibold">
                      YES {(market.current_price * 100).toFixed(1)}¢
                    </span>
                    <span className="text-amber-600 font-semibold">
                      NO {((1 - market.current_price) * 100).toFixed(1)}¢
                    </span>
                  </div>
                </button>
                {/* Icon button in top-right corner */}
                <Link
                  href={`/analysis/market/${market.market_id}`}
                  className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-accent transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </Link>
              </div>
            ))}
          </div>
        </Card>

        {/* Center: Market Insight (Chart + Details) */}
        <div className="lg:col-span-6 space-y-4">
          {/* Selected Market Info */}
          <Card className="p-6">
            <h2 className="text-2xl font-semibold tracking-tight mb-4">{selectedMarket.title}</h2>

            {/* Current Prices */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="border rounded-lg p-4 bg-[#00E0AA]/5">
                <div className="text-xs font-semibold text-[#00E0AA]  mb-1">
                  CURRENT YES PRICE
                </div>
                <div className="text-3xl font-bold text-[#00E0AA]">
                  {(selectedMarket.current_price * 100).toFixed(1)}¢
                </div>
              </div>
              <div className="border rounded-lg p-4 bg-amber-50 dark:bg-amber-950/20">
                <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">
                  CURRENT NO PRICE
                </div>
                <div className="text-3xl font-bold text-amber-700 dark:text-amber-300">
                  {((1 - selectedMarket.current_price) * 100).toFixed(1)}¢
                </div>
              </div>
            </div>

            {/* Price Chart */}
            <div className="h-[400px]">
              <ReactECharts
                option={priceChartOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
                notMerge={true}
                lazyUpdate={false}
              />
            </div>
          </Card>

          {/* Market Metrics */}
          <Card className="p-6">
            <h3 className="text-xl font-semibold tracking-tight mb-4">Market Metrics</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">24h Volume</p>
                <p className="text-xl font-bold">${(selectedMarket.volume_24h / 1000).toFixed(1)}k</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Volume</p>
                <p className="text-xl font-bold">${(selectedMarket.volume_total / 1000000).toFixed(2)}M</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Liquidity</p>
                <p className="text-xl font-bold">${(selectedMarket.liquidity_usd / 1000).toFixed(1)}k</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">SII Score</p>
                <p className={`text-xl font-bold ${selectedMarket.sii > 50 ? 'text-[#00E0AA]' : 'text-red-600'}`}>
                  {selectedMarket.sii}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Spread</p>
                <p className="text-xl font-bold">{selectedMarket.spread_bps} bps</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Closes In</p>
                <p className="text-xl font-bold">{selectedMarket.hours_to_close}h</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Right: Event Information */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="p-4">
            <h2 className="text-xl font-semibold tracking-tight mb-4 flex items-center gap-2">
              <Info className="h-5 w-5" />
              Event Information
            </h2>

            {/* Key Stats */}
            <div className="space-y-4 mb-6">
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Start Date</p>
                  <p className="text-sm font-semibold">{new Date(mockEvent.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">End Date</p>
                  <p className="text-sm font-semibold">{new Date(mockEvent.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Liquidity</p>
                  <p className="text-sm font-semibold">${(mockEvent.totalLiquidity / 1000000).toFixed(2)}M</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">24h Volume</p>
                  <p className="text-sm font-semibold">${(mockEvent.volume24h / 1000000).toFixed(2)}M</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Users className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Traders</p>
                  <p className="text-sm font-semibold">{mockEvent.tradersCount.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Polymarket Link */}
            <Button variant="outline" className="w-full gap-2" asChild>
              <a href={mockEvent.polymarketUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                View on Polymarket
              </a>
            </Button>
          </Card>

          {/* Rules Card */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Rules</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {mockEvent.rules}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
