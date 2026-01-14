"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useQueries } from "@tanstack/react-query";
import { useSmartMoneySignals, SmartMoneySignalPoint } from "@/hooks/use-smart-money-signals";
import { SmartMoneyBreakdownComponent } from "@/components/smart-money-breakdown";
import { MarketSmartMoneyWidget } from "@/components/market-smart-money-widget";
import {
  Loader2,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  DollarSign,
  TrendingUp,
  Clock,
  LayoutGrid,
  BarChart3,
  FileText,
  Wallet,
  GitBranch,
  PieChart,
  BookOpen,
  Link2,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEventSmartSummary, type SmartMarketData, type Market } from "./hooks/use-event-smart-summary";
import { MarketDetailPanel } from "./market-detail-panel";

// Dynamically import ECharts to avoid SSR issues
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// ============================================
// CONSTANTS
// ============================================

const OUTCOME_COLORS = [
  "#22d3ee", "#f472b6", "#a78bfa", "#34d399", "#fbbf24",
  "#fb7185", "#60a5fa", "#4ade80", "#f97316", "#c084fc",
];

const SMART_MONEY_COLOR = "#00E0AA";
const CHART_HEIGHT = 340;

// Tab configurations
type EventSectionKey = "overview" | "smart-money" | "markets" | "statistics";

const eventSections: { key: EventSectionKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { key: "smart-money", label: "Smart Money", icon: <Wallet className="w-3.5 h-3.5" /> },
  { key: "markets", label: "All Markets", icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  { key: "statistics", label: "Statistics", icon: <PieChart className="w-3.5 h-3.5" /> },
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
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shortenTitle(title: string, maxLen: number): string {
  const cleaned = title
    .replace(/^Will\s+/i, "")
    .replace(/\?$/g, "")
    .replace(/\s+in\s+\d{4}$/i, "")
    .replace(/\s+on\s+\w+\s+\d+\??$/i, "")
    .replace(/\s+by\s+market\s+cap$/i, "")
    .replace(/\s+by\s+end\s+of\s+\d{4}\??$/i, "");
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen - 3) + "..." : cleaned;
}

function getYesTokenId(clobTokenIds: string | undefined): string | null {
  if (!clobTokenIds) return null;
  try {
    const tokens = JSON.parse(clobTokenIds);
    if (Array.isArray(tokens) && tokens[0]) return tokens[0];
  } catch {
    // ignore
  }
  return null;
}

// Fetch OHLC data for a market
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

interface MarketLineData {
  id: string;
  conditionId: string;
  name: string;
  fullName: string;
  color: string;
  probability: number;
  visible: boolean;
  priceHistory: Array<{ timestamp: number; price: number }>;
  image?: string;
}

interface EventPageV3Props {
  eventSlug: string;
}

// ============================================
// MAIN COMPONENT
// ============================================

export function EventPageV3({ eventSlug }: EventPageV3Props) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const { event, smartPrediction, markets, isLoading, error } = useEventSmartSummary(eventSlug);
  const [selectedMarket, setSelectedMarket] = useState<SmartMarketData | null>(null);
  const [focusedMarket, setFocusedMarket] = useState<SmartMarketData | null>(null);
  const [viewMode, setViewMode] = useState<"event" | "market">("event");
  const [timeRange, setTimeRange] = useState<"1W" | "1M" | "3M" | "ALL">("1M");
  const [activeSection, setActiveSection] = useState<EventSectionKey>("overview");
  const [visibleMarkets, setVisibleMarkets] = useState<Set<string>>(new Set());

  // Initialize visible markets - sort by probability first to get the top markets
  useEffect(() => {
    if (markets.length > 0 && visibleMarkets.size === 0) {
      const sortedByProb = [...markets].sort((a, b) => b.crowdOdds - a.crowdOdds);
      const initial = new Set<string>();
      sortedByProb.slice(0, 6).forEach((m) => initial.add(m.id));
      setVisibleMarkets(initial);
    }
  }, [markets, visibleMarkets.size]);

  // Fetch OHLC data for all markets
  const ohlcQueries = useQueries({
    queries: markets.map((market) => {
      const tokenId = getYesTokenId(market.clobTokenIds);
      return {
        queryKey: ["market-ohlc-v3", tokenId || market.id],
        queryFn: () => fetchMarketOHLC(tokenId),
        enabled: !!tokenId,
        staleTime: 10 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
      };
    }),
  });

  const isLoadingOHLC = ohlcQueries.some((q) => q.isLoading);

  // Build market line data
  const marketLineData = useMemo(() => {
    const lines: MarketLineData[] = [];
    const now = Math.floor(Date.now() / 1000);
    const ranges: Record<string, number> = {
      "1W": 7 * 24 * 60 * 60,
      "1M": 30 * 24 * 60 * 60,
      "3M": 90 * 24 * 60 * 60,
      "ALL": 365 * 24 * 60 * 60,
    };
    const cutoff = now - (ranges[timeRange] || ranges["1M"]);

    markets.forEach((market, idx) => {
      const queryResult = ohlcQueries[idx];
      const ohlcData: Array<{ t: number; c: number }> = queryResult?.data || [];
      const filteredOhlc = ohlcData.filter((d) => d.t >= cutoff);

      lines.push({
        id: market.id,
        conditionId: market.conditionId,
        name: shortenTitle(market.question, 25),
        fullName: market.question,
        color: OUTCOME_COLORS[idx % OUTCOME_COLORS.length],
        probability: market.crowdOdds,
        visible: visibleMarkets.has(market.id),
        priceHistory: filteredOhlc.map((p) => ({ timestamp: p.t, price: p.c })),
        image: market.image,
      });
    });

    return lines.sort((a, b) => b.probability - a.probability);
  }, [markets, ohlcQueries, visibleMarkets, timeRange]);

  // Sorted markets for the navigator (same order as chart)
  const sortedMarkets = useMemo(() => {
    const marketMap = new Map(markets.map(m => [m.id, m]));
    return marketLineData
      .map(line => marketMap.get(line.id))
      .filter((m): m is SmartMarketData => m !== undefined);
  }, [markets, marketLineData]);

  // Handlers
  const handleMarketClick = useCallback((market: SmartMarketData) => {
    setFocusedMarket(market);
    setViewMode("market");
  }, []);

  const handleBackToEvent = useCallback(() => {
    setFocusedMarket(null);
    setViewMode("event");
  }, []);

  const handleOpenDetailPanel = useCallback((market: SmartMarketData) => {
    setSelectedMarket(market);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedMarket(null);
  }, []);

  // Loading state
  if (isLoading && !event.title) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
          <p className="text-sm text-muted-foreground">Loading event intelligence...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-8 w-8 text-rose-500" />
          <div>
            <h3 className="font-semibold">Failed to load event</h3>
            <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] p-2">
      <div className="flex h-full overflow-hidden rounded-xl border border-border bg-background">
        {/* MAIN CONTENT AREA */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex-shrink-0 px-5 pt-3 pb-2 bg-background z-20 relative border-b border-border">
            {viewMode === "event" ? (
              <EventHeaderSection event={event} />
            ) : (
              <MarketHeaderSection
                market={focusedMarket!}
                onBack={handleBackToEvent}
                eventTitle={event.title}
              />
            )}
          </div>

          {/* Chart + Navigator Area */}
          <div className="flex-1 relative overflow-hidden px-5 pt-3">
            <div className={cn(
              "h-[${CHART_HEIGHT}px] bg-card border border-border rounded-lg overflow-hidden flex",
              "shadow-sm"
            )} style={{ height: `${CHART_HEIGHT}px` }}>
              {/* Market Navigator - Left sidebar inside chart card */}
              <div className="w-56 flex-shrink-0 border-r border-border flex flex-col bg-muted/30">
                <div className="px-3 py-2 border-b border-border flex items-center justify-between bg-muted/50">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Markets</span>
                  <span className="text-[10px] font-mono text-[#00E0AA]">{markets.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {sortedMarkets.map((market, index) => {
                    const lineData = marketLineData[index];
                    const isFocused = focusedMarket?.id === market.id;
                    const lineColor = lineData?.color || OUTCOME_COLORS[index % OUTCOME_COLORS.length];
                    const yesPrice = market.crowdOdds;

                    return (
                      <div
                        key={market.id}
                        onClick={() => handleMarketClick(market)}
                        className={cn(
                          "px-2 py-1.5 cursor-pointer transition-all border-b border-border/50 group",
                          isFocused
                            ? "bg-[#00E0AA]/10"
                            : "hover:bg-muted/50"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {/* Market Thumbnail */}
                          <div className={cn(
                            "w-8 h-8 flex-shrink-0 rounded overflow-hidden border",
                            isFocused ? "border-[#00E0AA]" : "border-border"
                          )}>
                            {market.image ? (
                              <img src={market.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-muted flex items-center justify-center">
                                <span className="text-[8px] font-bold text-muted-foreground">{index + 1}</span>
                              </div>
                            )}
                          </div>
                          {/* Market Info */}
                          <div className="flex-1 min-w-0">
                            <p className={cn(
                              "text-[10px] leading-tight line-clamp-2",
                              isFocused ? "text-[#00E0AA] font-medium" : "text-foreground"
                            )}>
                              {shortenTitle(market.question, 40)}
                            </p>
                            {/* Visual Probability Bar */}
                            <div className="mt-1 flex items-center gap-1.5">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-300"
                                  style={{
                                    width: `${yesPrice * 100}%`,
                                    backgroundColor: lineColor
                                  }}
                                />
                              </div>
                              <span className={cn(
                                "text-[9px] font-mono font-semibold tabular-nums",
                                isFocused ? "text-[#00E0AA]" : "text-muted-foreground"
                              )}>
                                {(yesPrice * 100).toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Chart Area */}
              <div className="flex-1 flex flex-col p-3">
                {viewMode === "event" ? (
                  <MultiMarketChart
                    marketLineData={marketLineData}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                    isLoading={isLoadingOHLC}
                    isDark={isDark}
                  />
                ) : (
                  <SingleMarketChart
                    market={focusedMarket!}
                    marketLineData={marketLineData.find((m) => m.id === focusedMarket?.id) || null}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                    isDark={isDark}
                  />
                )}
              </div>
            </div>

            {/* Tabbed Content Below Chart */}
            <div className="mt-4 flex-1 overflow-hidden">
              <div className="h-full flex flex-col border border-border rounded-lg bg-card overflow-hidden">
                {/* Tab Header */}
                <div className="flex-shrink-0 flex items-center border-b border-border bg-muted/30">
                  <div className="flex overflow-x-auto scrollbar-hide">
                    {eventSections.map((section) => (
                      <button
                        key={section.key}
                        onClick={() => setActiveSection(section.key)}
                        className={cn(
                          "relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-all duration-150",
                          activeSection === section.key
                            ? "text-[#00E0AA]"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {section.icon}
                        <span>{section.label}</span>
                        {activeSection === section.key && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00E0AA]" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto p-4">
                  {activeSection === "overview" && (
                    <OverviewSection
                      markets={sortedMarkets}
                      smartPrediction={smartPrediction}
                      onMarketClick={handleOpenDetailPanel}
                    />
                  )}
                  {activeSection === "smart-money" && (
                    <SmartMoneySection
                      market={focusedMarket || sortedMarkets[0]}
                    />
                  )}
                  {activeSection === "markets" && (
                    <AllMarketsSection
                      markets={sortedMarkets}
                      onMarketClick={handleOpenDetailPanel}
                    />
                  )}
                  {activeSection === "statistics" && (
                    <StatisticsSection markets={sortedMarkets} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Slide-over Panel for Market Detail */}
      {selectedMarket && (
        <MarketDetailPanel
          market={selectedMarket}
          onClose={handleClosePanel}
        />
      )}
    </div>
  );
}

// ============================================
// EVENT HEADER SECTION
// ============================================

function EventHeaderSection({ event }: { event: { title: string; category: string; totalVolume: number; marketCount: number; closesAt: string } }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1 text-xs">
        <Link href="/events" className="text-muted-foreground hover:text-[#00E0AA] transition-colors">Events</Link>
        <ChevronRight className="w-3 h-3 text-muted-foreground" />
        <span className="text-[#00E0AA] font-medium">Event Overview</span>
        <span className="ml-auto px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-[#00E0AA]/10 text-[#00E0AA] rounded">
          LIVE
        </span>
      </div>
      <h1 className="text-lg font-bold tracking-tight truncate flex-1">
        {event.title}
      </h1>
      <div className="flex items-center gap-4 text-xs mt-1">
        <div className="flex items-center gap-1 text-muted-foreground">
          <DollarSign className="w-3 h-3" />
          <span className="font-mono font-semibold tabular-nums">{formatVolume(event.totalVolume)}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <LayoutGrid className="w-3 h-3" />
          <span className="font-mono font-semibold tabular-nums">{event.marketCount}</span>
          <span className="text-[10px]">markets</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span className="font-mono font-semibold tabular-nums">{formatDate(event.closesAt)}</span>
        </div>
      </div>
    </>
  );
}

// ============================================
// MARKET HEADER SECTION
// ============================================

function MarketHeaderSection({
  market,
  onBack,
  eventTitle,
}: {
  market: SmartMarketData;
  onBack: () => void;
  eventTitle: string;
}) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1 text-xs">
        <Link href="/events" className="text-muted-foreground hover:text-[#00E0AA] transition-colors">Events</Link>
        <ChevronRight className="w-3 h-3 text-muted-foreground" />
        <button onClick={onBack} className="text-muted-foreground hover:text-[#00E0AA] transition-colors max-w-[200px] truncate">
          {shortenTitle(eventTitle, 30)}
        </button>
        <ChevronRight className="w-3 h-3 text-muted-foreground" />
        <span className="text-[#00E0AA] font-medium">Market</span>
        <span className="ml-auto px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 rounded">
          ACTIVE
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 p-1.5 -ml-1.5 text-muted-foreground hover:text-[#00E0AA] hover:bg-[#00E0AA]/10 rounded transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-base font-bold tracking-tight truncate flex-1">
          {market.question}
        </h1>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10">
            <span className="text-[10px] text-emerald-500 font-medium">YES</span>
            <span className="text-sm font-mono font-bold text-emerald-500">{(market.crowdOdds * 100).toFixed(0)}%</span>
          </div>
          {market.smartOdds !== null && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-[#00E0AA]/10">
              <span className="text-[10px] text-[#00E0AA] font-medium">SMART</span>
              <span className="text-sm font-mono font-bold text-[#00E0AA]">{(market.smartOdds * 100).toFixed(0)}%</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ============================================
// MULTI MARKET CHART
// ============================================

interface MultiMarketChartProps {
  marketLineData: MarketLineData[];
  timeRange: "1W" | "1M" | "3M" | "ALL";
  onTimeRangeChange: (range: "1W" | "1M" | "3M" | "ALL") => void;
  isLoading: boolean;
  isDark: boolean;
}

function MultiMarketChart({ marketLineData, timeRange, onTimeRangeChange, isLoading, isDark }: MultiMarketChartProps) {
  const visibleLines = marketLineData.filter((m) => m.visible);
  const leadingMarket = visibleLines[0];

  // Fetch smart money signals for the leading market
  const daysMap = { "1W": 7, "1M": 30, "3M": 90, "ALL": 90 };
  const { data: smartMoneyData } = useSmartMoneySignals(leadingMarket?.conditionId || "", daysMap[timeRange]);

  const { xAxisData, chartSeries, yAxisRange, smartMoneyLine, latestDivergence } = useMemo(() => {
    // Collect all timestamps from OHLC data
    const allTimestamps = new Set<number>();
    visibleLines.forEach((m) => {
      m.priceHistory.forEach((p) => allTimestamps.add(p.timestamp));
    });

    // Also add smart money timestamps (convert from ms to seconds)
    if (smartMoneyData?.history) {
      for (const point of smartMoneyData.history) {
        // Smart money timestamps are in milliseconds, OHLC are in seconds
        const tsSeconds = Math.floor(point.timestamp / 1000);
        allTimestamps.add(tsSeconds);
      }
    }

    const sortedTs = Array.from(allTimestamps).sort((a, b) => a - b);

    let minVal = 100;
    let maxVal = 0;

    const series = visibleLines.map((market, idx) => {
      const tsMap = new Map(market.priceHistory.map((p) => [p.timestamp, p.price]));
      const data = sortedTs.map((ts) => {
        const price = tsMap.get(ts);
        if (price !== undefined) {
          const val = price * 100;
          minVal = Math.min(minVal, val);
          maxVal = Math.max(maxVal, val);
          return parseFloat(val.toFixed(1));
        }
        return null;
      });
      return {
        name: market.name,
        color: market.color,
        data,
        lineWidth: idx === 0 ? 2.5 : 2,
      };
    });

    const range = maxVal - minVal;
    const padding = Math.max(range * 0.15, 5);
    const yMin = Math.max(0, Math.floor((minVal - padding) / 5) * 5);
    const yMax = Math.min(100, Math.ceil((maxVal + padding) / 5) * 5);

    const formatDateUTC = (date: Date) => {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
    };

    const xDates = sortedTs.map((ts) => formatDateUTC(new Date(ts * 1000)));

    // Build smart money lookup by timestamp (seconds)
    const smartMoneyByTs = new Map<number, SmartMoneySignalPoint>();
    if (smartMoneyData?.history) {
      for (const point of smartMoneyData.history) {
        // Convert milliseconds to seconds for matching
        const tsSeconds = Math.floor(point.timestamp / 1000);
        smartMoneyByTs.set(tsSeconds, point);
      }
    }

    // Build smart money line using timestamp matching
    const smLine = sortedTs.map((ts) => {
      const point = smartMoneyByTs.get(ts);
      if (!point) return null;
      return Math.max(0, Math.min(100, point.smart_money_odds));
    });

    // Get latest divergence from smart money data
    let latestDiv = null;
    if (smartMoneyData?.history && smartMoneyData.history.length > 0) {
      const lastPoint = smartMoneyData.history[smartMoneyData.history.length - 1];
      latestDiv = lastPoint.divergence;
    }

    return {
      xAxisData: xDates,
      chartSeries: series,
      yAxisRange: { min: yMin, max: yMax },
      smartMoneyLine: smLine,
      latestDivergence: latestDiv,
    };
  }, [visibleLines, smartMoneyData]);

  const hasSmartMoney = smartMoneyLine.some((v) => v !== null);
  const textColor = isDark ? "#6b7280" : "#9ca3af";
  const gridColor = isDark ? "#374151" : "#f3f4f6";

  const chartOption = useMemo(() => {
    if (chartSeries.length === 0) return {};

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#1f2937" : "#ffffff",
        borderColor: isDark ? "#374151" : "#e5e7eb",
        textStyle: { color: isDark ? "#f3f4f6" : "#1f2937", fontSize: 12 },
      },
      legend: {
        type: "scroll",
        top: 0,
        right: 0,
        left: 100,
        textStyle: { color: isDark ? "#d1d5db" : "#6b7280", fontSize: 11 },
        itemWidth: 20,
        itemHeight: 3,
        formatter: (name: string) => name.length > 22 ? name.slice(0, 22) + '...' : name,
      },
      grid: { left: 50, right: hasSmartMoney ? 45 : 15, bottom: 35, top: 40, containLabel: false },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: xAxisData,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          show: true,
          interval: Math.floor(xAxisData.length / 5),
          color: textColor,
          fontSize: 10,
        },
      },
      yAxis: [
        {
          type: "value",
          min: yAxisRange.min,
          max: yAxisRange.max,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: gridColor, type: "dashed" as const } },
          axisLabel: { color: textColor, fontSize: 10, formatter: (value: number) => `${value}%` },
        },
        ...(hasSmartMoney ? [{
          type: "value",
          min: 0,
          max: 100,
          position: "right",
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { color: SMART_MONEY_COLOR, fontSize: 10, formatter: (value: number) => `${value}%` },
        }] : []),
      ],
      series: [
        // Market price lines
        ...chartSeries.map((s, idx) => ({
          name: s.name,
          type: "line" as const,
          smooth: true,
          symbol: "none",
          data: s.data,
          lineStyle: { width: s.lineWidth, color: s.color },
          emphasis: { focus: "series" as const, lineStyle: { width: 3 } },
          connectNulls: true,
          ...(idx === 0 ? {
            areaStyle: {
              color: {
                type: "linear",
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: `${s.color}30` },
                  { offset: 1, color: `${s.color}00` },
                ],
              },
            },
          } : {}),
        })),
        // Smart money line
        ...(hasSmartMoney ? [{
          name: leadingMarket ? `Smart $ (${leadingMarket.name})` : "Smart Money",
          type: "line" as const,
          smooth: true,
          symbol: "none",
          data: smartMoneyLine,
          yAxisIndex: 1,
          lineStyle: { width: 2.5, color: SMART_MONEY_COLOR, type: "solid" as const },
          emphasis: { focus: "series" as const, lineStyle: { width: 3.5 } },
          connectNulls: true,
        }] : []),
      ],
    };
  }, [chartSeries, xAxisData, yAxisRange, smartMoneyLine, hasSmartMoney, leadingMarket, textColor, gridColor, isDark]);

  return (
    <>
      <div className="flex items-center justify-between mb-1 flex-shrink-0">
        <div className="flex items-center gap-3">
          {leadingMarket && (
            <div className="flex items-center gap-2">
              <span className="text-xl font-mono font-bold tabular-nums">
                {(leadingMarket.probability * 100).toFixed(0)}%
              </span>
              <span className="text-xs font-medium text-[#00E0AA] truncate max-w-[140px]">
                {leadingMarket.name}
              </span>
            </div>
          )}
          {latestDivergence !== null && Math.abs(latestDivergence) > 5 && (
            <div className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
              latestDivergence > 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
            )}>
              {latestDivergence > 0 ? "+" : ""}{latestDivergence.toFixed(0)}% SM divergence
            </div>
          )}
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex gap-0.5 text-[10px]">
          {(["1W", "1M", "3M", "ALL"] as const).map((range) => (
            <button
              key={range}
              onClick={() => onTimeRangeChange(range)}
              className={cn(
                "px-1.5 py-0.5 rounded transition-colors",
                range === timeRange
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {xAxisData.length > 0 ? (
          <ReactECharts option={chartOption} style={{ height: "100%", width: "100%" }} opts={{ renderer: "svg" }} />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            {isLoading ? "Loading..." : "No chart data"}
          </div>
        )}
      </div>
    </>
  );
}

// ============================================
// SINGLE MARKET CHART
// ============================================

interface SingleMarketChartProps {
  market: SmartMarketData;
  marketLineData: MarketLineData | null;
  timeRange: "1W" | "1M" | "3M" | "ALL";
  onTimeRangeChange: (range: "1W" | "1M" | "3M" | "ALL") => void;
  isDark: boolean;
}

function SingleMarketChart({ market, marketLineData, timeRange, onTimeRangeChange, isDark }: SingleMarketChartProps) {
  const daysMap = { "1W": 7, "1M": 30, "3M": 90, "ALL": 90 };
  const { data: smartMoneyData } = useSmartMoneySignals(market.conditionId || "", daysMap[timeRange]);

  const { xAxisData, yesData, smartMoneyLine, latestSmartMoney, latestDivergence } = useMemo(() => {
    if (!marketLineData || marketLineData.priceHistory.length === 0) {
      return { xAxisData: [], yesData: [], smartMoneyLine: [], latestSmartMoney: null, latestDivergence: null };
    }

    const sorted = [...marketLineData.priceHistory].sort((a, b) => a.timestamp - b.timestamp);

    const formatDateUTC = (date: Date) => {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
    };

    const smartMoneyByDate = new Map<string, SmartMoneySignalPoint>();
    if (smartMoneyData?.history) {
      for (const point of smartMoneyData.history) {
        const dateStr = formatDateUTC(new Date(point.timestamp));
        smartMoneyByDate.set(dateStr, point);
      }
    }

    const xAxis = sorted.map((p) => formatDateUTC(new Date(p.timestamp * 1000)));
    const smLine = xAxis.map((dateStr) => {
      const point = smartMoneyByDate.get(dateStr);
      if (!point) return null;
      return Math.max(0, Math.min(100, point.smart_money_odds));
    });

    let latestSM = null;
    let latestDiv = null;
    for (let i = smLine.length - 1; i >= 0; i--) {
      if (smLine[i] !== null && latestSM === null) latestSM = smLine[i];
      const dateStr = xAxis[i];
      const point = smartMoneyByDate.get(dateStr);
      if (point?.divergence !== undefined && latestDiv === null) latestDiv = point.divergence;
      if (latestSM !== null && latestDiv !== null) break;
    }

    return {
      xAxisData: xAxis,
      yesData: sorted.map((p) => parseFloat((p.price * 100).toFixed(1))),
      smartMoneyLine: smLine,
      latestSmartMoney: latestSM,
      latestDivergence: latestDiv,
    };
  }, [marketLineData, smartMoneyData]);

  const hasSmartMoney = smartMoneyLine.some((v) => v !== null);
  const textColor = isDark ? "#6b7280" : "#9ca3af";
  const gridColor = isDark ? "#374151" : "#f3f4f6";
  const yesColor = "#00E0AA";

  const chartOption = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: isDark ? "#1f2937" : "#ffffff",
      borderColor: isDark ? "#374151" : "#e5e7eb",
      textStyle: { color: isDark ? "#f3f4f6" : "#1f2937", fontSize: 12 },
    },
    legend: {
      data: ["Crowd Odds", ...(hasSmartMoney ? ["Smart Money"] : [])],
      top: 0,
      right: 10,
      textStyle: { color: isDark ? "#d1d5db" : "#6b7280", fontSize: 11 },
      itemWidth: 16,
      itemHeight: 3,
    },
    grid: { left: 45, right: 15, bottom: 30, top: 35, containLabel: false },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: xAxisData,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        show: true,
        interval: Math.floor(xAxisData.length / 5),
        color: textColor,
        fontSize: 10,
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: gridColor, type: "dashed" as const } },
      axisLabel: { color: textColor, fontSize: 10, formatter: (value: number) => `${value}%` },
    },
    series: [
      {
        name: "Crowd Odds",
        type: "line",
        smooth: true,
        symbol: "none",
        data: yesData,
        lineStyle: { width: 2.5, color: yesColor },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(0, 224, 170, 0.2)" },
              { offset: 1, color: "rgba(0, 224, 170, 0)" },
            ],
          },
        },
      },
      ...(hasSmartMoney ? [{
        name: "Smart Money",
        type: "line",
        smooth: true,
        symbol: "none",
        data: smartMoneyLine,
        lineStyle: { width: 2.5, color: "#22d3ee", type: "solid" as const },
        connectNulls: true,
      }] : []),
    ],
  }), [xAxisData, yesData, smartMoneyLine, hasSmartMoney, textColor, gridColor, isDark]);

  return (
    <>
      <div className="flex items-center justify-between mb-1 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00E0AA]" />
            <span className="text-lg font-mono font-bold tabular-nums text-[#00E0AA]">
              {(market.crowdOdds * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] text-muted-foreground">Crowd</span>
          </div>
          {latestSmartMoney !== null && (
            <div className="flex items-center gap-1.5 border-l border-border pl-4">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
              <span className="text-lg font-mono font-bold tabular-nums text-cyan-400">
                {latestSmartMoney.toFixed(0)}%
              </span>
              <span className="text-[10px] text-muted-foreground">Smart $</span>
            </div>
          )}
          {latestDivergence !== null && Math.abs(latestDivergence) > 5 && (
            <div className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
              latestDivergence > 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
            )}>
              {latestDivergence > 0 ? "+" : ""}{latestDivergence.toFixed(0)}% div
            </div>
          )}
        </div>
        <div className="flex gap-0.5 text-[10px]">
          {(["1W", "1M", "3M", "ALL"] as const).map((range) => (
            <button
              key={range}
              onClick={() => onTimeRangeChange(range)}
              className={cn(
                "px-1.5 py-0.5 rounded transition-colors",
                range === timeRange
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {xAxisData.length > 0 ? (
          <ReactECharts option={chartOption} style={{ height: "100%", width: "100%" }} opts={{ renderer: "svg" }} />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        )}
      </div>
    </>
  );
}

// ============================================
// TAB SECTIONS
// ============================================

function OverviewSection({
  markets,
  smartPrediction,
  onMarketClick,
}: {
  markets: SmartMarketData[];
  smartPrediction: { topOutcome: SmartMarketData | null; rankings: SmartMarketData[] };
  onMarketClick: (market: SmartMarketData) => void;
}) {
  const topMarkets = markets.slice(0, 6);
  const { topOutcome } = smartPrediction;

  return (
    <div className="space-y-4">
      {/* Smart Prediction Highlight */}
      {topOutcome && (
        <div className="p-4 bg-[#00E0AA]/5 border border-[#00E0AA]/20 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-4 w-4 text-[#00E0AA]" />
            <span className="text-sm font-semibold text-[#00E0AA]">Smart Money Prediction</span>
          </div>
          <div className="flex items-center gap-4">
            {topOutcome.image && (
              <div className="w-12 h-12 rounded-lg overflow-hidden border border-[#00E0AA]/30">
                <img src={topOutcome.image} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex-1">
              <h3 className="font-semibold">{topOutcome.shortName}</h3>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-lg font-mono font-bold text-[#00E0AA]">
                  {topOutcome.smartOdds !== null ? `${(topOutcome.smartOdds * 100).toFixed(0)}%` : "—"}
                </span>
                <span className="text-sm text-muted-foreground">Smart Money Odds</span>
                {topOutcome.delta !== null && (
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded",
                    topOutcome.delta > 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                  )}>
                    {topOutcome.delta >= 0 ? "+" : ""}{(topOutcome.delta * 100).toFixed(0)}pt vs crowd
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => onMarketClick(topOutcome)}
              className="px-3 py-1.5 text-xs font-medium bg-[#00E0AA] text-black rounded hover:bg-[#00E0AA]/90 transition-colors"
            >
              View Details
            </button>
          </div>
        </div>
      )}

      {/* Probability Overview */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Probability Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {topMarkets.map((market, idx) => (
            <div
              key={market.id}
              onClick={() => onMarketClick(market)}
              className="p-3 bg-card border border-border rounded-lg cursor-pointer hover:border-[#00E0AA]/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                {market.image ? (
                  <img src={market.image} alt="" className="w-6 h-6 rounded object-cover" />
                ) : (
                  <div className="w-6 h-6 rounded bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground">
                    {idx + 1}
                  </div>
                )}
                <span className="text-xs font-medium truncate flex-1">{market.shortName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-lg font-mono font-bold">{(market.crowdOdds * 100).toFixed(0)}%</span>
                {market.smartOdds !== null && market.delta !== null && (
                  <span className={cn(
                    "text-[10px] px-1 py-0.5 rounded",
                    market.delta > 0.05 ? "bg-emerald-500/10 text-emerald-500" :
                    market.delta < -0.05 ? "bg-rose-500/10 text-rose-500" : "bg-muted text-muted-foreground"
                  )}>
                    {market.delta >= 0 ? "+" : ""}{(market.delta * 100).toFixed(0)}pt
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SmartMoneySection({ market }: { market: SmartMarketData | null }) {
  if (!market) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>Select a market to view smart money analysis</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Wallet className="h-5 w-5 text-[#00E0AA]" />
        <h3 className="font-semibold">Smart Money Analysis for {market.shortName}</h3>
      </div>

      {market.conditionId && (
        <>
          <MarketSmartMoneyWidget marketId={market.id} />
          <SmartMoneyBreakdownComponent conditionId={market.conditionId} />
        </>
      )}

      {!market.conditionId && (
        <div className="text-center py-8 text-muted-foreground">
          <Clock className="h-8 w-8 mx-auto mb-2 text-amber-500" />
          <p>Smart money data is being collected for this market</p>
        </div>
      )}
    </div>
  );
}

function AllMarketsSection({
  markets,
  onMarketClick,
}: {
  markets: SmartMarketData[];
  onMarketClick: (market: SmartMarketData) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold mb-3">All Markets ({markets.length})</h3>
      <div className="space-y-2">
        {markets.map((market, idx) => (
          <div
            key={market.id}
            onClick={() => onMarketClick(market)}
            className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg cursor-pointer hover:border-[#00E0AA]/50 transition-colors"
          >
            <span className="text-xs font-mono text-muted-foreground w-6">#{idx + 1}</span>
            {market.image ? (
              <img src={market.image} alt="" className="w-8 h-8 rounded object-cover" />
            ) : (
              <div className="w-8 h-8 rounded bg-muted" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{market.shortName}</p>
              <p className="text-xs text-muted-foreground truncate">{market.question}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="text-right">
                <p className="text-sm font-mono font-bold">{(market.crowdOdds * 100).toFixed(0)}%</p>
                <p className="text-[10px] text-muted-foreground">Crowd</p>
              </div>
              {market.smartOdds !== null && (
                <div className="text-right">
                  <p className="text-sm font-mono font-bold text-[#00E0AA]">{(market.smartOdds * 100).toFixed(0)}%</p>
                  <p className="text-[10px] text-[#00E0AA]">Smart</p>
                </div>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatisticsSection({ markets }: { markets: SmartMarketData[] }) {
  const stats = useMemo(() => {
    const withSmartMoney = markets.filter(m => m.smartOdds !== null);
    const bullish = withSmartMoney.filter(m => m.signal === "BULLISH").length;
    const bearish = withSmartMoney.filter(m => m.signal === "BEARISH").length;
    const totalInvested = markets.reduce((sum, m) => sum + m.totalInvested, 0);
    const totalSF = markets.reduce((sum, m) => sum + m.superforecasterCount, 0);

    return { withSmartMoney: withSmartMoney.length, bullish, bearish, totalInvested, totalSF };
  }, [markets]);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold mb-3">Event Statistics</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-card border border-border rounded-lg text-center">
          <p className="text-2xl font-mono font-bold">{markets.length}</p>
          <p className="text-xs text-muted-foreground">Total Markets</p>
        </div>
        <div className="p-4 bg-card border border-border rounded-lg text-center">
          <p className="text-2xl font-mono font-bold text-[#00E0AA]">{stats.withSmartMoney}</p>
          <p className="text-xs text-muted-foreground">With Smart Money Data</p>
        </div>
        <div className="p-4 bg-card border border-border rounded-lg text-center">
          <p className="text-2xl font-mono font-bold">{formatVolume(stats.totalInvested)}</p>
          <p className="text-xs text-muted-foreground">Smart Money Invested</p>
        </div>
        <div className="p-4 bg-card border border-border rounded-lg text-center">
          <p className="text-2xl font-mono font-bold">{stats.totalSF}</p>
          <p className="text-xs text-muted-foreground">Superforecasters</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-500" />
            <span className="text-lg font-bold text-emerald-500">{stats.bullish}</span>
          </div>
          <p className="text-xs text-emerald-500/80 mt-1">Bullish Signals</p>
        </div>
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-rose-500 rotate-180" />
            <span className="text-lg font-bold text-rose-500">{stats.bearish}</span>
          </div>
          <p className="text-xs text-rose-500/80 mt-1">Bearish Signals</p>
        </div>
      </div>
    </div>
  );
}

export default EventPageV3;
