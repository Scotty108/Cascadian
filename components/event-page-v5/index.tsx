"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useQueries } from "@tanstack/react-query";
import { useSmartMoneySignals } from "@/hooks/use-smart-money-signals";
import {
  Loader2,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  Clock,
  Sparkles,
  BarChart3,
  Eye,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEventSmartSummary, type SmartMarketData } from "../event-page-v3/hooks/use-event-smart-summary";
import { MarketCardV5 } from "./market-card-v5";
import { MarketDetailV5 } from "./market-detail-v5";

// Dynamically import ECharts
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// ============================================
// DESIGN TOKENS
// ============================================

const CHART_COLORS = [
  "#00E0AA", "#22D3EE", "#A78BFA", "#F472B6", "#FBBF24",
  "#34D399", "#60A5FA", "#FB7185", "#4ADE80", "#F97316",
];

// ============================================
// HELPERS
// ============================================

function formatVolume(vol: number | undefined): string {
  if (!vol) return "$0";
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
  return `$${vol.toFixed(0)}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getYesTokenId(clobTokenIds: string | undefined): string | null {
  if (!clobTokenIds) return null;
  try {
    const tokens = JSON.parse(clobTokenIds);
    if (Array.isArray(tokens) && tokens[0]) return tokens[0];
  } catch {
    return null;
  }
  return null;
}

async function fetchMarketOHLC(tokenId: string | null) {
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

// ============================================
// TYPES
// ============================================

interface EventPageV5Props {
  eventSlug: string;
}

type TimeRange = "1W" | "1M" | "3M" | "ALL";

// ============================================
// MAIN COMPONENT
// ============================================

export function EventPageV5({ eventSlug }: EventPageV5Props) {
  const { theme, resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const { event, smartPrediction, markets, isLoading, error } = useEventSmartSummary(eventSlug);
  const [selectedMarket, setSelectedMarket] = useState<SmartMarketData | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("1M");
  const [hoveredMarket, setHoveredMarket] = useState<string | null>(null);

  // Sort markets by probability
  const sortedMarkets = useMemo(() => {
    return [...markets].sort((a, b) => b.crowdOdds - a.crowdOdds);
  }, [markets]);

  // Get top 3 markets for featured display
  const featuredMarkets = sortedMarkets.slice(0, 3);
  const otherMarkets = sortedMarkets.slice(3);

  // Fetch OHLC data for featured markets
  const ohlcQueries = useQueries({
    queries: featuredMarkets.map((market) => {
      const tokenId = getYesTokenId(market.clobTokenIds);
      return {
        queryKey: ["market-ohlc-v5", tokenId || market.id],
        queryFn: () => fetchMarketOHLC(tokenId),
        enabled: !!tokenId,
        staleTime: 10 * 60 * 1000,
      };
    }),
  });

  const isLoadingOHLC = ohlcQueries.some((q) => q.isLoading);

  // Smart money stats
  const smartMoneyStats = useMemo(() => {
    const withSignals = markets.filter(m => m.smartOdds !== null);
    const bullish = withSignals.filter(m => m.signal === "BULLISH").length;
    const bearish = withSignals.filter(m => m.signal === "BEARISH").length;
    const totalInvested = markets.reduce((sum, m) => sum + m.totalInvested, 0);
    return { coverage: withSignals.length, bullish, bearish, totalInvested };
  }, [markets]);

  // Loading state
  if (isLoading && !event.title) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-2 border-[#00E0AA]/20" />
            <Loader2 className="absolute inset-0 m-auto h-8 w-8 animate-spin text-[#00E0AA]" />
          </div>
          <p className="text-muted-foreground text-sm">Loading market intelligence...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-md px-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <h3 className="text-xl font-semibold">Failed to load event</h3>
          <p className="text-muted-foreground text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Gradient Overlay */}
      <div className="fixed inset-0 bg-gradient-to-b from-[#00E0AA]/5 via-transparent to-transparent pointer-events-none" />

      <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm mb-6">
          <Link
            href="/events"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Events
          </Link>
          <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
          <span className="font-medium truncate max-w-[300px]">
            {event.title}
          </span>
        </nav>

        {/* Header Section */}
        <header className="mb-8">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className="px-2.5 py-1 text-xs font-semibold uppercase tracking-wider bg-[#00E0AA]/10 text-[#00E0AA] rounded-full border border-[#00E0AA]/20">
                  {event.category || "MARKET"}
                </span>
                {event.closesAt && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    Closes {formatDate(event.closesAt)}
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight leading-tight">
                {event.title}
              </h1>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-[#00E0AA]" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Volume</p>
                <p className="font-semibold font-mono">{formatVolume(event.totalVolume)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-[#22D3EE]" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Markets</p>
                <p className="font-semibold font-mono">{event.marketCount}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-[#FBBF24]" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Smart Coverage</p>
                <p className="font-semibold font-mono">{smartMoneyStats.coverage}/{markets.length}</p>
              </div>
            </div>
            {smartMoneyStats.totalInvested > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#00E0AA]/10 flex items-center justify-center">
                  <Users className="w-4 h-4 text-[#00E0AA]" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Smart $ Invested</p>
                  <p className="font-semibold font-mono text-[#00E0AA]">{formatVolume(smartMoneyStats.totalInvested)}</p>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Smart Money Prediction Hero */}
        {smartPrediction.topOutcome && (
          <SmartPredictionHero
            prediction={smartPrediction.topOutcome}
            onViewDetails={() => setSelectedMarket(smartPrediction.topOutcome)}
          />
        )}

        {/* Main Chart Section */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Eye className="w-5 h-5 text-[#00E0AA]" />
              Price History
            </h2>
            <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
          </div>
          <div className="rounded-2xl border border-border bg-card/50 backdrop-blur-xl overflow-hidden">
            <MultiLineChart
              markets={featuredMarkets}
              ohlcQueries={ohlcQueries}
              timeRange={timeRange}
              isLoading={isLoadingOHLC}
              hoveredMarket={hoveredMarket}
              onHoverMarket={setHoveredMarket}
              isDark={isDark}
            />
          </div>
        </section>

        {/* Featured Markets Grid */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#00E0AA]" />
            Top Outcomes
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {featuredMarkets.map((market, idx) => (
              <MarketCardV5
                key={`featured-${market.id}-${idx}`}
                market={market}
                rank={idx + 1}
                color={CHART_COLORS[idx]}
                isHovered={hoveredMarket === market.id}
                onHover={(hovered) => setHoveredMarket(hovered ? market.id : null)}
                onClick={() => setSelectedMarket(market)}
              />
            ))}
          </div>
        </section>

        {/* All Markets List */}
        {otherMarkets.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
              All Outcomes
              <span className="text-sm font-normal text-muted-foreground">({otherMarkets.length})</span>
            </h2>
            <div className="rounded-2xl border border-border bg-card/50 backdrop-blur-xl overflow-hidden divide-y divide-border">
              {otherMarkets.map((market, idx) => (
                <MarketListItem
                  key={`other-${market.id}-${idx}`}
                  market={market}
                  rank={idx + 4}
                  onClick={() => setSelectedMarket(market)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Signal Summary */}
        {(smartMoneyStats.bullish > 0 || smartMoneyStats.bearish > 0) && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-4">Smart Money Signals</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
                <div className="flex items-center gap-3 mb-2">
                  <TrendingUp className="w-6 h-6 text-emerald-500" />
                  <span className="text-3xl font-bold font-mono text-emerald-500">{smartMoneyStats.bullish}</span>
                </div>
                <p className="text-sm text-emerald-500/70">Bullish Signals</p>
                <p className="text-xs text-muted-foreground mt-1">Smart money sees upside</p>
              </div>
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6">
                <div className="flex items-center gap-3 mb-2">
                  <TrendingDown className="w-6 h-6 text-rose-500" />
                  <span className="text-3xl font-bold font-mono text-rose-500">{smartMoneyStats.bearish}</span>
                </div>
                <p className="text-sm text-rose-500/70">Bearish Signals</p>
                <p className="text-xs text-muted-foreground mt-1">Smart money sees downside</p>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Market Detail Modal */}
      {selectedMarket && (
        <MarketDetailV5
          market={selectedMarket}
          onClose={() => setSelectedMarket(null)}
        />
      )}
    </div>
  );
}

// ============================================
// SMART PREDICTION HERO
// ============================================

function SmartPredictionHero({
  prediction,
  onViewDetails
}: {
  prediction: SmartMarketData;
  onViewDetails: () => void;
}) {
  const divergence = prediction.delta ? prediction.delta * 100 : 0;
  const isPositive = divergence > 0;

  return (
    <section className="mb-8">
      <div className="relative rounded-2xl border border-[#00E0AA]/20 bg-gradient-to-br from-[#00E0AA]/10 via-[#00E0AA]/5 to-transparent p-6 overflow-hidden">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#00E0AA]/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

        <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-6">
          {/* Prediction Image */}
          <div className="flex-shrink-0">
            {prediction.image ? (
              <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-[#00E0AA]/30 shadow-lg shadow-[#00E0AA]/10">
                <img src={prediction.image} alt="" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-20 h-20 rounded-xl bg-[#00E0AA]/10 border-2 border-[#00E0AA]/30 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-[#00E0AA]" />
              </div>
            )}
          </div>

          {/* Prediction Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#00E0AA]">
                Smart Money Prediction
              </span>
            </div>
            <h3 className="text-xl sm:text-2xl font-bold mb-3 line-clamp-2">
              {prediction.shortName || prediction.question}
            </h3>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-3xl font-mono font-bold text-[#00E0AA]">
                  {prediction.smartOdds !== null ? `${(prediction.smartOdds * 100).toFixed(0)}%` : "—"}
                </span>
                <span className="text-sm text-muted-foreground">Smart Money Odds</span>
              </div>
              {Math.abs(divergence) > 1 && (
                <div className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium",
                  isPositive
                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                )}>
                  {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {isPositive ? "+" : ""}{divergence.toFixed(0)}pt vs crowd
                </div>
              )}
            </div>
          </div>

          {/* CTA Button */}
          <button
            onClick={onViewDetails}
            className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 bg-[#00E0AA] text-black font-semibold rounded-xl hover:bg-[#00E0AA]/90 transition-all hover:scale-105 active:scale-95"
          >
            View Analysis
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

// ============================================
// TIME RANGE SELECTOR
// ============================================

function TimeRangeSelector({
  value,
  onChange
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
}) {
  const ranges: TimeRange[] = ["1W", "1M", "3M", "ALL"];

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 border border-border">
      {ranges.map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
            value === range
              ? "bg-[#00E0AA] text-black"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          {range}
        </button>
      ))}
    </div>
  );
}

// ============================================
// MULTI LINE CHART
// ============================================

function MultiLineChart({
  markets,
  ohlcQueries,
  timeRange,
  isLoading,
  hoveredMarket,
  onHoverMarket,
  isDark,
}: {
  markets: SmartMarketData[];
  ohlcQueries: Array<{ data?: Array<{ t: number; c: number }>; isLoading?: boolean }>;
  timeRange: TimeRange;
  isLoading: boolean;
  hoveredMarket: string | null;
  onHoverMarket: (id: string | null) => void;
  isDark: boolean;
}) {
  const chartData = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const ranges: Record<TimeRange, number> = {
      "1W": 7 * 24 * 60 * 60,
      "1M": 30 * 24 * 60 * 60,
      "3M": 90 * 24 * 60 * 60,
      "ALL": 365 * 24 * 60 * 60,
    };
    const cutoff = now - ranges[timeRange];

    const allTimestamps = new Set<number>();
    const marketData: { name: string; color: string; data: Map<number, number> }[] = [];

    markets.forEach((market, idx) => {
      const ohlcData: Array<{ t: number; c: number }> = ohlcQueries[idx]?.data || [];
      const filtered = ohlcData.filter((d) => d.t >= cutoff);
      const dataMap = new Map<number, number>();
      filtered.forEach((p) => {
        allTimestamps.add(p.t);
        dataMap.set(p.t, p.c * 100);
      });
      marketData.push({
        name: market.shortName || market.question.slice(0, 30),
        color: CHART_COLORS[idx],
        data: dataMap,
      });
    });

    const sortedTs = Array.from(allTimestamps).sort((a, b) => a - b);
    const formatDate = (ts: number) => {
      const d = new Date(ts * 1000);
      return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]} ${d.getUTCDate()}`;
    };

    const xAxis = sortedTs.map(formatDate);
    const series = marketData.map((md, idx) => ({
      name: md.name,
      type: "line" as const,
      smooth: true,
      symbol: "none",
      lineStyle: {
        width: hoveredMarket === markets[idx]?.id ? 3.5 : 2,
        color: md.color,
        opacity: hoveredMarket && hoveredMarket !== markets[idx]?.id ? 0.3 : 1,
      },
      emphasis: { disabled: true },
      data: sortedTs.map((ts) => {
        const val = md.data.get(ts);
        return val !== undefined ? parseFloat(val.toFixed(1)) : null;
      }),
      connectNulls: true,
      ...(idx === 0 ? {
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: `${md.color}20` },
              { offset: 1, color: `${md.color}00` },
            ],
          },
        },
      } : {}),
    }));

    return { xAxis, series };
  }, [markets, ohlcQueries, timeRange, hoveredMarket]);

  const textColor = isDark ? "#6b7280" : "#9ca3af";
  const gridColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
  const tooltipBg = isDark ? "#1f2937" : "#ffffff";
  const tooltipBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const tooltipText = isDark ? "#fff" : "#1f2937";

  const chartOption = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      borderWidth: 1,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (params: any[]) => {
        const date = params[0]?.axisValue || "";
        let content = `<div style="padding:8px;"><div style="color:${textColor};margin-bottom:8px;">${date}</div>`;
        params.forEach((p: any) => {
          if (p.value !== null) {
            content += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span style="width:8px;height:8px;border-radius:50%;background:${p.color};"></span>
              <span style="flex:1;color:${tooltipText};">${p.seriesName}</span>
              <span style="font-family:monospace;font-weight:600;">${p.value.toFixed(1)}%</span>
            </div>`;
          }
        });
        content += "</div>";
        return content;
      },
    },
    legend: {
      show: false,
    },
    grid: { left: 50, right: 20, bottom: 40, top: 20 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: chartData.xAxis,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: textColor,
        fontSize: 11,
        interval: Math.max(0, Math.floor(chartData.xAxis.length / 6) - 1),
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
      axisLabel: { color: textColor, fontSize: 11, formatter: "{value}%" },
    },
    series: chartData.series,
  }), [chartData, textColor, gridColor, tooltipBg, tooltipBorder, tooltipText]);

  if (isLoading || chartData.xAxis.length === 0) {
    return (
      <div className="h-[320px] flex items-center justify-center">
        {isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-[#00E0AA]" />
        ) : (
          <p className="text-muted-foreground text-sm">No chart data available</p>
        )}
      </div>
    );
  }

  return (
    <div className="h-[320px] p-4">
      <ReactECharts
        option={chartOption}
        style={{ height: "100%", width: "100%" }}
        opts={{ renderer: "svg" }}
      />
    </div>
  );
}

// ============================================
// MARKET LIST ITEM
// ============================================

function MarketListItem({
  market,
  rank,
  onClick,
}: {
  market: SmartMarketData;
  rank: number;
  onClick: () => void;
}) {
  const odds = market.crowdOdds * 100;
  const smartOdds = market.smartOdds !== null ? market.smartOdds * 100 : null;
  const divergence = market.delta ? market.delta * 100 : null;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors text-left group"
    >
      <span className="text-sm font-mono text-muted-foreground w-8">{rank}</span>

      {market.image ? (
        <img src={market.image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-muted flex-shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <p className="font-medium truncate group-hover:text-[#00E0AA] transition-colors">
          {market.shortName || market.question}
        </p>
        {market.question !== market.shortName && (
          <p className="text-sm text-muted-foreground truncate">{market.question}</p>
        )}
      </div>

      <div className="flex items-center gap-6 flex-shrink-0">
        <div className="text-right">
          <p className="text-lg font-mono font-bold">{odds.toFixed(0)}%</p>
          <p className="text-xs text-muted-foreground">Crowd</p>
        </div>

        {smartOdds !== null && (
          <div className="text-right">
            <p className="text-lg font-mono font-bold text-[#00E0AA]">{smartOdds.toFixed(0)}%</p>
            <p className="text-xs text-[#00E0AA]/70">Smart</p>
          </div>
        )}

        {divergence !== null && Math.abs(divergence) > 2 && (
          <div className={cn(
            "px-2 py-1 rounded-md text-xs font-medium",
            divergence > 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
          )}>
            {divergence > 0 ? "+" : ""}{divergence.toFixed(0)}pt
          </div>
        )}

        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-[#00E0AA] transition-colors" />
      </div>
    </button>
  );
}

export default EventPageV5;
