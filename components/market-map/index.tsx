/* eslint-disable @typescript-eslint/no-unsafe-assignment */
"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  DollarSign,
  Activity,
  BarChart3,
  Layers,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";

import type { MarketMapTile } from "./types";
import type { CascadianMarket } from "@/types/polymarket";

const ACCENT_COLOR = "#00E0AA";

const TIME_WINDOW_OPTIONS = [
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
] as const;

type TimeWindowValue = (typeof TIME_WINDOW_OPTIONS)[number]["value"];

const TIME_WINDOW_LABEL_MAP: Record<TimeWindowValue, string> = {
  "24h": "24-hour",
  "7d": "7-day",
  "30d": "30-day",
  "90d": "90-day",
};

const CATEGORY_COLORS: Record<string, string> = {
  Politics: "#6366F1",
  Crypto: ACCENT_COLOR,
  Sports: "#F97316",
  Entertainment: "#C084FC",
  Other: "#94A3B8",
};

const DEFAULT_CATEGORY_COLOR = "#64748B";

type SiiBucket = {
  id: string;
  label: string;
  color: string;
  rangeLabel: string;
  predicate: (value: number) => boolean;
};

const SII_BUCKETS: SiiBucket[] = [
  {
    id: "strong-buy",
    label: "Strong Buy",
    color: ACCENT_COLOR,
    rangeLabel: "SII > 70",
    predicate: (value) => value > 70,
  },
  {
    id: "buy",
    label: "Buy",
    color: "#34D399",
    rangeLabel: "40 - 70",
    predicate: (value) => value > 40 && value <= 70,
  },
  {
    id: "neutral",
    label: "Neutral",
    color: "#94A3B8",
    rangeLabel: "-40 - 40",
    predicate: (value) => value >= -40 && value <= 40,
  },
  {
    id: "sell",
    label: "Sell",
    color: "#FB7185",
    rangeLabel: "-70 - -40",
    predicate: (value) => value < -40 && value >= -70,
  },
  {
    id: "strong-sell",
    label: "Strong Sell",
    color: "#EF4444",
    rangeLabel: "SII < -70",
    predicate: (value) => value < -70,
  },
];

/**
 * Calculate SII (Smart Intent Index) from market analytics
 * SII is a -100 to +100 score based on buy/sell ratio and momentum
 */
function calculateSII(market: CascadianMarket): number {
  if (!market.analytics) {
    // Default to 0 if no analytics available
    return 0;
  }

  const { buy_sell_ratio, momentum_score, price_change_24h } = market.analytics;

  // Convert buy/sell ratio to a score (-50 to +50)
  // Ratio > 1 = more buyers (bullish), < 1 = more sellers (bearish)
  // Log scale to handle extreme ratios
  let ratioScore = 0;
  if (buy_sell_ratio > 0) {
    if (buy_sell_ratio > 1) {
      // Bullish: map 1.0-10.0 to 0-50
      ratioScore = Math.min(50, Math.log10(buy_sell_ratio) * 50);
    } else {
      // Bearish: map 0.1-1.0 to -50-0
      ratioScore = Math.max(-50, Math.log10(buy_sell_ratio) * 50);
    }
  }

  // Convert momentum and price change to score (-25 to +25 each)
  const momentumScore = Math.max(-25, Math.min(25, momentum_score * 25));
  const priceScore = Math.max(-25, Math.min(25, price_change_24h * 25));

  // Combine scores (weighted: 50% ratio, 25% momentum, 25% price change)
  const sii = ratioScore + (momentumScore + priceScore) / 2;

  // Clamp to -100 to +100
  return Math.max(-100, Math.min(100, Math.round(sii)));
}

/**
 * Transform CascadianMarket to MarketMapTile
 */
function transformMarketToTile(market: CascadianMarket): MarketMapTile {
  return {
    marketId: market.market_id,
    title: market.title,
    category: market.category || 'Other',
    sii: calculateSII(market),
    volume24h: market.volume_24h,
    currentPrice: market.current_price,
  };
}

type TreemapNode = {
  name: string;
  value: number;
  marketTitle?: string;
  sii?: number;
  currentPrice?: number;
  category?: string;
  children?: TreemapNode[];
  itemStyle?: {
    color?: string;
  };
};

type SummaryMetric = {
  id: string;
  title: string;
  value: string;
  helper: string;
  badge?: {
    label: string;
    color: string;
  };
};

function formatCompactCurrency(value: number): string {
  if (!value) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}

function formatPercent(value: number, fractionDigits = value >= 10 ? 0 : 1): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(fractionDigits)}%`;
}

function formatSigned(value: number, fractionDigits = 1): string {
  const formatted = value.toFixed(fractionDigits);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatPrice(value: number): string {
  return `${(value * 100).toFixed(1)}¢`;
}

function truncate(value: string, limit = 48): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function getSiiBucket(value: number): SiiBucket {
  return SII_BUCKETS.find((bucket) => bucket.predicate(value)) ?? SII_BUCKETS[2];
}

function getSiiColor(value: number): string {
  return getSiiBucket(value).color;
}

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLOR;
}

export function MarketMap() {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [timeWindow, setTimeWindow] = useState<TimeWindowValue>("24h");
  const [focusedMarketId, setFocusedMarketId] = useState<string | null>(null);

  // API data state
  const [marketData, setMarketData] = useState<MarketMapTile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch markets from API
  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/polymarket/markets?include_analytics=true&limit=200&sort=volume');

        if (!response.ok) {
          throw new Error('Failed to fetch markets');
        }

        const result = await response.json();

        if (result.success && Array.isArray(result.data)) {
          const tiles = result.data
            .filter((market: CascadianMarket) => market.active && market.volume_24h > 0)
            .map(transformMarketToTile);
          setMarketData(tiles);
        } else {
          throw new Error('Invalid response format');
        }
      } catch (err) {
        console.error('Failed to fetch markets:', err);
        setError(err instanceof Error ? err.message : 'Failed to load markets');
      } finally {
        setLoading(false);
      }
    };

    fetchMarkets();
  }, []);

  const handleTimeWindowChange = (value: TimeWindowValue) => {
    setTimeWindow(value);
  };

  // Compute unique categories from data
  const uniqueCategories = useMemo(() => {
    return Array.from(new Set(marketData.map((market) => market.category))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [marketData]);

  const categoryOptions = useMemo(() => {
    return [
      { value: "all", label: "All Categories" },
      ...uniqueCategories.map((category) => ({
        value: category,
        label: category,
      })),
    ];
  }, [uniqueCategories]);

  const filteredMarkets = useMemo(() => {
    return marketData.filter(
      (market) => categoryFilter === "all" || market.category === categoryFilter,
    );
  }, [marketData, categoryFilter]);

  const totalVolume = useMemo(() => {
    return filteredMarkets.reduce((sum, market) => sum + market.volume24h, 0);
  }, [filteredMarkets]);

  const averageSii = useMemo(() => {
    if (!filteredMarkets.length) return 0;
    const total = filteredMarkets.reduce((sum, market) => sum + market.sii, 0);
    return total / filteredMarkets.length;
  }, [filteredMarkets]);

  const positiveCount = useMemo(() => {
    return filteredMarkets.filter((market) => market.sii > 40).length;
  }, [filteredMarkets]);

  const breadthPercent = filteredMarkets.length
    ? (positiveCount / filteredMarkets.length) * 100
    : 0;

  const categoryBreakdown = useMemo(() => {
    if (!filteredMarkets.length) return [];

    const categoryTotals = filteredMarkets.reduce<
      Record<string, { volume: number; markets: number }>
    >((acc, market) => {
      const current = acc[market.category] ?? { volume: 0, markets: 0 };
      current.volume += market.volume24h;
      current.markets += 1;
      acc[market.category] = current;
      return acc;
    }, {});

    return Object.entries(categoryTotals)
      .map(([category, stats]) => ({
        category,
        color: getCategoryColor(category),
        volume: stats.volume,
        markets: stats.markets,
        share: totalVolume ? (stats.volume / totalVolume) * 100 : 0,
      }))
      .sort((a, b) => b.volume - a.volume);
  }, [filteredMarkets, totalVolume]);

  const topCategory = categoryBreakdown[0];

  const sentimentLabel =
    averageSii > 25 ? "Bullish" : averageSii < -25 ? "Bearish" : "Sideways";
  const sentimentColor =
    averageSii > 25 ? ACCENT_COLOR : averageSii < -25 ? "#EF4444" : "#94A3B8";

  const summaryMetrics = useMemo<SummaryMetric[]>(
    () => [
      {
        id: "volume",
        title: `${TIME_WINDOW_LABEL_MAP[timeWindow]} volume`,
        value: totalVolume ? formatCompactCurrency(totalVolume) : "—",
        helper: filteredMarkets.length
          ? `${filteredMarkets.length} active ${
              filteredMarkets.length === 1 ? "market" : "markets"
            }`
          : "No markets available",
      },
      {
        id: "average-sii",
        title: "Average SII",
        value: formatSigned(averageSii, 1),
        helper: "Signal Index across filtered markets",
        badge: {
          label: sentimentLabel,
          color: sentimentColor,
        },
      },
      {
        id: "top-category",
        title: "Top category",
        value: topCategory ? topCategory.category : "—",
        helper: topCategory
          ? `${formatPercent(topCategory.share)} of ${TIME_WINDOW_LABEL_MAP[timeWindow]} volume`
          : "Filter to view categories",
        badge: topCategory
          ? {
              label: `${topCategory.markets} ${
                topCategory.markets === 1 ? "market" : "markets"
              }`,
              color: topCategory.color,
            }
          : undefined,
      },
      {
        id: "breadth",
        title: "Market breadth",
        value: filteredMarkets.length ? formatPercent(breadthPercent) : "—",
        helper: filteredMarkets.length
          ? `${positiveCount} with Buy or Strong Buy signals`
          : "Awaiting signals",
      },
    ],
    [
      averageSii,
      breadthPercent,
      filteredMarkets.length,
      positiveCount,
      sentimentColor,
      sentimentLabel,
      timeWindow,
      topCategory,
      totalVolume,
    ],
  );

  const groupedData = useMemo<TreemapNode[]>(() => {
    if (!filteredMarkets.length) return [];

    const categoryMap = filteredMarkets.reduce<
      Record<string, MarketMapTile[]>
    >((acc, market) => {
      const current = acc[market.category] ?? [];
      current.push(market);
      acc[market.category] = current;
      return acc;
    }, {});

    return Object.entries(categoryMap).map(([category, categoryMarkets]) => ({
      name: category,
      value: categoryMarkets.reduce((sum, item) => sum + item.volume24h, 0),
      itemStyle: {
        color: getCategoryColor(category),
      },
      children: categoryMarkets.map((market) => ({
        name: market.marketId,
        value: market.volume24h,
        marketTitle: market.title,
        sii: market.sii,
        currentPrice: market.currentPrice,
        category: market.category,
        itemStyle: {
          color: getSiiColor(market.sii),
        },
      })),
    }));
  }, [filteredMarkets]);

  const focusedMarket = useMemo(() => {
    if (!focusedMarketId) return null;
    return marketData.find((market) => market.marketId === focusedMarketId) ?? null;
  }, [focusedMarketId, marketData]);

  const chartOptions = useMemo<EChartsOption>(() => {
    const baseLabelColor = isDark ? "#E2E8F0" : "#0F172A";
    const subtleLabelColor = isDark ? "#94A3B8" : "#475569";
    const tooltipBackground = isDark ? "rgba(15,23,42,0.94)" : "rgba(255,255,255,0.98)";
    const timeWindowLabel = TIME_WINDOW_LABEL_MAP[timeWindow];

    return {
      backgroundColor: "transparent",
      textStyle: {
        fontFamily: "var(--font-sans, 'Inter', sans-serif)",
        color: baseLabelColor,
      },
      tooltip: {
        trigger: "item",
        borderWidth: 0,
        padding: 0,
        backgroundColor: tooltipBackground,
        textStyle: {
          color: baseLabelColor,
          fontSize: 12,
        },
        extraCssText:
          "box-shadow: 0 12px 32px rgba(15,23,42,0.18); border-radius: 12px; overflow: hidden;",
        formatter: (info: any) => {
          const data = info?.data;
          if (!data) return "";

          if (Array.isArray(data.children)) {
            return `
              <div style="padding: 12px 16px; min-width: 220px;">
                <div style="font-weight: 600; font-size: 14px;">${data.name}</div>
                <div style="margin-top: 6px; font-size: 12px; color: ${subtleLabelColor};">
                  Markets: <strong style="color:${baseLabelColor};">${data.children.length}</strong><br/>
                  Total ${timeWindowLabel} volume: <strong style="color:${baseLabelColor};">$${Number(
              data.value ?? 0,
            ).toLocaleString()}</strong>
                </div>
              </div>
            `;
          }

          if (data.marketTitle) {
            const bucket = getSiiBucket(data.sii ?? 0);
            return `
              <div style="padding: 12px 16px; min-width: 240px;">
                <div style="font-weight: 600; font-size: 13px; line-height: 1.4;">${data.marketTitle}</div>
                <div style="margin-top: 8px; font-size: 12px; color: ${subtleLabelColor}; display: grid; gap: 4px;">
                  <span>Category: <strong style="color:${baseLabelColor};">${data.category}</strong></span>
                  <span>SII: <strong style="color:${bucket.color};">${formatSigned(
              data.sii ?? 0,
              0,
            )}</strong> (${bucket.label})</span>
                  <span>${timeWindowLabel} volume: <strong style="color:${baseLabelColor};">$${Number(
              data.value ?? 0,
            ).toLocaleString()}</strong></span>
                  <span>Price: <strong style="color:${baseLabelColor};">${formatPrice(
              data.currentPrice ?? 0,
            )}</strong></span>
                </div>
              </div>
            `;
          }

          return "";
        },
      },
      series: groupedData.length
        ? [
            {
              type: "treemap",
              data: groupedData,
              roam: false,
              nodeClick: false,
              leafDepth: 2,
              breadcrumb: {
                show: false,
              },
              animationDuration: 500,
              animationDurationUpdate: 600,
              universalTransition: true,
              upperLabel: {
                show: true,
                height: 28,
                color: baseLabelColor,
                fontSize: 14,
                fontWeight: 600,
              },
              label: {
                show: true,
                color: baseLabelColor,
                fontSize: 12,
                fontWeight: 600,
                formatter: (params: any) => {
                  const data = params?.data;
                  if (!data) return "";
                  if (data.marketTitle) {
                    const title = truncate(data.marketTitle, 36);
                    const price = formatPrice(data.currentPrice ?? 0);
                    return `${title}\n${price}`;
                  }
                  return "";
                },
              },
              itemStyle: {
                borderColor: isDark ? "rgba(148,163,184,0.28)" : "#f8fafc",
                borderWidth: 2,
                gapWidth: 2,
              },
              levels: [
                {
                  itemStyle: {
                    borderWidth: 0,
                    gapWidth: 4,
                  },
                },
                {
                  itemStyle: {
                    borderColor: isDark ? "rgba(148,163,184,0.24)" : "rgba(15,23,42,0.08)",
                    borderWidth: 2,
                    gapWidth: 4,
                  },
                },
                {
                  itemStyle: {
                    borderColor: isDark ? "rgba(15,23,42,0.32)" : "rgba(15,23,42,0.08)",
                    borderWidth: 1,
                    gapWidth: 2,
                    borderRadius: 6,
                  },
                },
              ],
            },
          ]
        : [],
    };
  }, [groupedData, isDark, timeWindow]);

  const onEvents = {
    click: (params: any) => {
      if (params?.data?.marketTitle && !params.data.children) {
        router.push(`/analysis/market/${params.data.name as string}`);
      }
    },
    mouseover: (params: any) => {
      if (params?.data?.marketTitle && !params.data.children) {
        setFocusedMarketId(params.data.name as string);
      }
    },
    globalout: () => setFocusedMarketId(null),
  };

  // Count active filters
  const activeFiltersCount = (categoryFilter !== "all" ? 1 : 0) + (timeWindow !== "24h" ? 1 : 0);

  const resetFilters = () => {
    setCategoryFilter("all");
    setTimeWindow("24h");
  };

  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      {/* Hero Header with Gradient and Blur */}
      <div className="relative overflow-hidden rounded-t-2xl bg-gradient-to-br from-[#00E0AA]/10 via-background/80 to-background/60 backdrop-blur-md border-b border-border/50 px-6 pt-5 pb-3">
        {/* Grid Pattern Overlay */}
        <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:32px_32px]" />

        <div className="relative z-10">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border">
                  <div className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
                  <span className="text-xs font-medium text-muted-foreground">Live Heatmap</span>
                </div>
                <Badge variant="outline" className="border-border/50">
                  <Activity className="h-3 w-3 mr-1" />
                  {marketData.length} Markets
                </Badge>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2">Market Map</h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Navigate prediction markets by category and sentiment using visual heatmaps powered by SII
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Summary Metrics */}
      <div className="px-6 py-4 border-b border-border/50">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground">View:</span>
            <Select value={timeWindow} onValueChange={(value) => handleTimeWindowChange(value as TimeWindowValue)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Time Window" />
              </SelectTrigger>
              <SelectContent>
                {TIME_WINDOW_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {activeFiltersCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={resetFilters}
              className="gap-2"
            >
              <X className="h-4 w-4" />
              Clear Filters
            </Button>
          )}
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="px-6 py-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryMetrics.map((metric) => (
            <div
              key={metric.id}
              className="rounded-lg border border-border/50 bg-muted/10 p-5 hover:border-border transition-all duration-300"
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  {metric.id === "volume" && <DollarSign className="h-4 w-4 text-muted-foreground" />}
                  {metric.id === "average-sii" && <TrendingUp className="h-4 w-4 text-muted-foreground" />}
                  {metric.id === "top-category" && <Layers className="h-4 w-4 text-muted-foreground" />}
                  {metric.id === "breadth" && <BarChart3 className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {metric.title}
                  </span>
                </div>
                {metric.badge && (
                  <Badge
                    variant="outline"
                    className="border"
                    style={{
                      borderColor: `${metric.badge.color}33`,
                      color: metric.badge.color,
                      backgroundColor: `${metric.badge.color}14`,
                    }}
                  >
                    {metric.badge.label}
                  </Badge>
                )}
              </div>
              <div className="text-2xl font-bold tracking-tight text-foreground mb-2">
                {metric.value}
              </div>
              <div className="text-sm text-muted-foreground">{metric.helper}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Heatmap Section */}
      <div className="px-6 pb-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight mb-1">Category Heatmap</h2>
          <p className="text-sm text-muted-foreground">
            Tiles sized by {TIME_WINDOW_LABEL_MAP[timeWindow]} volume and colored by Signal Index
          </p>
        </div>

        <div className="space-y-6">
          {loading ? (
            <div className="flex h-[500px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/10">
              <Loader2 className="h-12 w-12 text-muted-foreground animate-spin" />
              <div className="text-lg font-semibold">Loading market data...</div>
              <p className="max-w-md text-sm text-muted-foreground text-center">
                Fetching live prediction markets from Polymarket
              </p>
            </div>
          ) : error ? (
            <div className="flex h-[500px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-destructive/20 bg-destructive/5">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <div className="text-lg font-semibold">Failed to load markets</div>
              <p className="max-w-md text-sm text-muted-foreground text-center">
                {error}
              </p>
              <Button variant="outline" onClick={() => window.location.reload()} className="gap-2 mt-2">
                Try Again
              </Button>
            </div>
          ) : filteredMarkets.length === 0 ? (
            <div className="flex h-[500px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/10">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-2">
                <Layers className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-lg font-semibold">No markets found</div>
              <p className="max-w-md text-sm text-muted-foreground text-center">
                No markets match your current filter criteria. Adjust the category or timeframe to explore more markets.
              </p>
              {activeFiltersCount > 0 && (
                <Button variant="outline" onClick={resetFilters} className="gap-2 mt-2">
                  <X className="h-4 w-4" />
                  Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
              {/* Treemap Chart */}
              <div className="h-[500px] min-h-[500px] rounded-xl border border-border bg-muted/5 p-3">
                <ReactECharts
                  option={chartOptions}
                  onEvents={onEvents}
                  style={{ height: "100%", width: "100%" }}
                  notMerge
                  lazyUpdate
                  opts={{ renderer: "canvas" }}
                />
              </div>

              {/* Sidebar - Legend and Focused Market */}
              <div className="space-y-6">
                {/* SII Legend */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    SII Color Legend
                  </div>
                  <div className="space-y-2">
                    {SII_BUCKETS.map((bucket) => (
                      <div
                        key={bucket.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/10 px-3 py-2 hover:bg-muted/20 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-sm"
                            style={{ backgroundColor: bucket.color }}
                          />
                          <span className="text-sm font-medium">{bucket.label}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{bucket.rangeLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Focused Market Details */}
                <div className="border border-border/50 bg-muted/10 rounded-lg p-4">
                  {focusedMarket ? (
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Focused Market
                      </div>
                      <div className="text-sm font-medium leading-5">
                        {focusedMarket.title}
                      </div>
                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <div>
                          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                            SII
                          </span>
                          <span
                            className="text-lg font-bold"
                            style={{ color: getSiiColor(focusedMarket.sii) }}
                          >
                            {formatSigned(focusedMarket.sii, 0)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                            Price
                          </span>
                          <span className="text-lg font-bold">
                            {formatPrice(focusedMarket.currentPrice)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                            Volume
                          </span>
                          <span className="text-lg font-bold">
                            {formatCompactCurrency(focusedMarket.volume24h)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                            Category
                          </span>
                          <Badge
                            variant="outline"
                            style={{
                              borderColor: `${getCategoryColor(focusedMarket.category)}33`,
                              color: getCategoryColor(focusedMarket.category),
                              backgroundColor: `${getCategoryColor(focusedMarket.category)}14`,
                            }}
                          >
                            {focusedMarket.category}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 text-center py-8">
                      <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                        <Activity className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="text-sm font-medium text-muted-foreground">
                        Hover over a market
                      </div>
                      <p className="text-xs text-muted-foreground">
                        See detailed SII, price, and volume signals
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Footer Info */}
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground pt-4 border-t border-border/50">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              <span>
                Showing <span className="font-semibold text-foreground">{filteredMarkets.length}</span> of <span className="font-semibold text-foreground">{marketData.length}</span> markets
              </span>
            </div>
            <span>•</span>
            <span>{TIME_WINDOW_LABEL_MAP[timeWindow]} activity</span>
            <span>•</span>
            <span>Click a tile to view details</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
