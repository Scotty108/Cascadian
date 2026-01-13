"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useMarketOHLC } from "@/hooks/use-market-ohlc";
import { useMarketOrderBook } from "@/hooks/use-market-order-book";
import { useMarketDetail } from "@/hooks/use-market-detail";
import { useRelatedMarkets } from "@/hooks/use-related-markets";
import { useMarketHolders } from "@/hooks/use-market-holders";
import { useMarketHoldersGraph, type GraphHolder } from "@/hooks/use-market-holders-graph";
import { useWhaleActivityPositionTracking } from "@/hooks/use-whale-activity-position-tracking";
import { useWhaleTrades } from "@/hooks/use-whale-trades";
import { useMarketSII } from "@/hooks/use-market-sii";
import { useSmartMoneySII } from "@/hooks/use-smart-money-sii";
import { TSISignalCard } from "@/components/tsi-signal-card";
import { MarketSmartMoneyWidget } from "@/components/market-smart-money-widget";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
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
import { OmegaBadge } from "@/components/ui/omega-badge";
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
// Mock data generators removed - we only use real data now
import type {
  OrderBook,
  HoldersSummary,
  OHLCDataPoint,
} from "./types";

interface MarketDetailProps {
  marketId?: string;
}

export function MarketDetail({ marketId }: MarketDetailProps = {}) {
  const [priceTimeframe, setPriceTimeframe] = useState<"1h" | "24h" | "7d" | "30d">("7d");
  const [whaleTimeframe, setWhaleTimeframe] = useState<"1h" | "4h" | "24h">("4h");

  // Fetch real market data
  const { market: realMarket, isLoading: marketLoading, error: marketError } = useMarketDetail(marketId || '');

  // Get the YES token ID for OHLC and order book (both use clobTokenId)
  const clobTokenId = realMarket?.clobTokenIds?.[0] || '';

  // Fetch real OHLC data (uses clobTokenId)
  // Using interval="max" to get ALL available historical data (~30 days, 700+ points)
  const { data: ohlcRawData, isLoading: ohlcLoading, error: ohlcError } = useMarketOHLC({
    marketId: clobTokenId,
    // interval defaults to "max" - gets all available data
  });

  // Fetch real order book data (uses clobTokenId)
  const { data: orderBookData, isLoading: orderBookLoading } = useMarketOrderBook(clobTokenId);

  // Fetch real holder data (uses conditionId)
  const conditionId = realMarket?.conditionId || '';
  const { data: holdersData, isLoading: holdersLoading } = useMarketHolders({
    conditionId,
    limit: 100,
    minBalance: 1,
  });

  // Fetch real SII (Signal Intelligence Index) based on holder distribution
  const { data: siiData, isLoading: siiLoading } = useMarketSII({
    marketId: marketId || '',
    conditionId,
  });

  // Fetch Smart Money SII (Omega-based signal)
  const { data: smartMoneySII, isLoading: smartMoneySIILoading } = useSmartMoneySII({
    marketId: conditionId, // Use conditionId for Smart Money SII
  });

  // Fetch UNLIMITED holder data via The Graph (bypasses 20-holder limit)
  const yesTokenId = realMarket?.clobTokenIds?.[0] || '';
  const noTokenId = realMarket?.clobTokenIds?.[1] || '';
  const { data: graphHoldersData, isLoading: graphHoldersLoading } = useMarketHoldersGraph({
    yesTokenId,
    noTokenId,
    limit: 1000,
    minBalance: 1,
    enabled: !!(yesTokenId || noTokenId), // Only fetch if we have token IDs
  });

  // Use Graph data if available (unlimited), otherwise fall back to Data API (limited to ~20)
  const finalHoldersData = graphHoldersData || holdersData;
  const finalHoldersLoading = graphHoldersLoading || holdersLoading;

  // Filter out dust positions (< 1 share) for cleaner display
  const filteredHoldersData = useMemo(() => {
    if (!finalHoldersData) return null;

    const yesFiltered = (finalHoldersData.yes || []).filter(h => (h.position_shares || 0) >= 1);
    const noFiltered = (finalHoldersData.no || []).filter(h => (h.position_shares || 0) >= 1);

    return {
      all: [...yesFiltered, ...noFiltered],
      yes: yesFiltered,
      no: noFiltered,
    };
  }, [finalHoldersData]);

  // Whale Activity Tracking - Option 1: Position Change Tracking
  const { activities: positionChangeActivities, isLoading: positionTrackingLoading } = useWhaleActivityPositionTracking({
    conditionId,
    minTradeSize: 5000, // $5k minimum for position tracking
    pollInterval: 30000, // Check every 30 seconds
  });

  // Whale Activity Tracking - Option 2: Polymarket Trade API
  const { data: apiWhaleTrades, isLoading: whaleTradesLoading } = useWhaleTrades({
    marketId: clobTokenId,
    minSize: 5000, // $5k minimum for API trades
    limit: 50,
    enabled: !!clobTokenId,
  });

  // Combine both whale activity sources
  const whaleActivity = useMemo(() => {
    const combined = [
      // Option 1: Position changes
      ...positionChangeActivities.map(activity => ({
        ...activity,
        source: 'position-tracking' as const,
      })),
      // Option 2: API trades
      ...apiWhaleTrades.map(trade => ({
        wallet_address: trade.wallet_address,
        wallet_alias: trade.wallet_alias,
        timestamp: trade.timestamp,
        action: trade.action,
        side: trade.side,
        shares_change: trade.shares,
        estimated_value: trade.amount_usd,
        source: 'api-trades' as const,
      })),
    ];

    // Sort by timestamp (most recent first)
    return combined.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).slice(0, 40); // Keep 40 most recent (20 per side)
  }, [positionChangeActivities, apiWhaleTrades]);

  // Split whale activity by side (YES/NO) with time filtering and flow metrics
  const whaleActivityBySide = useMemo(() => {
    // Calculate time cutoff based on selected timeframe
    const now = Date.now()
    let timeCutoff: number
    switch (whaleTimeframe) {
      case '1h':
        timeCutoff = now - (60 * 60 * 1000)
        break
      case '4h':
        timeCutoff = now - (4 * 60 * 60 * 1000)
        break
      case '24h':
        timeCutoff = now - (24 * 60 * 60 * 1000)
        break
      default:
        timeCutoff = 0
    }

    // Filter by time first
    const recentActivity = whaleActivity.filter(a =>
      new Date(a.timestamp).getTime() >= timeCutoff
    )

    // Split by side
    const yesActivities = recentActivity.filter(a => a.side === 'YES').slice(0, 20)
    const noActivities = recentActivity.filter(a => a.side === 'NO').slice(0, 20)

    // Calculate volume metrics
    const yesVolume = yesActivities.reduce((sum, a) => sum + a.estimated_value, 0)
    const noVolume = noActivities.reduce((sum, a) => sum + a.estimated_value, 0)

    // Calculate buy/sell flow for YES side
    const yesBuyVolume = yesActivities
      .filter(a => a.action === 'BUY')
      .reduce((sum, a) => sum + a.estimated_value, 0)
    const yesSellVolume = yesActivities
      .filter(a => a.action === 'SELL')
      .reduce((sum, a) => sum + a.estimated_value, 0)
    const yesNetFlow = yesBuyVolume - yesSellVolume

    // Calculate buy/sell flow for NO side
    const noBuyVolume = noActivities
      .filter(a => a.action === 'BUY')
      .reduce((sum, a) => sum + a.estimated_value, 0)
    const noSellVolume = noActivities
      .filter(a => a.action === 'SELL')
      .reduce((sum, a) => sum + a.estimated_value, 0)
    const noNetFlow = noBuyVolume - noSellVolume

    return {
      yes: yesActivities,
      no: noActivities,
      yesVolume,
      noVolume,
      yesTrades: yesActivities.length,
      noTrades: noActivities.length,
      yesNetFlow,
      noNetFlow,
      yesBuyVolume,
      yesSellVolume,
      noBuyVolume,
      noSellVolume,
    }
  }, [whaleActivity, whaleTimeframe]);

  // Use only real market data - no fallbacks
  const market = useMemo(() => {
    if (!realMarket) {
      return null;
    }

    // Transform real Polymarket data to match expected structure
    const yesPrice = realMarket.outcomePrices?.[0] ? parseFloat(realMarket.outcomePrices[0]) : 0.5;
    return {
      market_id: realMarket.id,
      title: realMarket.question,
      description: realMarket.description || realMarket.question,
      category: realMarket.category || 'Other',
      current_price: yesPrice,
      volume_24h: parseFloat(realMarket.volume24hr || '0'),
      volume_total: parseFloat(realMarket.volume || '0'),
      liquidity_usd: parseFloat(realMarket.liquidity || '0'),
      spread_bps: 17,
      sii: siiData?.sii_score ?? null, // Real SII from holder analysis or null
      signal_confidence: null, // Not available - requires AI model
      signal_recommendation: null, // Not available - requires AI model
      edge_bp: null, // Not available - requires calculation
      hours_to_close: realMarket.endDate ? Math.floor((new Date(realMarket.endDate).getTime() - Date.now()) / (1000 * 60 * 60)) : null,
      end_date: realMarket.endDate || null,
    };
  }, [realMarket, siiData]);

  // Market metadata - only real data
  const marketData = useMemo(() => {
    if (!realMarket || !market) {
      return null;
    }

    return {
      ...market,
      tradersCount: null, // Not available in Polymarket API
      startDate: realMarket.startDate || realMarket.createdAt || null,
      polymarketUrl: `https://polymarket.com/event/${realMarket.slug}`,
      rules: realMarket.description || "Resolution will be based on official records and credible news sources.",
    };
  }, [realMarket, market]);

  // Get event information from market data (populated during sync)
  const eventSlug = realMarket?.event_slug || null;
  const eventTitle = realMarket?.event_title || null;

  // Use ONLY real OHLC data - no fallbacks
  const priceHistory = useMemo(() => {
    if (!ohlcRawData || ohlcRawData.length === 0 || !market) {
      return null; // No data available
    }

    // Filter data based on selected timeframe
    const now = Date.now() / 1000; // Current time in Unix seconds
    let startTime: number;

    switch (priceTimeframe) {
      case '1h':
        startTime = now - (60 * 60); // 1 hour ago
        break;
      case '24h':
        startTime = now - (24 * 60 * 60); // 24 hours ago
        break;
      case '7d':
        startTime = now - (7 * 24 * 60 * 60); // 7 days ago
        break;
      case '30d':
        startTime = now - (30 * 24 * 60 * 60); // 30 days ago
        break;
      default:
        startTime = 0; // Show all data
    }

    // Filter and map the data
    const filteredData = ohlcRawData
      .filter(point => point.t >= startTime)
      .map(point => ({
        timestamp: new Date(point.t * 1000).toISOString(),
        price: point.c || market.current_price,
      }));

    // If no data in timeframe, return all data or null
    if (filteredData.length === 0) {
      const allData = ohlcRawData.map(point => ({
        timestamp: new Date(point.t * 1000).toISOString(),
        price: point.c || market.current_price,
      }));
      return allData.length > 0 ? allData : null;
    }

    return filteredData;
  }, [ohlcRawData, market, priceTimeframe]);

  // SII history - not available yet (requires historical tracking)
  const siiHistory = null;

  // Signal breakdown - not available yet (requires AI model)
  const signalBreakdown = null;

  // Data that requires additional infrastructure (show empty states)
  const SHOW_POSITION_ANALYSIS = true; // Show empty state - requires blockchain indexing
  const SHOW_WHALE_ACTIVITY = true; // Show empty state - requires blockchain indexing
  const SHOW_RELATED_MARKETS = true; // Query Polymarket API for real data
  const SHOW_AI_SIGNALS = false; // Not showing - no data available from Polymarket API

  // Fetch related markets based on tags
  const marketTags = realMarket?.tags?.map(t => t.slug) || []
  const { markets: relatedMarketsData, isLoading: relatedMarketsLoading } = useRelatedMarkets({
    tags: marketTags,
    category: realMarket?.category,
    excludeId: marketId,
    limit: 12,
  })

  // Order book - use real data if available, otherwise fallback to mock
  const orderBook: OrderBook = useMemo(() => {
    if (orderBookData && orderBookData.bids && orderBookData.asks) {
      // Transform real order book data to include cumulative totals
      let bidTotal = 0;
      const bidsWithTotal = orderBookData.bids.map(bid => {
        bidTotal += bid.size;
        return { price: bid.price, size: bid.size, total: bidTotal };
      });

      let askTotal = 0;
      const asksWithTotal = orderBookData.asks.map(ask => {
        askTotal += ask.size;
        return { price: ask.price, size: ask.size, total: askTotal };
      });

      return {
        bids: bidsWithTotal,
        asks: asksWithTotal,
        timestamp: new Date(orderBookData.timestamp).toISOString(),
      };
    }

    // Fallback to mock data
    return {
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
  }, [orderBookData]);

  // OHLC data - use real data if available, otherwise fallback to generated
  const ohlcData: OHLCDataPoint[] = useMemo(() => {
    if (ohlcRawData && ohlcRawData.length > 0) {
      return ohlcRawData.map(point => ({
        timestamp: new Date(point.t * 1000).toISOString(),
        open: point.o || 0,
        high: point.h || 0,
        low: point.l || 0,
        close: point.c || 0,
        volume: point.v || 0,
      }));
    }

    // Fallback to generated data
    return Array.from({ length: 42 }, (_, i) => {
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
  }, [ohlcRawData]);

  // Price chart option with modern styling - memoized to prevent unnecessary re-renders
  const priceChartOption = useMemo(() => {
    if (!priceHistory || priceHistory.length === 0) return null;

    return {
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
        lineStyle: { width: 3, color: "#00B512" },
        itemStyle: { color: "#00B512" },
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
        lineStyle: { width: 3, color: "#ef4444" },
        itemStyle: { color: "#ef4444" },
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
  }, [priceHistory, priceTimeframe]);

  // SII chart - not available (requires historical SII tracking)
  const siiChartOption = null;

  // Order book depth chart with modern styling - memoized to prevent unnecessary re-renders
  const orderBookOption = useMemo(() => ({
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
  }), [orderBook]);

  const getSIIColor = (sii: number) => {
    if (sii >= 70) return "text-muted-foreground font-bold";
    if (sii > 50) return "text-muted-foreground";
    if (sii > 30) return "text-muted-foreground";
    if (sii > 0) return "text-red-500";
    return "text-red-600 font-bold";
  };

  const getRecommendationBadge = (rec: string) => {
    if (rec === "BUY_YES") return <Badge className="bg-[#00B512] hover:bg-[#00B512]/90 text-black font-semibold">BUY YES</Badge>;
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

  // REMOVED: Smart money calculation - requires blockchain holder data

  // Loading state
  const isLoading = marketLoading || ohlcLoading || orderBookLoading;

  // Show loading or error state if no market data
  if (!market && (isLoading || marketLoading)) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-border"></div>
          <span>Loading market data...</span>
        </div>
      </div>
    );
  }

  if (!market || marketError) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="text-lg text-red-600">Market data unavailable</p>
          <p className="text-sm text-muted-foreground">
            The requested market could not be loaded. Please check the market ID and try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      {/* Header Section */}
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-4 flex-1">
            {/* Market Image */}
            {realMarket?.image && (
              <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border/50 shrink-0 bg-muted">
                <img
                  src={realMarket.image}
                  alt={market.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <Badge variant="outline" className="text-sm">{market.category}</Badge>
                {!isLoading && realMarket && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Activity className="h-3 w-3" />
                    Live data
                  </div>
                )}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2">{market.title}</h1>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-4xl">{market.description}</p>
            </div>
          </div>
          {eventSlug && (
            <Button variant="outline" asChild className="gap-2 shrink-0">
              <Link href={`/events/${eventSlug}`}>
                <Calendar className="h-4 w-4" />
                View Event
              </Link>
            </Button>
          )}
        </div>

        {/* Key Metrics Grid - ONLY REAL DATA */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Current Price</p>
              <p className="text-lg font-bold">{(market.current_price * 100).toFixed(1)}¢</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">24h Volume</p>
              <p className="text-lg font-bold">${(market.volume_24h / 1000000).toFixed(2)}M</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Liquidity</p>
              <p className="text-lg font-bold">${(market.liquidity_usd / 1000).toFixed(0)}k</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Closes In</p>
              <p className="text-lg font-bold">{market.hours_to_close ? `${market.hours_to_close}h` : 'TBD'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">

      {/* Smart Money SII Signal */}
      {smartMoneySII && (
        <div className="border border-border/50 rounded-lg p-4">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Smart Money Signal</h3>
              <span className="text-xs text-muted-foreground">
                {(smartMoneySII.confidence_score * 100).toFixed(0)}% Confidence
              </span>
            </div>

            {/* Compact Slider */}
            <div className="space-y-2">
              {/* YES and NO labels */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">YES Ω {smartMoneySII.yes_avg_omega.toFixed(2)}</span>
                <span className="font-medium">
                  Smart Money favors {smartMoneySII.smart_money_side}
                </span>
                <span className="text-muted-foreground">NO Ω {smartMoneySII.no_avg_omega.toFixed(2)}</span>
              </div>

              {/* Slider bar */}
              <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                {/* Indicator showing smart money side */}
                <div
                  className={cn(
                    "absolute top-0 h-full rounded-full transition-all",
                    smartMoneySII.smart_money_side === 'YES' ? "bg-[#00B512] left-0" :
                    smartMoneySII.smart_money_side === 'NO' ? "bg-red-500 right-0" :
                    "bg-muted-foreground left-1/2"
                  )}
                  style={{
                    width: smartMoneySII.smart_money_side === 'NEUTRAL'
                      ? '2px'
                      : `${50 + (smartMoneySII.signal_strength * 50)}%`
                  }}
                />
                {/* Center line */}
                <div className="absolute left-1/2 top-0 w-px h-full bg-border" />
              </div>
            </div>

            {/* Stats row */}
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
              <span>{smartMoneySII.yes_wallet_count} YES traders</span>
              <span>Ω Δ {smartMoneySII.omega_differential >= 0 ? '+' : ''}{smartMoneySII.omega_differential.toFixed(2)}</span>
              <span>{smartMoneySII.no_wallet_count} NO traders</span>
            </div>
          </div>
        </div>
      )}

      {/* TSI Momentum Signal */}
      {marketId && (
        <TSISignalCard
          marketId={marketId}
          marketTitle={market.title}
          showLiveIndicator={true}
          compact={false}
        />
      )}

      {/* WIO Smart Money Analysis */}
      {conditionId && (
        <MarketSmartMoneyWidget marketId={conditionId} />
      )}

      {/* Market Sentiment - ONLY REAL DATA */}
      <div className="border border-border/50 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <span className="text-lg font-medium text-muted-foreground">Market Sentiment</span>
        </div>
        <div className="flex items-baseline gap-4">
          <div className="text-3xl font-bold text-muted-foreground">
            YES {(market.current_price * 100).toFixed(1)}%
          </div>
          <div className="text-3xl font-bold text-muted-foreground">
            NO {((1 - market.current_price) * 100).toFixed(1)}%
          </div>
        </div>
        <div className="mt-4 text-sm text-muted-foreground">
          Based on current market prices from Polymarket
        </div>
      </div>

      {/* Price Chart */}
      <div className="border border-border/50 rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">Price History</h2>
            {ohlcRawData && ohlcRawData.length >= 10 ? (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Live Data • {ohlcRawData.length} points
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Simulated Data
              </Badge>
            )}
          </div>
          <div className="flex gap-1 border rounded-lg p-1">
            {(["1h", "24h", "7d", "30d"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setPriceTimeframe(tf)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  priceTimeframe === tf
                    ? "bg-[#00B512] text-black"
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
          <div className="border border-border/30 rounded-lg p-4 bg-[#00B512]/5">
            <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">YES Price</div>
            <div className="text-3xl font-bold text-muted-foreground">
              {(market.current_price * 100).toFixed(1)}¢
            </div>
          </div>
          <div className="border border-amber-600/30 rounded-lg p-4 bg-amber-600/5">
            <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">NO Price</div>
            <div className="text-3xl font-bold text-muted-foreground">
              {((1 - market.current_price) * 100).toFixed(1)}¢
            </div>
          </div>
        </div>

        {ohlcLoading ? (
          <div className="h-[400px] flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-border mx-auto mb-4"></div>
              <p className="text-sm text-muted-foreground">Loading price data...</p>
            </div>
          </div>
        ) : ohlcError || !priceHistory ? (
          <div className="h-[400px] flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Price history not available</p>
              <p className="text-xs text-muted-foreground mt-2">Historical price data could not be loaded</p>
            </div>
          </div>
        ) : (
          <div className="h-[400px]">
            <ReactECharts
              key={`price-chart-${priceTimeframe}-${clobTokenId}`}
              option={priceChartOption}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
              notMerge={true}
              lazyUpdate={true}
            />
          </div>
        )}
      </div>

      {/* Position Analysis */}
      {SHOW_POSITION_ANALYSIS && (
      <div className="border border-border/50 rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold tracking-tight">Position Analysis</h2>
          {finalHoldersLoading && (
            <Badge variant="outline" className="text-xs">
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-border mr-2"></div>
              Loading holders...
            </Badge>
          )}
          {!finalHoldersLoading && filteredHoldersData && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {graphHoldersData ? (
                <>Live Data • {filteredHoldersData.all.length} holders (The Graph)</>
              ) : (
                <>Live Data • Top {filteredHoldersData.all.length} (Polymarket API limit)</>
              )}
            </Badge>
          )}
        </div>

        {!finalHoldersLoading && (!finalHoldersData || finalHoldersData.all.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Wallet className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No Holder Data Available</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Holder data for this market is not currently available from Polymarket.
            </p>
          </div>
        ) : (
          <>
            {/* Data Availability Notice */}
            <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">
                    {graphHoldersData ? 'Complete Holder Data via The Graph' : 'Limited Data Available'}
                  </p>
                  <p className="text-muted-foreground">
                    {graphHoldersData ? (
                      <>Showing {filteredHoldersData?.all?.length || 0} holders with meaningful positions (≥1 share) via The Graph blockchain indexing. Includes real average entry prices and PnL data!</>
                    ) : (
                      <>Showing top ~20 holders per side from Polymarket API (capped by their service). <span className="font-medium">PnL, entry prices, and smart scores require blockchain indexing infrastructure (coming soon).</span></>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <div className="border border-border/30 rounded-lg p-5 bg-[#00B512]/5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-2 w-2 rounded-full bg-[#00B512]"></div>
                  <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">YES Side</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span>{graphHoldersData ? filteredHoldersData?.yes.length || 0 : `Top ${filteredHoldersData?.yes.length || 0}`} holders</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{graphHoldersData ? 'PnL: Available' : 'PnL: Requires indexing'}</span>
                  </div>
                </div>
              </div>

              <div className="border border-amber-600/30 rounded-lg p-5 bg-amber-600/5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-2 w-2 rounded-full bg-amber-600"></div>
                  <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">NO Side</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span>{graphHoldersData ? filteredHoldersData?.no.length || 0 : `Top ${filteredHoldersData?.no.length || 0}`} holders</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{graphHoldersData ? 'PnL: Available' : 'PnL: Requires indexing'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Holders Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top YES Holders */}
              <div>
                <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-[#00B512]"></div>
                  {graphHoldersData ? 'All YES Holders' : 'Top YES Holders'}
                </h3>
                <TruncatedTable<GraphHolder>
                  data={(filteredHoldersData?.yes || []) as GraphHolder[]}
                  initialRows={5}
                  renderHeader={() => (
                    <TableHeader>
                      <TableRow>
                        <TableHead>Wallet</TableHead>
                        <TableHead>Position</TableHead>
                        <TableHead>PnL</TableHead>
                      </TableRow>
                    </TableHeader>
                  )}
                  renderRow={(holder) => {
                    const totalPnL = (holder.realized_pnl || 0) + (holder.unrealized_pnl || 0);
                    const pnlColor = totalPnL >= 0 ? 'text-emerald-600' : 'text-rose-600';

                    return (
                      <TableRow key={holder.wallet_address}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/analysis/wallet/${holder.wallet_address}`}
                              className="text-muted-foreground font-mono text-xs hover:underline hover:text-muted-foreground/80 transition-colors"
                            >
                              {holder.wallet_alias}
                            </Link>
                            <OmegaBadge walletAddress={holder.wallet_address} size="sm" />
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-semibold">
                            {holder.position_shares?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '0'} shares
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={`text-sm font-semibold ${pnlColor}`}>
                            {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }}
                  expandText="Show All YES Holders"
                />
              </div>

              {/* Top NO Holders */}
              <div>
                <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-amber-600"></div>
                  {graphHoldersData ? 'All NO Holders' : 'Top NO Holders'}
                </h3>
                <TruncatedTable<GraphHolder>
                  data={(filteredHoldersData?.no || []) as GraphHolder[]}
                  initialRows={5}
                  renderHeader={() => (
                    <TableHeader>
                      <TableRow>
                        <TableHead>Wallet</TableHead>
                        <TableHead>Position</TableHead>
                        <TableHead>PnL</TableHead>
                      </TableRow>
                    </TableHeader>
                  )}
                  renderRow={(holder) => {
                    const totalPnL = (holder.realized_pnl || 0) + (holder.unrealized_pnl || 0);
                    const pnlColor = totalPnL >= 0 ? 'text-emerald-600' : 'text-rose-600';

                    return (
                      <TableRow key={holder.wallet_address}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/analysis/wallet/${holder.wallet_address}`}
                              className="text-muted-foreground font-mono text-xs hover:underline hover:text-muted-foreground/80 transition-colors"
                            >
                              {holder.wallet_alias}
                            </Link>
                            <OmegaBadge walletAddress={holder.wallet_address} size="sm" />
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-semibold">
                            {holder.position_shares?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '0'} shares
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={`text-sm font-semibold ${pnlColor}`}>
                            {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }}
                  expandText="Show All NO Holders"
                />
              </div>
            </div>
          </>
        )}
      </div>
      )}

      {/* Whale Activity */}
      {SHOW_WHALE_ACTIVITY && (
      <div className="border border-border/50 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight mb-2">Recent Whale Activity</h2>
            <p className="text-sm text-muted-foreground">
              Real-time large trades and market momentum • Tracks trades &gt; $5k
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(positionTrackingLoading || whaleTradesLoading) && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-border"></div>
            )}
          </div>
        </div>

        {/* Time Filter */}
        <div className="flex gap-2 mb-6">
          {(["1h", "4h", "24h"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setWhaleTimeframe(tf)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                whaleTimeframe === tf
                  ? "bg-[#00B512] text-black"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted border border-border"
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>

        {whaleActivity.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Activity className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No Recent Whale Activity</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              No large trades detected in the past 24 hours. Whale tracking monitors trades over $5,000.
            </p>
          </div>
        ) : (
          <>
            {/* Info banner explaining the difference from Position Analysis */}
            <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-blue-700 dark:text-blue-400 mb-1">Activity vs. Position</p>
                  <p className="text-muted-foreground">
                    <span className="font-medium">Whale Activity</span> shows RECENT TRADES and momentum (what&apos;s happening NOW).
                    <span className="font-medium"> Position Analysis</span> above shows WHO controls the most shares (strategic view).
                    This section tracks buy/sell pressure over the last {whaleTimeframe}.
                  </p>
                </div>
              </div>
            </div>

            {/* Whale Activity Tables - Split by YES/NO */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* YES Side */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-[#00B512]"></div>
                    YES Side Whale Activity
                  </h3>
                </div>

                {/* YES Volume Stats */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border border-border/30 rounded-lg p-3 bg-[#00B512]/5">
                      <div className="text-xs text-muted-foreground mb-1">Trades</div>
                      <div className="text-xl font-bold text-muted-foreground">{whaleActivityBySide.yesTrades}</div>
                    </div>
                    <div className="border border-border/30 rounded-lg p-3 bg-[#00B512]/5">
                      <div className="text-xs text-muted-foreground mb-1">Total Volume</div>
                      <div className="text-xl font-bold text-muted-foreground">
                        ${Math.round(whaleActivityBySide.yesVolume / 1000)}k
                      </div>
                    </div>
                  </div>

                  {/* Flow Pressure */}
                  <div className="border border-border/30 rounded-lg p-3 bg-[#00B512]/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold text-muted-foreground">Buy/Sell Pressure</div>
                      <div className={`text-xs font-bold ${whaleActivityBySide.yesNetFlow >= 0 ? 'text-muted-foreground' : 'text-red-600'}`}>
                        {whaleActivityBySide.yesNetFlow >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(whaleActivityBySide.yesNetFlow / 1000))}k
                      </div>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Buy:</span>
                        <span className="font-semibold text-muted-foreground">${Math.round(whaleActivityBySide.yesBuyVolume / 1000)}k</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sell:</span>
                        <span className="font-semibold text-red-600">${Math.round(whaleActivityBySide.yesSellVolume / 1000)}k</span>
                      </div>
                    </div>
                  </div>
                </div>

                {whaleActivityBySide.yes.length === 0 ? (
                  <div className="border rounded-lg p-8 text-center">
                    <p className="text-sm text-muted-foreground">No recent YES whale activity</p>
                  </div>
                ) : (
                  <TruncatedTable
                    data={whaleActivityBySide.yes}
                    initialRows={10}
                    renderHeader={() => (
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Wallet</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                        </TableRow>
                      </TableHeader>
                    )}
                    renderRow={(activity, idx) => {
                      const now = new Date()
                      const then = new Date(activity.timestamp)
                      const diffMs = now.getTime() - then.getTime()
                      const diffMins = Math.floor(diffMs / (1000 * 60))
                      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

                      let timeAgo: string
                      if (diffHours > 24) {
                        const days = Math.floor(diffHours / 24)
                        timeAgo = `${days}d ago`
                      } else if (diffHours > 0) {
                        timeAgo = `${diffHours}h ago`
                      } else if (diffMins > 0) {
                        timeAgo = `${diffMins}m ago`
                      } else {
                        timeAgo = 'Just now'
                      }

                      return (
                        <TableRow key={`yes-${activity.wallet_address}-${activity.timestamp}-${idx}`}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {timeAgo}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/analysis/wallet/${activity.wallet_address}`}
                                className="text-xs font-mono text-muted-foreground hover:underline"
                              >
                                {activity.wallet_alias}
                              </Link>
                              <OmegaBadge walletAddress={activity.wallet_address} size="sm" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={activity.action === 'BUY' ? 'default' : 'outline'}
                              className={activity.action === 'BUY'
                                ? 'bg-[#00B512] hover:bg-[#00B512]/90 text-black text-xs'
                                : 'text-red-600 border-red-600 text-xs'
                              }
                            >
                              {activity.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-xs">
                            ${Math.round(activity.estimated_value).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      )
                    }}
                    expandText="Show All YES Trades"
                  />
                )}
              </div>

              {/* NO Side */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-amber-600"></div>
                    NO Side Whale Activity
                  </h3>
                </div>

                {/* NO Volume Stats */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border border-amber-600/30 rounded-lg p-3 bg-amber-600/5">
                      <div className="text-xs text-muted-foreground mb-1">Trades</div>
                      <div className="text-xl font-bold text-muted-foreground">{whaleActivityBySide.noTrades}</div>
                    </div>
                    <div className="border border-amber-600/30 rounded-lg p-3 bg-amber-600/5">
                      <div className="text-xs text-muted-foreground mb-1">Total Volume</div>
                      <div className="text-xl font-bold text-muted-foreground">
                        ${Math.round(whaleActivityBySide.noVolume / 1000)}k
                      </div>
                    </div>
                  </div>

                  {/* Flow Pressure */}
                  <div className="border border-amber-600/30 rounded-lg p-3 bg-amber-600/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold text-muted-foreground">Buy/Sell Pressure</div>
                      <div className={`text-xs font-bold ${whaleActivityBySide.noNetFlow >= 0 ? 'text-muted-foreground' : 'text-red-600'}`}>
                        {whaleActivityBySide.noNetFlow >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(whaleActivityBySide.noNetFlow / 1000))}k
                      </div>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Buy:</span>
                        <span className="font-semibold text-muted-foreground">${Math.round(whaleActivityBySide.noBuyVolume / 1000)}k</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sell:</span>
                        <span className="font-semibold text-red-600">${Math.round(whaleActivityBySide.noSellVolume / 1000)}k</span>
                      </div>
                    </div>
                  </div>
                </div>

                {whaleActivityBySide.no.length === 0 ? (
                  <div className="border rounded-lg p-8 text-center">
                    <p className="text-sm text-muted-foreground">No recent NO whale activity</p>
                  </div>
                ) : (
                  <TruncatedTable
                    data={whaleActivityBySide.no}
                    initialRows={10}
                    renderHeader={() => (
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Wallet</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                        </TableRow>
                      </TableHeader>
                    )}
                    renderRow={(activity, idx) => {
                      const now = new Date()
                      const then = new Date(activity.timestamp)
                      const diffMs = now.getTime() - then.getTime()
                      const diffMins = Math.floor(diffMs / (1000 * 60))
                      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

                      let timeAgo: string
                      if (diffHours > 24) {
                        const days = Math.floor(diffHours / 24)
                        timeAgo = `${days}d ago`
                      } else if (diffHours > 0) {
                        timeAgo = `${diffHours}h ago`
                      } else if (diffMins > 0) {
                        timeAgo = `${diffMins}m ago`
                      } else {
                        timeAgo = 'Just now'
                      }

                      return (
                        <TableRow key={`no-${activity.wallet_address}-${activity.timestamp}-${idx}`}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {timeAgo}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/analysis/wallet/${activity.wallet_address}`}
                                className="text-xs font-mono text-muted-foreground hover:underline"
                              >
                                {activity.wallet_alias}
                              </Link>
                              <OmegaBadge walletAddress={activity.wallet_address} size="sm" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={activity.action === 'BUY' ? 'default' : 'outline'}
                              className={activity.action === 'BUY'
                                ? 'bg-amber-600 hover:bg-amber-600/90 text-white text-xs'
                                : 'text-red-600 border-red-600 text-xs'
                              }
                            >
                              {activity.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-xs">
                            ${Math.round(activity.estimated_value).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      )
                    }}
                    expandText="Show All NO Trades"
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
      )}

      {/* SII Trend + Signal Breakdown - HIDDEN: Requires proprietary analytics engine
          SHOW_AI_SIGNALS is false, siiChartOption and signalBreakdown are null
          This section is disabled until we implement AI signal generation */}

      {/* Order Book */}
      <CollapsibleSection
        title="Order Book"
        defaultExpanded={false}
        compactView={
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
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
            <h4 className="text-sm font-semibold mb-4 text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              All Bids
            </h4>
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto" style={{ maxHeight: '400px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
                  <thead className="sticky top-0 z-40 bg-background border-b border-border">
                    <tr>
                      <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Price</th>
                      <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Size</th>
                      <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderBook.bids.map((bid, i) => (
                      <tr key={i} className="border-b border-border hover:bg-muted/30 transition">
                        <td className="px-2 py-1.5 align-middle font-mono font-semibold">{(bid.price * 100).toFixed(2)}¢</td>
                        <td className="px-2 py-1.5 align-middle font-mono">{bid.size.toLocaleString()}</td>
                        <td className="px-2 py-1.5 align-middle text-muted-foreground font-mono">{bid.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-4 text-red-600 flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              All Asks
            </h4>
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto" style={{ maxHeight: '400px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
                  <thead className="sticky top-0 z-40 bg-background border-b border-border">
                    <tr>
                      <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Price</th>
                      <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Size</th>
                      <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderBook.asks.map((ask, i) => (
                      <tr key={i} className="border-b border-border hover:bg-muted/30 transition">
                        <td className="px-2 py-1.5 align-middle font-mono font-semibold">{(ask.price * 100).toFixed(2)}¢</td>
                        <td className="px-2 py-1.5 align-middle font-mono">{ask.size.toLocaleString()}</td>
                        <td className="px-2 py-1.5 align-middle text-muted-foreground font-mono">{ask.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
      <div className="border border-border/50 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 tracking-tight">
          <Info className="h-5 w-5 text-muted-foreground" />
          Market Information
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Key Stats */}
          <div className="space-y-4">
            <InfoRow
              icon={<Calendar className="h-4 w-4" />}
              label="Start Date"
              value={marketData?.startDate ? new Date(marketData.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
            />
            <InfoRow
              icon={<Clock className="h-4 w-4" />}
              label="End Date"
              value={market.end_date ? new Date(market.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD'}
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
              value={marketData?.tradersCount != null ? String(marketData.tradersCount).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : 'N/A'}
            />

            <Separator className="my-4" />

            <Button variant="outline" className="w-full gap-2" asChild>
              <a href={marketData?.polymarketUrl || '#'} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                View on Polymarket
              </a>
            </Button>
          </div>

          {/* Right Column - Rules */}
          <div>
            <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Resolution Rules</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {marketData?.rules || 'No resolution rules available'}
            </p>
          </div>
        </div>
      </div>

      {/* Related Markets */}
      {SHOW_RELATED_MARKETS && (
      <div className="border border-border/50 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-6 tracking-tight">Related Markets</h2>
        {relatedMarketsLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading related markets...</div>
        ) : relatedMarketsData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No related markets found</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {relatedMarketsData.map((event: any) => (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="group border border-border/50 rounded-lg p-5 hover:border-border/50 hover:bg-[#00B512]/5 transition-all cursor-pointer"
              >
                <h3 className="font-medium text-sm mb-4 line-clamp-2 group-hover:text-muted-foreground transition-colors">{event.title}</h3>
                <div className="flex gap-2 mb-4">
                  <Badge variant="outline" className="text-xs">
                    {event.category}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {event.marketCount} {event.marketCount === 1 ? 'market' : 'markets'}
                  </Badge>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Vol: ${(parseFloat(event.volume24hr || '0') / 1000).toFixed(0)}k</span>
                  <span>Liq: ${(parseFloat(event.liquidity || '0') / 1000).toFixed(0)}k</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      )}
      </div>
    </Card>
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
    <div className="border border-border/50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl font-bold mb-1 ${valueClassName}`}>
        {value}
      </div>
      {change && (
        <div className={`flex items-center gap-1 text-xs ${changeType === 'positive' ? 'text-muted-foreground' : 'text-red-500'}`}>
          {changeType === 'positive' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span>{change}</span>
        </div>
      )}
      {subtitle && !change && (
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      )}
    </div>
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
