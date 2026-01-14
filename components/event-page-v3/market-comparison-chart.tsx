"use client";

import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useQueries } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Eye,
  EyeOff,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SmartMarketData } from "./hooks/use-event-smart-summary";

// Dynamically import ECharts to avoid SSR issues
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface MarketComparisonChartProps {
  markets: SmartMarketData[];
  chartView: "both" | "smart" | "crowd";
  onChartViewChange: (view: "both" | "smart" | "crowd") => void;
  timeRange: "1W" | "1M" | "3M" | "ALL";
  onTimeRangeChange: (range: "1W" | "1M" | "3M" | "ALL") => void;
  onMarketClick: (market: SmartMarketData) => void;
}

// Color palette for markets
const MARKET_COLORS = [
  "#22d3ee", // cyan
  "#f472b6", // pink
  "#a78bfa", // purple
  "#34d399", // emerald
  "#fbbf24", // amber
  "#fb7185", // rose
  "#60a5fa", // blue
  "#4ade80", // green
  "#f97316", // orange
  "#c084fc", // violet
];

// Smart money line color
const SMART_MONEY_COLOR = "#00E0AA";

// Get time filter in milliseconds
function getTimeFilter(range: string): number {
  const now = Date.now();
  switch (range) {
    case "1W":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "1M":
      return now - 30 * 24 * 60 * 60 * 1000;
    case "3M":
      return now - 90 * 24 * 60 * 60 * 1000;
    default:
      return 0; // ALL
  }
}

// Fetch OHLC data for a market
async function fetchMarketOHLC(tokenId: string) {
  if (!tokenId) return [];

  try {
    const response = await fetch(`/api/polymarket/ohlc/${tokenId}?interval=max`);
    if (!response.ok) return [];

    const data = await response.json();
    return data.data || data.history || [];
  } catch {
    return [];
  }
}

// Get YES token ID from market
function getYesTokenId(market: SmartMarketData): string | null {
  // Extract YES token ID from clobTokenIds JSON string
  if (market.clobTokenIds) {
    try {
      const tokens = JSON.parse(market.clobTokenIds);
      if (Array.isArray(tokens) && tokens[0]) {
        return tokens[0];
      }
    } catch {
      // Fall through to return null
    }
  }
  return null;
}

export function MarketComparisonChart({
  markets,
  chartView,
  onChartViewChange,
  timeRange,
  onTimeRangeChange,
  onMarketClick,
}: MarketComparisonChartProps) {
  const [visibleMarkets, setVisibleMarkets] = useState<Set<string>>(
    new Set(markets.slice(0, 5).map((m) => m.id))
  );

  // Fetch OHLC data for visible markets
  const ohlcQueries = useQueries({
    queries: markets.filter((m) => visibleMarkets.has(m.id)).map((market) => {
      const tokenId = getYesTokenId(market);
      return {
        queryKey: ["market-ohlc", tokenId, market.id],
        queryFn: () => fetchMarketOHLC(tokenId || market.id),
        enabled: !!tokenId || !!market.id,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
      };
    }),
  });

  const isLoading = ohlcQueries.some((q) => q.isLoading);

  // Toggle market visibility
  const toggleMarketVisibility = useCallback((marketId: string) => {
    setVisibleMarkets((prev) => {
      const next = new Set(prev);
      if (next.has(marketId)) {
        next.delete(marketId);
      } else {
        if (next.size < 6) {
          next.add(marketId);
        }
      }
      return next;
    });
  }, []);

  // Build chart options
  const chartOptions = useMemo(() => {
    const timeFilter = getTimeFilter(timeRange);
    const visibleMarketsList = markets.filter((m) => visibleMarkets.has(m.id));

    // Build series for each visible market
    const series = visibleMarketsList.map((market, idx) => {
      const ohlcData = ohlcQueries[idx]?.data || [];
      const color = MARKET_COLORS[idx % MARKET_COLORS.length];

      // Filter by time range and map to chart format
      const data = ohlcData
        .filter((point: any) => {
          const timestamp = point.t * 1000;
          return timestamp >= timeFilter;
        })
        .map((point: any) => [point.t * 1000, (point.c || point.p || 0) * 100]);

      return {
        name: market.shortName,
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: {
          width: 2,
          type: chartView === "smart" ? "dashed" : "solid",
        },
        itemStyle: { color },
        data,
        emphasis: {
          focus: "series",
          lineStyle: { width: 3 },
        },
      };
    });

    // Add smart money lines if showing smart view
    if ((chartView === "smart" || chartView === "both") && visibleMarketsList.some((m) => m.smartOdds !== null)) {
      visibleMarketsList.forEach((market, idx) => {
        if (market.smartOdds !== null) {
          const ohlcData = ohlcQueries[idx]?.data || [];
          if (ohlcData.length > 0) {
            const lastTimestamp = ohlcData[ohlcData.length - 1]?.t * 1000 || Date.now();
            const firstTimestamp = ohlcData[0]?.t * 1000 || Date.now() - 30 * 24 * 60 * 60 * 1000;

            // Add a reference line for smart money odds
            series.push({
              name: `${market.shortName} (Smart)`,
              type: "line",
              smooth: false,
              symbol: "none",
              lineStyle: {
                width: 1.5,
                type: "dashed",
              },
              itemStyle: { color: SMART_MONEY_COLOR },
              data: [
                [firstTimestamp, market.smartOdds * 100],
                [lastTimestamp, market.smartOdds * 100],
              ],
              emphasis: { disabled: true },
            } as any);
          }
        }
      });
    }

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: (params: any) => {
          if (!params || params.length === 0) return "";
          const date = new Date(params[0].data[0]).toLocaleDateString();
          let tooltip = `<div style="font-weight: 600; margin-bottom: 8px;">${date}</div>`;
          params.forEach((param: any) => {
            const value = param.data[1]?.toFixed(1) || "—";
            tooltip += `<div style="display: flex; align-items: center; gap: 8px; margin: 4px 0;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${param.color};"></span>
              <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${param.seriesName}</span>
              <span style="font-weight: 600;">${value}%</span>
            </div>`;
          });
          return tooltip;
        },
      },
      legend: {
        show: false,
      },
      grid: {
        left: 50,
        right: 20,
        top: 20,
        bottom: 40,
      },
      xAxis: {
        type: "time",
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#888",
          fontSize: 11,
          formatter: (value: number) => {
            const date = new Date(value);
            return `${date.getMonth() + 1}/${date.getDate()}`;
          },
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#888",
          fontSize: 11,
          formatter: (value: number) => `${value}%`,
        },
        splitLine: {
          lineStyle: { color: "rgba(255, 255, 255, 0.05)" },
        },
      },
      series,
    };
  }, [markets, visibleMarkets, ohlcQueries, timeRange, chartView]);

  // Legend items
  const legendItems = markets.slice(0, 10).map((market, idx) => ({
    market,
    color: MARKET_COLORS[idx % MARKET_COLORS.length],
    visible: visibleMarkets.has(market.id),
  }));

  return (
    <Card className="border border-border/50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <LineChart className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold">Historical Odds</h2>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="flex items-center gap-2">
          {/* Chart view toggle */}
          <div className="flex items-center gap-1 mr-2">
            {(["both", "crowd", "smart"] as const).map((view) => (
              <Button
                key={view}
                variant={chartView === view ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "h-7 text-xs px-2 capitalize",
                  chartView === view && "bg-[#00E0AA]/10 text-[#00E0AA]"
                )}
                onClick={() => onChartViewChange(view)}
              >
                {view === "both" ? "Both" : view === "smart" ? "Smart $" : "Crowd"}
              </Button>
            ))}
          </div>

          {/* Time range */}
          <div className="flex items-center gap-1">
            {(["1W", "1M", "3M", "ALL"] as const).map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? "secondary" : "ghost"}
                size="sm"
                className={cn("h-7 text-xs px-2", timeRange === range && "bg-muted")}
                onClick={() => onTimeRangeChange(range)}
              >
                {range}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[300px] w-full">
        {typeof window !== "undefined" && (
          <ReactECharts
            option={chartOptions}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "svg" }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-muted-foreground">Toggle markets (max 6):</span>
          {chartView !== "crowd" && (
            <Badge variant="outline" className="text-xs bg-[#00E0AA]/10 text-[#00E0AA] border-[#00E0AA]/30">
              <span className="inline-block w-2 h-0.5 bg-[#00E0AA] mr-1" style={{ borderStyle: "dashed" }} />
              Smart Money
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {legendItems.map(({ market, color, visible }) => (
            <button
              key={market.id}
              onClick={() => toggleMarketVisibility(market.id)}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-all",
                visible
                  ? "bg-muted/50 border border-border"
                  : "opacity-50 hover:opacity-75"
              )}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: visible ? color : "#666" }}
              />
              <span className="max-w-[120px] truncate">{market.shortName}</span>
              <span className="text-muted-foreground">
                {(market.crowdOdds * 100).toFixed(0)}%
              </span>
              {visible ? (
                <Eye className="h-3 w-3 text-muted-foreground" />
              ) : (
                <EyeOff className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Click hint */}
      <p className="text-xs text-center text-muted-foreground mt-3">
        Click any market above to see detailed smart money analysis
      </p>
    </Card>
  );
}
