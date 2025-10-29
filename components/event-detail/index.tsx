"use client";

import { useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, Clock, DollarSign, ExternalLink, Calendar, Info } from "lucide-react";
import ReactECharts from "echarts-for-react";
// Mock data generator removed - we only use real data now
import Link from "next/link";
import { usePolymarketEventDetail } from "@/hooks/use-polymarket-event-detail";
import { useMarketOHLC } from "@/hooks/use-market-ohlc";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

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
  market_id: `event-market-${index + 1}`,
  title,
  category: 'Politics',
  current_price: 0.5 + (Math.random() * 0.4 - 0.2),
  volume_24h: Math.floor(Math.random() * 1000000),
  volume_total: Math.floor(Math.random() * 10000000),
  liquidity_usd: Math.floor(Math.random() * 500000),
  hours_to_close: 720,
  active: true,
  closed: false,
  outcomes: ['Yes', 'No'],
  outcomePrices: ['0.5', '0.5'],
  clobTokenId: '', // Added for type compatibility
}));

interface EventDetailProps {
  eventSlug: string;
}

export function EventDetail({ eventSlug }: EventDetailProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // Fetch real event data from API
  const { event, isLoading, error } = usePolymarketEventDetail(eventSlug);

  // Transform real markets or use mock as fallback
  const markets = useMemo(() => {
    if (event?.markets && event.markets.length > 0) {
      return event.markets
        .map((market: any) => {
          // Parse JSON string fields
          const outcomePrices = typeof market.outcomePrices === 'string'
            ? JSON.parse(market.outcomePrices)
            : (market.outcomePrices || ['0.5', '0.5']);

          const outcomes = typeof market.outcomes === 'string'
            ? JSON.parse(market.outcomes)
            : (market.outcomes || ['Yes', 'No']);

          // Parse clobTokenIds (might be JSON string)
          let clobTokenIds: string[] = [];
          if (market.clobTokenIds) {
            if (typeof market.clobTokenIds === 'string') {
              try {
                clobTokenIds = JSON.parse(market.clobTokenIds);
              } catch {
                clobTokenIds = [];
              }
            } else if (Array.isArray(market.clobTokenIds)) {
              clobTokenIds = market.clobTokenIds;
            }
          }

          const yesPrice = parseFloat(outcomePrices[0] || '0.5');

          return {
            market_id: market.id,
            title: market.question,
            category: event.category || 'Other',
            current_price: yesPrice,
            volume_24h: parseFloat(market.volume24hr || '0'),
            volume_total: parseFloat(market.volume || '0'),
            liquidity_usd: parseFloat(market.liquidity || '0'),
            hours_to_close: Math.floor((new Date(market.endDate).getTime() - Date.now()) / 3600000),
            active: market.active,
            closed: market.closed,
            outcomes,
            outcomePrices,
            clobTokenId: clobTokenIds[0] || '', // YES token for OHLC
          };
        })
        .filter((market) => {
          // Filter out uninitiated placeholder markets (50/50 with no volume)
          // These are markets like "Person A", "Person B", etc. that Polymarket creates but doesn't activate
          const isUninitiated = Math.abs(market.current_price - 0.5) < 0.01 && market.volume_total < 100;
          return !isUninitiated;
        })
        .sort((a, b) => {
          // Sort by closed status first (active markets first)
          if (a.closed !== b.closed) {
            return a.closed ? 1 : -1;
          }
          // Then sort by YES price descending (highest probability first)
          return b.current_price - a.current_price;
        });
    }
    return mockMarkets;
  }, [event]);

  const [selectedMarket, setSelectedMarket] = useState(markets[0]);
  const [chartTimeRange, setChartTimeRange] = useState<'1d' | '5d' | '1w' | '1m' | 'all'>('1w');

  // Update selected market when markets change
  useEffect(() => {
    if (markets.length > 0 && (!selectedMarket || !markets.find(m => m.market_id === selectedMarket.market_id))) {
      setSelectedMarket(markets[0]);
    }
  }, [markets, selectedMarket]);

  // Calculate startTs based on selected time range
  const { startTs, endTs } = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);

    if (chartTimeRange === 'all') {
      return { startTs: undefined, endTs: undefined };
    }

    const ranges = {
      '1d': 24 * 60 * 60,
      '5d': 5 * 24 * 60 * 60,
      '1w': 7 * 24 * 60 * 60,
      '1m': 30 * 24 * 60 * 60,
    };

    return {
      startTs: now - ranges[chartTimeRange],
      endTs: now,
    };
  }, [chartTimeRange]);

  // Fetch real OHLC data for selected market
  const { data: ohlcRawData } = useMarketOHLC({
    marketId: selectedMarket?.clobTokenId || '',
    startTs,
    endTs,
  });

  // Use real OHLC data if available, otherwise fallback to generated
  // Note: Polymarket CLOB API has sparse historical data, so we need sufficient points for a good chart
  const priceHistory = useMemo(() => {
    const minDataPoints = 10; // Need at least 10 points for a meaningful chart

    if (ohlcRawData && ohlcRawData.length >= minDataPoints) {
      // Sufficient real data - use it!
      return ohlcRawData.map(point => ({
        timestamp: new Date(point.t * 1000).toISOString(),
        price: point.c || selectedMarket?.current_price || 0.5,
      }));
    }

    // Insufficient data from Polymarket API - return null
    return null;
  }, [ohlcRawData, selectedMarket]);

  // Use real event data if available, otherwise fallback to mock
  const eventData = event ? {
    event_id: event.id,
    event_slug: event.slug,
    title: event.title,
    description: event.description || '',
    category: event.category || 'Other',
    // Sum up volumes and liquidity from filtered markets for accuracy
    totalVolume: markets.reduce((sum, m) => sum + m.volume_total, 0),
    volume24h: markets.reduce((sum, m) => sum + m.volume_24h, 0),
    totalLiquidity: markets.reduce((sum, m) => sum + m.liquidity_usd, 0),
    marketCount: markets.length, // Use filtered markets count (excludes uninitiated 50/50 placeholders)
    tradersCount: 0, // Not available from API
    startDate: event.startDate || event.createdAt || '',
    endDate: event.endDate || '',
    polymarketUrl: `https://polymarket.com/event/${event.slug}`,
    rules: event.description || '',
  } : mockEvent;

  // Price chart for selected market - only if we have data
  const priceChartOption = priceHistory ? {
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
        lineStyle: { width: 3, color: "#00B512" },
        itemStyle: { color: "#00B512" },
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
        lineStyle: { width: 3, color: "#ef4444" },
        itemStyle: { color: "#ef4444" },
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
  } : null;

  // Loading state
  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="px-6 pt-5 pb-3">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
        </div>
        <div className="text-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-muted-foreground mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading event details...</p>
        </div>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="px-6 pt-5 pb-3">
          <h1 className="text-2xl font-semibold tracking-tight mb-2 text-rose-600">Event Not Available</h1>
          <p className="text-muted-foreground mb-6">{error.message}</p>
          <Link href="/events">
            <Button variant="outline">
              Browse Active Events
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      {/* Event Header */}
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <Badge variant="outline" className="border-border/50">{eventData.category}</Badge>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mb-2">{eventData.title}</h1>
            <p className="text-sm text-muted-foreground">{eventData.description}</p>
          </div>
        </div>

        {/* Event Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Total Volume</p>
              <p className="text-lg font-bold">${(eventData.totalVolume / 1000000).toFixed(1)}M</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Markets</p>
              <p className="text-lg font-bold">{eventData.marketCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Liquidity</p>
              <p className="text-lg font-bold">${(eventData.totalLiquidity / 1000000).toFixed(1)}M</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Closes</p>
              <p className="text-lg font-bold">{new Date(eventData.endDate).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content: 3-Column Layout */}
      <div className="px-6 pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Market List */}
          <div className="lg:col-span-3">
            <div className="rounded-lg border border-border/50 bg-muted/10 p-4 h-fit">
              <h2 className="text-xl font-semibold tracking-tight mb-4">Markets ({markets.length})</h2>
              <div className="space-y-2">
                {markets.map((market) => (
                  <div
                    key={market.market_id}
                    className={cn(
                      "relative w-full p-3 rounded-lg border transition-all",
                      selectedMarket.market_id === market.market_id
                        ? "border-border bg-muted"
                        : "border-border/50 hover:border-border",
                      market.closed && "opacity-50 bg-muted/30"
                    )}
                  >
                    <button
                      onClick={() => setSelectedMarket(market)}
                      className="w-full text-left pr-8"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-sm font-medium line-clamp-2 flex-1">{market.title}</p>
                        {market.closed && (
                          <Badge variant="secondary" className="text-xs shrink-0">Closed</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground font-semibold">
                          YES {(market.current_price * 100).toFixed(1)}¢
                        </span>
                        <span className="text-muted-foreground font-semibold">
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
            </div>
          </div>

          {/* Center: Market Insight (Chart + Details) */}
          <div className="lg:col-span-6 space-y-4">
            {/* Selected Market Info */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-6">
              <h2 className="text-2xl font-semibold tracking-tight mb-4">{selectedMarket.title}</h2>

              {/* Current Prices */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="border border-border/50 rounded-lg p-4 bg-muted/20">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">
                    CURRENT YES PRICE
                  </div>
                  <div className="text-3xl font-bold text-foreground">
                    {(selectedMarket.current_price * 100).toFixed(1)}¢
                  </div>
                </div>
                <div className="border border-border/50 rounded-lg p-4 bg-muted/20">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">
                    CURRENT NO PRICE
                  </div>
                  <div className="text-3xl font-bold text-foreground">
                    {((1 - selectedMarket.current_price) * 100).toFixed(1)}¢
                  </div>
                </div>
              </div>

              {/* Time Range Selector */}
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Price History</h3>
                <div className="flex gap-1">
                  {(['1d', '5d', '1w', '1m', 'all'] as const).map((range) => (
                    <button
                      key={range}
                      onClick={() => setChartTimeRange(range)}
                      className={cn(
                        "px-3 py-1 text-xs font-medium rounded transition-colors",
                        chartTimeRange === range
                          ? 'bg-muted text-foreground'
                          : 'bg-muted/50 hover:bg-muted text-muted-foreground'
                      )}
                    >
                      {range.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Chart */}
              <div className="h-[400px]">
                {priceChartOption ? (
                  <ReactECharts
                    option={priceChartOption}
                    style={{ height: "100%", width: "100%" }}
                    opts={{ renderer: "canvas" }}
                    notMerge={true}
                    lazyUpdate={false}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">Price history not available</p>
                      <p className="text-xs text-muted-foreground mt-2">Historical price data could not be loaded</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Market Metrics */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-6">
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
                  <p className="text-sm text-muted-foreground">Closes In</p>
                  <p className="text-xl font-bold">{selectedMarket.hours_to_close}h</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Event Information */}
          <div className="lg:col-span-3 space-y-4">
            <div className="rounded-lg border border-border/50 bg-muted/10 p-4">
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
                    <p className="text-sm font-semibold">{new Date(eventData.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">End Date</p>
                    <p className="text-sm font-semibold">{new Date(eventData.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Liquidity</p>
                    <p className="text-sm font-semibold">${(eventData.totalLiquidity / 1000000).toFixed(2)}M</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">24h Volume</p>
                    <p className="text-sm font-semibold">${(eventData.volume24h / 1000000).toFixed(2)}M</p>
                  </div>
                </div>
              </div>

              {/* Polymarket Link */}
              <Button variant="outline" className="w-full gap-2" asChild>
                <a href={eventData.polymarketUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  View on Polymarket
                </a>
              </Button>
            </div>

            {/* Rules Card */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-4">
              <h3 className="text-sm font-semibold mb-3">Rules</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {eventData.rules}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
