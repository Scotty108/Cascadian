"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import { useQueries } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { usePolymarketEventDetail } from "@/hooks/use-polymarket-event-detail";
import { DeepResearchCopilot } from "./deep-research-copilot";
import {
  AlertCircle,
  TrendingUp,
  Users,
  DollarSign,
  Clock,
  FileText,
  Wallet,
  Lightbulb,
  PieChart,
  Expand,
  MoreVertical,
  X,
  ExternalLink,
  ChevronRight,
  BarChart3,
  GitBranch,
  LayoutGrid,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";

// ============================================
// CONSTANTS
// ============================================

const CORNER_STYLE: "rounded" | "sharp" = "sharp";

const OUTCOME_COLORS = [
  "#22d3ee", "#f472b6", "#a78bfa", "#34d399", "#fbbf24",
  "#fb7185", "#60a5fa", "#4ade80", "#f97316", "#c084fc",
];

// ============================================
// TYPES
// ============================================

interface Market {
  id: string;
  question: string;
  description?: string;
  active: boolean;
  closed: boolean;
  outcomes: string[] | string;
  outcomePrices: string;
  image?: string;
  slug?: string;
  clobTokenIds?: string; // JSON string array of token IDs for OHLC
  conditionId?: string;
}

interface OHLCDataPoint {
  t: number;
  c: number;
}

interface OutcomeData {
  id: string;
  marketId: string;
  marketTitle: string;
  outcome: string;
  color: string;
  probability: number;
  priceHistory: Array<{ timestamp: number; probability: number }>;
  visible: boolean;
}

type SectionKey = "overview" | "analysis" | "smart-money" | "markets" | "correlations" | "statistics";

const sections: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { key: "analysis", label: "Analysis", icon: <FileText className="w-3.5 h-3.5" /> },
  { key: "smart-money", label: "Smart Money", icon: <Wallet className="w-3.5 h-3.5" /> },
  { key: "markets", label: "All Markets", icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  { key: "correlations", label: "Domino Effects", icon: <GitBranch className="w-3.5 h-3.5" /> },
  { key: "statistics", label: "Statistics", icon: <PieChart className="w-3.5 h-3.5" /> },
];

interface EventIntelligenceDashboardProps {
  eventSlug: string;
}

// ============================================
// MAIN COMPONENT
// ============================================

export function EventIntelligenceDashboard({ eventSlug }: EventIntelligenceDashboardProps) {
  const [isCopilotOpen, setIsCopilotOpen] = useState(true);
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [visibleMarkets, setVisibleMarkets] = useState<Set<string>>(new Set());
  const [timeRange, setTimeRange] = useState<"1W" | "1M" | "3M" | "ALL">("1M");

  const innerScrollRef = useRef<HTMLDivElement>(null);

  const sectionRefs = useRef<Record<SectionKey, HTMLDivElement | null>>({
    overview: null,
    analysis: null,
    "smart-money": null,
    markets: null,
    correlations: null,
    statistics: null,
  });

  const { event, isLoading, error } = usePolymarketEventDetail(eventSlug);
  const markets = useMemo(() => event?.markets || [], [event]);

  // Initialize visible markets
  useEffect(() => {
    if (markets.length > 0 && visibleMarkets.size === 0) {
      const initial = new Set<string>();
      markets.slice(0, 6).forEach((m) => initial.add(m.id));
      setVisibleMarkets(initial);
    }
  }, [markets, visibleMarkets.size]);

  // Fetch OHLC data for visible markets using clobTokenIds (YES token)
  const ohlcQueries = useQueries({
    queries: markets.map((market) => {
      // Parse clobTokenIds to get the YES token ID (first in array)
      let tokenId = market.id; // fallback
      try {
        if (market.clobTokenIds) {
          const tokens = JSON.parse(market.clobTokenIds);
          if (tokens[0]) tokenId = tokens[0];
        }
      } catch {
        // Use fallback
      }

      return {
        queryKey: ["market-ohlc-dash", tokenId, timeRange],
        queryFn: async () => {
          // Use interval=max without timestamp params (CLOB API doesn't support them with max)
          const response = await fetch(`/api/polymarket/ohlc/${tokenId}?interval=max`);
          if (!response.ok) return { data: [], marketId: market.id };
          const result = await response.json();

          // Filter data client-side based on timeRange
          const now = Math.floor(Date.now() / 1000);
          const ranges: Record<string, number> = {
            "1W": 7 * 24 * 60 * 60,
            "1M": 30 * 24 * 60 * 60,
            "3M": 90 * 24 * 60 * 60,
            "ALL": 365 * 24 * 60 * 60,
          };
          const cutoff = now - (ranges[timeRange] || ranges["1M"]);
          const filteredData = (result.data || []).filter((d: { t: number }) => d.t >= cutoff);

          return { data: filteredData, marketId: market.id };
        },
        staleTime: 2 * 60 * 1000,
        retry: 1,
        enabled: visibleMarkets.has(market.id),
      };
    }),
  });

  const isLoadingOHLC = ohlcQueries.some((q, idx) => q.isLoading && visibleMarkets.has(markets[idx]?.id || ""));

  // Build outcome data
  const outcomeData = useMemo(() => {
    const outcomes: OutcomeData[] = [];
    let colorIndex = 0;

    markets.forEach((market, marketIndex) => {
      const queryResult = ohlcQueries[marketIndex];
      const ohlcData = queryResult.data?.data || [];

      let prices: number[] = [];
      try {
        const parsed = JSON.parse(market.outcomePrices || "[]");
        prices = parsed.map((p: string | number) => (typeof p === "string" ? parseFloat(p) : p));
      } catch {
        prices = [];
      }

      outcomes.push({
        id: market.id,
        marketId: market.id,
        marketTitle: market.question,
        outcome: shortenTitle(market.question, 30),
        color: OUTCOME_COLORS[colorIndex % OUTCOME_COLORS.length],
        probability: prices[0] || 0,
        priceHistory: ohlcData.map((p: OHLCDataPoint) => ({
          timestamp: p.t,
          probability: p.c,
        })),
        visible: visibleMarkets.has(market.id),
      });
      colorIndex++;
    });

    return outcomes.sort((a, b) => b.probability - a.probability);
  }, [markets, ohlcQueries, visibleMarkets]);

  // Portal setup
  useEffect(() => {
    setPortalContainer(document.body);
  }, []);

  // Scroll spy
  useEffect(() => {
    const scrollContainer = innerScrollRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const containerTop = containerRect.top;

      let closestSection: SectionKey = "overview";
      let closestDistance = Infinity;

      (Object.keys(sectionRefs.current) as SectionKey[]).forEach((key) => {
        const sectionEl = sectionRefs.current[key];
        if (sectionEl) {
          const sectionRect = sectionEl.getBoundingClientRect();
          const distance = Math.abs(sectionRect.top - containerTop);

          if (sectionRect.top <= containerTop + 100 && distance < closestDistance) {
            closestDistance = distance;
            closestSection = key;
          }
        }
      });

      if (scrollContainer.scrollTop < 50) {
        closestSection = "overview";
      }

      setActiveSection(closestSection);
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = useCallback((key: SectionKey) => {
    const sectionEl = sectionRefs.current[key];
    const scrollContainer = innerScrollRef.current;
    if (sectionEl && scrollContainer) {
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const sectionTop = sectionEl.getBoundingClientRect().top;
      const offset = sectionTop - containerTop + scrollContainer.scrollTop;
      scrollContainer.scrollTo({ top: offset, behavior: "smooth" });
    }
  }, []);

  const toggleMarketVisibility = useCallback((marketId: string) => {
    setVisibleMarkets((prev) => {
      const next = new Set(prev);
      if (next.has(marketId)) {
        next.delete(marketId);
      } else {
        next.add(marketId);
      }
      return next;
    });
  }, []);

  if (isLoading) {
    return <DashboardLoadingState />;
  }

  if (error || !event) {
    return <DashboardErrorState error={error?.message || "Event not found"} eventSlug={eventSlug} />;
  }

  return (
    <div className="h-[calc(100vh-4rem)] p-2">
      <div className={`flex h-full overflow-hidden ${CORNER_STYLE === "rounded" ? "rounded-2xl" : "rounded-xl"} border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950`}>
        {/* Main Content Area - No internal scrolling on container */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Event Header */}
          <div className="flex-shrink-0 px-5 pt-3 pb-2 bg-zinc-50 dark:bg-zinc-950 z-20 relative">
            <EventHeader event={event} />
          </div>

          {/* Chart Area - Fixed height, markets on LEFT */}
          <div className="flex-shrink-0 px-5 py-2">
            <div className="flex gap-4 h-[320px]">
              {/* Market Legend Sidebar - LEFT SIDE */}
              <div className="w-56 flex-shrink-0">
                <MarketLegendCard
                  outcomeData={outcomeData}
                  onToggleVisibility={toggleMarketVisibility}
                />
              </div>
              {/* Main Chart */}
              <div className="flex-1 min-w-0">
                <RealProbabilityChart
                  outcomeData={outcomeData}
                  timeRange={timeRange}
                  onTimeRangeChange={setTimeRange}
                  isLoading={isLoadingOHLC}
                  onToggleVisibility={toggleMarketVisibility}
                />
              </div>
            </div>
          </div>

          {/* Analysis Card - Scrollable content area */}
          <div className="flex-1 overflow-hidden px-5 pb-3">
            <AnalysisCard
              scrollRef={innerScrollRef}
              sectionRefs={sectionRefs}
              activeSection={activeSection}
              onSectionClick={scrollToSection}
              event={event}
              markets={markets}
              outcomeData={outcomeData}
              onMarketClick={setSelectedMarket}
            />
          </div>
        </div>

        {/* Copilot Sidebar */}
        <DeepResearchCopilot
          isOpen={isCopilotOpen}
          onToggle={() => setIsCopilotOpen(!isCopilotOpen)}
        />
      </div>

      {/* Market Detail Modal */}
      {portalContainer && selectedMarket && createPortal(
        <MarketDetailModal
          market={selectedMarket}
          onClose={() => setSelectedMarket(null)}
        />,
        portalContainer
      )}
    </div>
  );
}

// ============================================
// EVENT HEADER
// ============================================

function EventHeader({ event }: { event: { title: string; category: string; volume?: number; volume24hr?: number; marketCount: number; endDate: string } }) {
  const categoryColors: Record<string, string> = {
    Politics: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    Sports: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    Crypto: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  };

  const formatVolume = (vol: number | undefined) => {
    if (!vol) return "$0";
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
    return `$${vol.toFixed(0)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100">
          {event.title}
        </h1>
        <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded">
          LIVE
        </span>
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${categoryColors[event.category] || "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
          {event.category}
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-zinc-500">
          <DollarSign className="w-3.5 h-3.5" />
          <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{formatVolume(event.volume)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-500">
          <TrendingUp className="w-3.5 h-3.5" />
          <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{formatVolume(event.volume24hr)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-500">
          <Users className="w-3.5 h-3.5" />
          <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{event.marketCount} markets</span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-500">
          <Clock className="w-3.5 h-3.5" />
          <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{formatDate(event.endDate)}</span>
        </div>
      </div>
    </>
  );
}

// ============================================
// REAL PROBABILITY CHART (Multi-line with real OHLC data)
// ============================================

interface RealProbabilityChartProps {
  outcomeData: OutcomeData[];
  timeRange: "1W" | "1M" | "3M" | "ALL";
  onTimeRangeChange: (range: "1W" | "1M" | "3M" | "ALL") => void;
  isLoading: boolean;
  onToggleVisibility: (marketId: string) => void;
}

function RealProbabilityChart({ outcomeData, timeRange, onTimeRangeChange, isLoading }: RealProbabilityChartProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const visibleOutcomes = outcomeData.filter((o) => o.visible);
  const leadingOutcome = visibleOutcomes[0];

  const { xAxisData, chartSeries } = useMemo(() => {
    const allTimestamps = new Set<number>();
    visibleOutcomes.forEach((o) => {
      o.priceHistory.forEach((p) => allTimestamps.add(p.timestamp));
    });

    const sortedTs = Array.from(allTimestamps).sort((a, b) => a - b);

    const series = visibleOutcomes.map((outcome) => {
      const tsMap = new Map(outcome.priceHistory.map((p) => [p.timestamp, p.probability]));
      return {
        name: outcome.outcome,
        color: outcome.color,
        data: sortedTs.map((ts) => {
          const prob = tsMap.get(ts);
          return prob !== undefined ? parseFloat((prob * 100).toFixed(1)) : null;
        }),
      };
    });

    return {
      xAxisData: sortedTs.map((ts) => {
        const date = new Date(ts * 1000);
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }),
      chartSeries: series,
    };
  }, [visibleOutcomes]);

  const textColor = isDark ? "#888" : "#666";
  const gridColor = isDark ? "#333" : "#e5e5e5";

  const chartOption = useMemo(() => {
    if (chartSeries.length === 0) return {};

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#1a1a1a" : "#fff",
        borderColor: gridColor,
        textStyle: { color: isDark ? "#e5e5e5" : "#333", fontSize: 11 },
      },
      grid: { left: 45, right: 15, bottom: 30, top: 40 },
      legend: {
        type: "scroll",
        top: 5,
        right: 10,
        left: 100,
        textStyle: { color: textColor, fontSize: 9 },
        itemWidth: 12,
        itemHeight: 3,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: xAxisData,
        axisLabel: { color: textColor, fontSize: 9 },
        axisLine: { lineStyle: { color: gridColor } },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { formatter: "{value}%", color: textColor, fontSize: 9 },
        splitLine: { lineStyle: { color: gridColor, opacity: 0.3 } },
        axisLine: { show: false },
      },
      series: chartSeries.map((s, idx) => ({
        name: s.name,
        type: "line",
        smooth: true,
        symbol: "none",
        data: s.data,
        lineStyle: {
          width: idx === 0 ? 3 : 2,
          color: s.color,
          opacity: idx < 3 ? 1 : 0.7,
        },
        emphasis: { focus: "series", lineStyle: { width: 4 } },
      })),
    };
  }, [chartSeries, xAxisData, textColor, gridColor, isDark]);

  return (
    <div className={`h-full bg-gradient-to-b from-white to-zinc-50/50 dark:from-zinc-900 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-3 flex flex-col`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          {leadingOutcome && (
            <div className="flex items-center gap-2">
              <span className="text-2xl font-mono font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
                {(leadingOutcome.probability * 100).toFixed(0)}%
              </span>
              <span className="text-sm font-medium text-cyan-500 truncate max-w-[120px]">
                {leadingOutcome.outcome}
              </span>
            </div>
          )}
          {isLoading && <RefreshCw className="w-4 h-4 text-cyan-500 animate-spin" />}
        </div>
        <div className="flex gap-0.5 text-[11px]">
          {(["1W", "1M", "3M", "ALL"] as const).map((range) => (
            <button
              key={range}
              onClick={() => onTimeRangeChange(range)}
              className={`px-2 py-1 rounded transition-colors ${
                range === timeRange
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {xAxisData.length > 0 ? (
          <ReactECharts
            option={chartOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">
            {isLoading ? "Loading..." : "No data"}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// MARKET LEGEND CARD (Sidebar for chart)
// ============================================

function MarketLegendCard({ outcomeData, onToggleVisibility }: { outcomeData: OutcomeData[]; onToggleVisibility: (id: string) => void }) {
  return (
    <div className={`h-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} flex flex-col overflow-hidden`}>
      <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Markets</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {outcomeData.map((o) => (
          <div
            key={o.id}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
            onClick={() => onToggleVisibility(o.marketId)}
          >
            <button className={`p-0.5 ${o.visible ? "text-zinc-600 dark:text-zinc-400" : "text-zinc-300 dark:text-zinc-600"}`}>
              {o.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            </button>
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: o.visible ? o.color : "#71717a" }}
            />
            <span className={`flex-1 text-[11px] truncate ${o.visible ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400 dark:text-zinc-600"}`}>
              {o.outcome}
            </span>
            <span className="text-[11px] font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {(o.probability * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// ANALYSIS CARD (Slides up with tabs + sections)
// ============================================

interface AnalysisCardProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  sectionRefs: React.MutableRefObject<Record<SectionKey, HTMLDivElement | null>>;
  activeSection: SectionKey;
  onSectionClick: (key: SectionKey) => void;
  event: { title: string; marketCount: number };
  markets: Market[];
  outcomeData: OutcomeData[];
  onMarketClick: (market: Market) => void;
}

function AnalysisCard({
  scrollRef,
  sectionRefs,
  activeSection,
  onSectionClick,
  event,
  markets,
  outcomeData,
  onMarketClick,
}: AnalysisCardProps) {
  return (
    <div className={`h-full flex flex-col border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} bg-white dark:bg-zinc-900 overflow-hidden`}>
      {/* Tab Header */}
      <div className="flex-shrink-0 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30">
        <div className="flex overflow-x-auto scrollbar-hide">
          {sections.map((section) => (
            <button
              key={section.key}
              onClick={() => onSectionClick(section.key)}
              className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-all duration-150 ${
                activeSection === section.key
                  ? "text-cyan-600 dark:text-cyan-400"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              }`}
            >
              {section.icon}
              <span>{section.label}</span>
              {activeSection === section.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 pr-2 flex-shrink-0">
          <button className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded">
            <Expand className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-16">
        {/* Overview */}
        <div ref={(el) => { sectionRefs.current.overview = el; }} className="p-5">
          <SectionOverview outcomeData={outcomeData} eventTitle={event.title} />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Analysis */}
        <div ref={(el) => { sectionRefs.current.analysis = el; }} className="p-5">
          <MarketAnalysisContent eventTitle={event.title} />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Smart Money */}
        <div ref={(el) => { sectionRefs.current["smart-money"] = el; }} className="p-5">
          <SmartMoneyContent />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* All Markets */}
        <div ref={(el) => { sectionRefs.current.markets = el; }} className="p-5">
          <SectionAllMarkets markets={markets} onMarketClick={onMarketClick} />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Domino Effects */}
        <div ref={(el) => { sectionRefs.current.correlations = el; }} className="p-5">
          <DominoEffectsContent />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Statistics */}
        <div ref={(el) => { sectionRefs.current.statistics = el; }} className="p-5">
          <StatisticalAnalysisContent />
        </div>
      </div>
    </div>
  );
}

// ============================================
// SECTION: OVERVIEW
// ============================================

function SectionOverview({ outcomeData, eventTitle }: { outcomeData: OutcomeData[]; eventTitle: string }) {
  const topOutcomes = outcomeData.filter(o => o.visible).slice(0, 8);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="w-4 h-4 text-cyan-500" />
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Probability Overview</h3>
      </div>
      <p className="text-sm text-zinc-500 mb-4">
        Top outcomes ranked by current probability for {eventTitle}
      </p>

      <div className="grid grid-cols-2 gap-3">
        {topOutcomes.map((outcome, index) => (
          <div
            key={outcome.id}
            className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <span className="w-5 text-sm font-semibold text-zinc-400 tabular-nums">#{index + 1}</span>
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: outcome.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{outcome.outcome}</div>
            </div>
            <span className="text-lg font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {(outcome.probability * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// SECTION: MARKET ANALYSIS
// ============================================

function MarketAnalysisContent({ eventTitle }: { eventTitle: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-4 h-4 text-cyan-500" />
        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Research Report</span>
      </div>

      <div className="space-y-4">
        <div className="border-l-2 border-cyan-500/50 pl-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Executive Summary</div>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
            Our analysis aggregates data from multiple sources to provide comprehensive intelligence on this event.
            We examine on-chain activity, smart money positions, cross-market correlations, and historical patterns.
          </p>
        </div>

        <div>
          <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Key Findings</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
              <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400 font-mono">82%</div>
              <div className="text-xs text-zinc-500">Smart Money Confidence</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">+$4.2M</div>
              <div className="text-xs text-zinc-500">7-Day Net Flow</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
              <div className="text-2xl font-bold text-violet-600 dark:text-violet-400 font-mono">91%</div>
              <div className="text-xs text-zinc-500">Historical Match</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// SECTION: SMART MONEY
// ============================================

function SmartMoneyContent() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Wallet className="w-4 h-4 text-cyan-500" />
        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Smart Money Signal</span>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-zinc-500">Bearish</span>
          <span className="font-medium text-cyan-600 dark:text-cyan-400">82% Bullish</span>
          <span className="text-zinc-500">Bullish</span>
        </div>
        <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-cyan-400 to-cyan-600 rounded-full" style={{ width: "82%" }} />
        </div>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed">
        Analysis of top 50 wallets by historical accuracy shows strong directional consensus.
      </p>

      <div className="grid grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-center">
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-mono">34</div>
          <div className="text-[10px] text-zinc-500">Top Wallets</div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-center">
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono">+$4.2M</div>
          <div className="text-[10px] text-zinc-500">7d Flow</div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-center">
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-mono">$125K</div>
          <div className="text-[10px] text-zinc-500">Avg Size</div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-center">
          <div className="text-lg font-bold text-cyan-600 dark:text-cyan-400 font-mono">89%</div>
          <div className="text-[10px] text-zinc-500">Accuracy</div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// SECTION: ALL MARKETS
// ============================================

function SectionAllMarkets({ markets, onMarketClick }: { markets: Market[]; onMarketClick: (market: Market) => void }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <LayoutGrid className="w-4 h-4 text-cyan-500" />
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">All Markets ({markets.length})</h3>
      </div>
      <p className="text-sm text-zinc-500 mb-4">
        Click any market to view details and resolution rules
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {markets.map((market) => (
          <MarketCard key={market.id} market={market} onClick={() => onMarketClick(market)} />
        ))}
      </div>
    </div>
  );
}

function MarketCard({ market, onClick }: { market: Market; onClick: () => void }) {
  let prices: number[] = [];
  try {
    const parsed = JSON.parse(market.outcomePrices || "[]");
    prices = parsed.map((p: string | number) => (typeof p === "string" ? parseFloat(p) : p));
  } catch {
    prices = [];
  }

  let outcomes: string[] = [];
  if (Array.isArray(market.outcomes)) {
    outcomes = market.outcomes;
  } else if (typeof market.outcomes === "string") {
    try { outcomes = JSON.parse(market.outcomes); } catch { outcomes = []; }
  }

  return (
    <div
      onClick={onClick}
      className={`border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} bg-white dark:bg-zinc-900 p-4 hover:border-cyan-400 dark:hover:border-cyan-600 hover:shadow-lg transition-all cursor-pointer group`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 line-clamp-2 group-hover:text-cyan-600 dark:group-hover:text-cyan-400">
          {market.question}
        </h4>
        <ChevronRight className="w-4 h-4 text-zinc-400 flex-shrink-0 group-hover:text-cyan-500" />
      </div>

      <div className="space-y-2">
        {outcomes.slice(0, 3).map((outcome, i) => {
          const price = prices[i] || 0;
          return (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-600 dark:text-zinc-400 truncate">{outcome}</div>
                <div className="mt-0.5 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-cyan-500" style={{ width: `${price * 100}%` }} />
                </div>
              </div>
              <span className="text-sm font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {(price * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// SECTION: DOMINO EFFECTS
// ============================================

function DominoEffectsContent() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-4 h-4 text-cyan-500" />
        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Domino Effects</span>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
        How different outcomes in this event could affect related markets
      </p>

      <div className="grid grid-cols-2 gap-3">
        {[
          { title: "Related Market A", prob: 45, change: "+5.2%" },
          { title: "Related Market B", prob: 78, change: "+2.1%" },
          { title: "Related Market C", prob: 34, change: "-1.8%" },
          { title: "Related Market D", prob: 62, change: "+3.4%" },
        ].map((item, i) => (
          <div key={i} className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 hover:border-cyan-400 transition-colors cursor-pointer">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">{item.title}</div>
            <div className="flex items-center justify-between">
              <span className="text-lg font-mono font-bold text-zinc-900 dark:text-zinc-100">{item.prob}%</span>
              <span className={`text-xs font-medium ${item.change.startsWith("+") ? "text-emerald-600" : "text-rose-600"}`}>
                {item.change}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// SECTION: STATISTICS
// ============================================

function StatisticalAnalysisContent() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <PieChart className="w-4 h-4 text-cyan-500" />
        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Statistical Analysis</span>
      </div>

      <div className="p-6 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30">
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
          Advanced statistical models for probability assessment.
        </p>
        <div className="text-xs text-zinc-500">
          Coming soon: Distribution visualization, scenario analysis, and risk metrics
        </div>
      </div>
    </div>
  );
}

// ============================================
// MARKET DETAIL MODAL
// ============================================

function MarketDetailModal({ market, onClose }: { market: Market; onClose: () => void }) {
  let prices: number[] = [];
  try {
    const parsed = JSON.parse(market.outcomePrices || "[]");
    prices = parsed.map((p: string | number) => (typeof p === "string" ? parseFloat(p) : p));
  } catch { prices = []; }

  let outcomes: string[] = [];
  if (Array.isArray(market.outcomes)) {
    outcomes = market.outcomes;
  } else if (typeof market.outcomes === "string") {
    try { outcomes = JSON.parse(market.outcomes); } catch { outcomes = []; }
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-white dark:bg-zinc-900 ${CORNER_STYLE === "rounded" ? "rounded-2xl" : "rounded-xl"} w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-700`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 overflow-y-auto max-h-[90vh]">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-full"
          >
            <X className="w-5 h-5" />
          </button>

          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-4 pr-8">
            {market.question}
          </h2>

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Outcomes</h3>
            <div className="space-y-3">
              {outcomes.map((outcome, i) => {
                const price = prices[i] || 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm text-zinc-700 dark:text-zinc-300">{outcome}</div>
                      <div className="mt-1 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${price * 100}%` }} />
                      </div>
                    </div>
                    <span className="text-lg font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {(price * 100).toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {market.description && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Resolution Rules</h3>
              <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                  {market.description}
                </p>
              </div>
            </div>
          )}

          <a
            href={`https://polymarket.com/event/${market.slug || market.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            <span>View on Polymarket</span>
          </a>
        </div>
      </div>
    </div>
  );
}

// ============================================
// HELPERS
// ============================================

function shortenTitle(title: string, maxLen: number): string {
  const cleaned = title
    .replace(/^Will\s+/i, "")
    .replace(/\?$/g, "")
    .replace(/\s+in\s+\d{4}$/i, "");

  if (cleaned.length > maxLen) {
    return cleaned.slice(0, maxLen - 3) + "...";
  }
  return cleaned;
}

// ============================================
// LOADING & ERROR STATES
// ============================================

function DashboardLoadingState() {
  return (
    <div className="h-[calc(100vh-4rem)] p-2">
      <div className="flex h-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
        <div className="flex-1 flex flex-col overflow-hidden animate-pulse">
          <div className="flex-shrink-0 px-5 pt-3 pb-2">
            <div className="h-6 w-96 bg-zinc-200 dark:bg-zinc-800 rounded mb-2" />
            <div className="flex gap-4">
              <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded" />
              <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded" />
            </div>
          </div>
          <div className="flex-1 px-5 py-4">
            <div className="h-[360px] bg-zinc-200 dark:bg-zinc-800 rounded-lg" />
          </div>
        </div>
        <div className="w-[480px] border-l border-zinc-200 dark:border-zinc-800 p-4">
          <div className="h-6 w-48 bg-zinc-200 dark:bg-zinc-800 rounded mb-4" />
          <div className="space-y-3">
            <div className="h-16 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="h-16 bg-zinc-200 dark:bg-zinc-800 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardErrorState({ error, eventSlug }: { error: string; eventSlug: string }) {
  return (
    <div className="h-[calc(100vh-4rem)] p-2">
      <div className="flex h-full items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Event Not Found</h2>
          <p className="text-zinc-500 mb-4">Could not load event &quot;{eventSlug}&quot;. {error}</p>
          <a href="/demo/pitch-mockup-v2" className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors">
            View Demo Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
