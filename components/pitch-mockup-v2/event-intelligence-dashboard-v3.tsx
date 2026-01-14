"use client";

import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { usePolymarketEventDetail } from "@/hooks/use-polymarket-event-detail";
import { useSmartMoneyHistory } from "@/hooks/use-smart-money-history";
import { SmartMoneyBreakdownComponent } from "@/components/smart-money-breakdown";
import { DeepResearchCopilot } from "./deep-research-copilot";
import {
  AlertCircle,
  TrendingUp,
  Users,
  DollarSign,
  Clock,
  FileText,
  Wallet,
  PieChart,
  Expand,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  GitBranch,
  LayoutGrid,
  Lightbulb,
  ExternalLink,
  Link2,
  ArrowLeft,
  BookOpen,
} from "lucide-react";

// ============================================
// CONSTANTS
// ============================================

// Using type widening to avoid TypeScript dead code analysis
const CORNER_STYLE: string = "sharp";
const CHART_AREA_HEIGHT = 376;
const SCROLL_SMOOTHING = 0.6;

const OUTCOME_COLORS = [
  "#22d3ee", "#f472b6", "#a78bfa", "#34d399", "#fbbf24",
  "#fb7185", "#60a5fa", "#4ade80", "#f97316", "#c084fc",
  "#818cf8", "#2dd4bf", "#facc15", "#fb923c", "#e879f9",
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
  clobTokenIds?: string;
  conditionId?: string;
  image?: string;
  slug?: string;
}

interface OHLCDataPoint {
  t: number;
  c: number;
}

interface MarketLineData {
  id: string;
  conditionId: string;
  name: string;
  fullName: string;
  color: string;
  probability: number;
  visible: boolean;
  priceHistory: Array<{ timestamp: number; price: number }>;
}

type ViewMode = "event" | "market";

type EventSectionKey = "overview" | "analysis" | "smart-money" | "markets" | "domino" | "statistics";
type MarketSectionKey = "overview" | "rules" | "smart-money" | "analysis" | "correlated" | "statistics";

const eventSections: { key: EventSectionKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { key: "analysis", label: "Analysis", icon: <FileText className="w-3.5 h-3.5" /> },
  { key: "smart-money", label: "Smart Money", icon: <Wallet className="w-3.5 h-3.5" /> },
  { key: "markets", label: "All Markets", icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  { key: "domino", label: "Domino Effects", icon: <GitBranch className="w-3.5 h-3.5" /> },
  { key: "statistics", label: "Statistics", icon: <PieChart className="w-3.5 h-3.5" /> },
];

const marketSections: { key: MarketSectionKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { key: "rules", label: "Rules", icon: <BookOpen className="w-3.5 h-3.5" /> },
  { key: "smart-money", label: "Smart Money", icon: <Wallet className="w-3.5 h-3.5" /> },
  { key: "analysis", label: "Analysis", icon: <FileText className="w-3.5 h-3.5" /> },
  { key: "correlated", label: "Correlated", icon: <Link2 className="w-3.5 h-3.5" /> },
  { key: "statistics", label: "Statistics", icon: <PieChart className="w-3.5 h-3.5" /> },
];

interface EventIntelligenceDashboardV3Props {
  eventSlug: string;
}

// ============================================
// HELPERS
// ============================================

function getYesTokenId(market: Market): string | null {
  try {
    if (market.clobTokenIds) {
      const tokens = JSON.parse(market.clobTokenIds);
      if (tokens[0]) return tokens[0];
    }
  } catch {
    // ignore
  }
  return null;
}

function shortenTitle(title: string, maxLen: number): string {
  const cleaned = title
    .replace(/^Will\s+/i, "")
    .replace(/\?$/g, "")
    .replace(/\s+in\s+\d{4}$/i, "")
    .replace(/\s+on\s+December\s+\d+\??$/i, "")
    .replace(/\s+by\s+market\s+cap$/i, "")
    .replace(/\s+by\s+end\s+of\s+\d{4}\??$/i, "");
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen - 3) + "..." : cleaned;
}

function parseOutcomes(market: Market): string[] {
  if (Array.isArray(market.outcomes)) return market.outcomes;
  try {
    return JSON.parse(market.outcomes);
  } catch {
    return ["Yes", "No"];
  }
}

function parseOutcomePrices(market: Market): number[] {
  try {
    const parsed = JSON.parse(market.outcomePrices || "[]");
    return parsed.map((p: string | number) => (typeof p === "string" ? parseFloat(p) : p));
  } catch {
    return [0.5, 0.5];
  }
}

function formatVolume(vol: number | undefined): string {
  if (!vol) return "$0";
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
  return `$${vol.toFixed(0)}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ============================================
// MAIN COMPONENT
// ============================================

export function EventIntelligenceDashboardV3({ eventSlug }: EventIntelligenceDashboardV3Props) {
  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>("event");
  const [focusedMarket, setFocusedMarket] = useState<Market | null>(null);

  // UI state
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  // cardOffset is tracked via ref only - no React state to avoid re-renders during animation
  const [activeEventSection, setActiveEventSection] = useState<EventSectionKey>("overview");
  const [activeMarketSection, setActiveMarketSection] = useState<MarketSectionKey>("overview");
  const [visibleMarkets, setVisibleMarkets] = useState<Set<string>>(new Set());
  const [timeRange, setTimeRange] = useState<"1W" | "1M" | "3M" | "ALL">("1M");

  // Refs
  const innerScrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardElementRef = useRef<HTMLDivElement>(null);
  const chartLayerRef = useRef<HTMLDivElement>(null);
  const marketNavigatorRef = useRef<HTMLDivElement>(null);
  // Use ref to track cardOffset in event listener to avoid stale closure
  const cardOffsetRef = useRef(CHART_AREA_HEIGHT);
  // For smooth animation using requestAnimationFrame
  const targetOffsetRef = useRef(CHART_AREA_HEIGHT);
  const animationRef = useRef<number | null>(null);

  const eventSectionRefs = useRef<Record<EventSectionKey, HTMLDivElement | null>>({
    overview: null, analysis: null, "smart-money": null, markets: null, domino: null, statistics: null,
  });
  const marketSectionRefs = useRef<Record<MarketSectionKey, HTMLDivElement | null>>({
    overview: null, rules: null, "smart-money": null, analysis: null, correlated: null, statistics: null,
  });

  // Data fetching
  const { event, isLoading, error } = usePolymarketEventDetail(eventSlug);
  const markets = useMemo(() => (event?.markets || []) as Market[], [event]);

  // Initialize visible markets - sort by probability first to get top markets
  useEffect(() => {
    if (markets.length > 0 && visibleMarkets.size === 0) {
      // Sort markets by probability (YES price) descending
      const sortedByProb = [...markets].sort((a, b) => {
        const priceA = parseOutcomePrices(a)[0] || 0;
        const priceB = parseOutcomePrices(b)[0] || 0;
        return priceB - priceA;
      });
      const initial = new Set<string>();
      sortedByProb.slice(0, 6).forEach((m) => initial.add(m.id));
      setVisibleMarkets(initial);
    }
  }, [markets, visibleMarkets.size]);

  // Fetch OHLC data for all markets - optimized with longer cache and GC time
  const ohlcQueries = useQueries({
    queries: markets.map((market) => {
      const tokenId = getYesTokenId(market);
      return {
        queryKey: ["market-ohlc-v3", tokenId || market.id],
        queryFn: async () => {
          if (!tokenId) return { data: [], marketId: market.id };
          const response = await fetch(`/api/polymarket/ohlc/${tokenId}?interval=max`);
          if (!response.ok) return { data: [], marketId: market.id };
          const result = await response.json();
          return { data: result.data || [], marketId: market.id };
        },
        staleTime: 10 * 60 * 1000, // 10 minutes - data doesn't change that fast
        gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
        retry: 1,
        refetchOnWindowFocus: false, // Don't refetch when window regains focus
        refetchOnMount: false, // Don't refetch when component mounts if data exists
        enabled: !!tokenId,
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
      const ohlcData: OHLCDataPoint[] = queryResult?.data?.data || [];
      const prices = parseOutcomePrices(market);
      const currentPrice = prices[0] || 0;
      const filteredOhlc = ohlcData.filter((d) => d.t >= cutoff);

      lines.push({
        id: market.id,
        conditionId: (market.conditionId || "").replace(/^0x/i, "").toLowerCase(),
        name: shortenTitle(market.question, 25),
        fullName: market.question,
        color: OUTCOME_COLORS[idx % OUTCOME_COLORS.length],
        probability: currentPrice,
        visible: visibleMarkets.has(market.id),
        priceHistory: filteredOhlc.map((p) => ({ timestamp: p.t, price: p.c })),
      });
    });

    return lines.sort((a, b) => b.probability - a.probability);
  }, [markets, ohlcQueries, visibleMarkets, timeRange]);

  // Sorted markets for left panel (same order as marketLineData)
  const sortedMarkets = useMemo(() => {
    const marketMap = new Map(markets.map(m => [m.id, m]));
    return marketLineData
      .map(line => marketMap.get(line.id))
      .filter((m): m is Market => m !== undefined);
  }, [markets, marketLineData]);

  // Animation function - pure DOM manipulation, no React re-renders
  const animateToTarget = useCallback(() => {
    const target = targetOffsetRef.current;
    const current = cardOffsetRef.current;
    const diff = Math.abs(target - current);

    // Helper to update overflow based on card position (pure DOM)
    const updateOverflow = (offset: number) => {
      if (marketNavigatorRef.current) {
        marketNavigatorRef.current.style.overflowY = offset < 1 ? 'auto' : 'hidden';
      }
    };

    // Stop animating if close enough
    if (diff < 0.5) {
      cardOffsetRef.current = target;
      if (cardElementRef.current) {
        // Use translate3d for GPU acceleration
        cardElementRef.current.style.transform = `translate3d(0, ${target}px, 0)`;
      }
      if (chartLayerRef.current) {
        const progress = 1 - target / CHART_AREA_HEIGHT;
        chartLayerRef.current.style.opacity = String(1 - progress * 0.7);
      }
      updateOverflow(target);
      animationRef.current = null;
      return;
    }

    // Lerp towards target
    const newOffset = current + (target - current) * 0.2;
    cardOffsetRef.current = newOffset;

    if (cardElementRef.current) {
      // Use translate3d for GPU acceleration
      cardElementRef.current.style.transform = `translate3d(0, ${newOffset}px, 0)`;
    }
    if (chartLayerRef.current) {
      const progress = 1 - newOffset / CHART_AREA_HEIGHT;
      chartLayerRef.current.style.opacity = String(1 - progress * 0.7);
    }
    updateOverflow(newOffset);

    animationRef.current = requestAnimationFrame(animateToTarget);
  }, []); // No dependencies - pure refs only

  // Start animation when needed
  const triggerAnimation = useCallback(() => {
    if (animationRef.current === null) {
      animationRef.current = requestAnimationFrame(animateToTarget);
    }
  }, [animateToTarget]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Helper to update active section based on scroll position
  const updateActiveSection = useCallback(() => {
    const scrollContainer = innerScrollRef.current;
    if (!scrollContainer) return;

    const containerRect = scrollContainer.getBoundingClientRect();

    if (viewMode === "event") {
      let closestSection: EventSectionKey = "overview";
      let closestDistance = Infinity;

      (Object.keys(eventSectionRefs.current) as EventSectionKey[]).forEach((key) => {
        const el = eventSectionRefs.current[key];
        if (el) {
          const rect = el.getBoundingClientRect();
          const distance = Math.abs(rect.top - containerRect.top);
          if (rect.top <= containerRect.top + 100 && distance < closestDistance) {
            closestDistance = distance;
            closestSection = key;
          }
        }
      });

      if (scrollContainer.scrollTop < 50) closestSection = "overview";
      setActiveEventSection(closestSection);
    } else {
      let closestSection: MarketSectionKey = "overview";
      let closestDistance = Infinity;

      (Object.keys(marketSectionRefs.current) as MarketSectionKey[]).forEach((key) => {
        const el = marketSectionRefs.current[key];
        if (el) {
          const rect = el.getBoundingClientRect();
          const distance = Math.abs(rect.top - containerRect.top);
          if (rect.top <= containerRect.top + 100 && distance < closestDistance) {
            closestDistance = distance;
            closestSection = key;
          }
        }
      });

      if (scrollContainer.scrollTop < 50) closestSection = "overview";
      setActiveMarketSection(closestSection);
    }
  }, [viewMode]);

  // Two-phase scroll handler - updates targetOffsetRef (no React re-renders)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      const inner = innerScrollRef.current;
      if (!inner) return;

      const delta = e.deltaY * SCROLL_SMOOTHING;
      const innerScrollTop = inner.scrollTop;
      const currentTarget = targetOffsetRef.current;
      const currentActual = cardOffsetRef.current;

      // Card is "at top" only when both target AND actual position are at 0
      const cardIsAtTop = currentTarget === 0 && currentActual < 1;

      // Scrolling DOWN (delta > 0)
      if (delta > 0) {
        // Phase 1: Card hasn't fully reached top yet - move card up
        if (!cardIsAtTop) {
          e.preventDefault();
          e.stopPropagation();
          targetOffsetRef.current = Math.max(0, currentTarget - delta);
          triggerAnimation();
        }
        // Phase 2: Card is at top - let native scroll handle it
      }
      // Scrolling UP (delta < 0)
      else {
        // If inner content is scrolled down, let native scroll handle it
        if (innerScrollTop > 0) {
          // Native scroll handles it
        }
        // Inner is at top - move card down (Phase 1 reverse)
        else {
          e.preventDefault();
          e.stopPropagation();
          targetOffsetRef.current = Math.min(CHART_AREA_HEIGHT, currentTarget - delta);
          triggerAnimation();
        }
      }
    };

    // Add as non-passive to allow preventDefault
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [isLoading, triggerAnimation]); // Re-run when loading completes so containerRef is available

  // Scroll spy for event sections - throttled to reduce re-renders
  useEffect(() => {
    if (viewMode !== "event") return;
    const scrollContainer = innerScrollRef.current;
    if (!scrollContainer) return;

    let ticking = false;
    let lastSection: EventSectionKey = "overview";

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(() => {
        const containerRect = scrollContainer.getBoundingClientRect();
        let closestSection: EventSectionKey = "overview";
        let closestDistance = Infinity;

        (Object.keys(eventSectionRefs.current) as EventSectionKey[]).forEach((key) => {
          const el = eventSectionRefs.current[key];
          if (el) {
            const rect = el.getBoundingClientRect();
            const distance = Math.abs(rect.top - containerRect.top);
            if (rect.top <= containerRect.top + 100 && distance < closestDistance) {
              closestDistance = distance;
              closestSection = key;
            }
          }
        });

        if (scrollContainer.scrollTop < 50) closestSection = "overview";

        // Only update state if section actually changed
        if (closestSection !== lastSection) {
          lastSection = closestSection;
          setActiveEventSection(closestSection);
        }

        ticking = false;
      });
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [viewMode, isLoading]); // Re-run when loading completes so ref is available

  // Scroll spy for market sections - throttled to reduce re-renders
  useEffect(() => {
    if (viewMode !== "market") return;
    const scrollContainer = innerScrollRef.current;
    if (!scrollContainer) return;

    let ticking = false;
    let lastSection: MarketSectionKey = "overview";

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(() => {
        const containerRect = scrollContainer.getBoundingClientRect();
        let closestSection: MarketSectionKey = "overview";
        let closestDistance = Infinity;

        (Object.keys(marketSectionRefs.current) as MarketSectionKey[]).forEach((key) => {
          const el = marketSectionRefs.current[key];
          if (el) {
            const rect = el.getBoundingClientRect();
            const distance = Math.abs(rect.top - containerRect.top);
            if (rect.top <= containerRect.top + 100 && distance < closestDistance) {
              closestDistance = distance;
              closestSection = key;
            }
          }
        });

        if (scrollContainer.scrollTop < 50) closestSection = "overview";

        // Only update state if section actually changed
        if (closestSection !== lastSection) {
          lastSection = closestSection;
          setActiveMarketSection(closestSection);
        }

        ticking = false;
      });
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [viewMode, isLoading]); // Re-run when loading completes so ref is available

  // Scroll to section - first slide card up, then scroll to section
  const scrollToEventSection = useCallback((key: EventSectionKey) => {
    const el = eventSectionRefs.current[key];
    const scrollContainer = innerScrollRef.current;
    if (el && scrollContainer) {
      targetOffsetRef.current = 0;
      triggerAnimation();
      setTimeout(() => {
        const containerTop = scrollContainer.getBoundingClientRect().top;
        const sectionTop = el.getBoundingClientRect().top;
        const offset = sectionTop - containerTop + scrollContainer.scrollTop;
        scrollContainer.scrollTo({ top: offset, behavior: "smooth" });
      }, 300);
    }
  }, [triggerAnimation]);

  const scrollToMarketSection = useCallback((key: MarketSectionKey) => {
    const el = marketSectionRefs.current[key];
    const scrollContainer = innerScrollRef.current;
    if (el && scrollContainer) {
      targetOffsetRef.current = 0;
      triggerAnimation();
      setTimeout(() => {
        const containerTop = scrollContainer.getBoundingClientRect().top;
        const sectionTop = el.getBoundingClientRect().top;
        const offset = sectionTop - containerTop + scrollContainer.scrollTop;
        scrollContainer.scrollTo({ top: offset, behavior: "smooth" });
      }, 300);
    }
  }, [triggerAnimation]);

  // View mode switching - reset card position and scroll
  const handleMarketClick = useCallback((market: Market) => {
    setFocusedMarket(market);
    setViewMode("market");
    setActiveMarketSection("overview");
    targetOffsetRef.current = CHART_AREA_HEIGHT;
    triggerAnimation();
    if (innerScrollRef.current) {
      innerScrollRef.current.scrollTop = 0;
    }
  }, [triggerAnimation]);

  const handleBackToEvent = useCallback(() => {
    setFocusedMarket(null);
    setViewMode("event");
    setActiveEventSection("overview");
    targetOffsetRef.current = CHART_AREA_HEIGHT;
    triggerAnimation();
    if (innerScrollRef.current) {
      innerScrollRef.current.scrollTop = 0;
    }
  }, [triggerAnimation]);


  // Loading / Error states
  if (isLoading) return <DashboardLoadingState />;
  if (error || !event) return <DashboardErrorState error={error?.message || "Event not found"} eventSlug={eventSlug} />;

  return (
    <div className="h-[calc(100vh-4rem)] p-2">
      <div className={`flex h-full overflow-hidden ${CORNER_STYLE === "rounded" ? "rounded-2xl" : "rounded-xl"} border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950`}>

        {/* MAIN CONTENT AREA */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex-shrink-0 px-5 pt-3 pb-2 bg-zinc-50 dark:bg-zinc-950 z-20 relative border-b border-zinc-200 dark:border-zinc-800">
            {viewMode === "event" ? (
              <EventHeader event={event} />
            ) : (
              <MarketHeader market={focusedMarket!} onBack={handleBackToEvent} eventTitle={event.title} />
            )}
          </div>

          {/* Chart + Card Area */}
          <div ref={containerRef} className="flex-1 relative overflow-hidden">
            {/* Chart Layer - Integrated Chart with Market Navigator */}
            <div
              ref={chartLayerRef}
              className="absolute inset-0 z-0 px-5 pt-2"
              style={{ opacity: 1, willChange: "opacity" }}
            >
              <div className={`h-[360px] bg-gradient-to-b from-white to-zinc-50/50 dark:from-zinc-900 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} overflow-hidden shadow-md flex`}>
                {/* Market Navigator - Inside the chart card */}
                <div className="w-56 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-700 flex flex-col bg-white/50 dark:bg-zinc-800/30">
                  <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between bg-zinc-50/80 dark:bg-zinc-800/50">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Markets</span>
                    <span className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400">{markets.length}</span>
                  </div>
                  <div ref={marketNavigatorRef} className="flex-1 overflow-hidden">
                    {sortedMarkets.map((market, index) => {
                      const lineData = marketLineData[index];
                      const isFocused = focusedMarket?.id === market.id;
                      const yesPrice = lineData?.probability || 0;
                      const lineColor = lineData?.color || OUTCOME_COLORS[index % OUTCOME_COLORS.length];
                      return (
                        <div
                          key={market.id}
                          onClick={() => handleMarketClick(market)}
                          className={`px-2 py-1.5 cursor-pointer transition-all border-b border-zinc-100 dark:border-zinc-800 group ${
                            isFocused
                              ? "bg-cyan-50 dark:bg-cyan-900/30"
                              : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {/* Market Thumbnail */}
                            <div className={`w-8 h-8 flex-shrink-0 rounded overflow-hidden border ${isFocused ? "border-cyan-500" : "border-zinc-200 dark:border-zinc-700"}`}>
                              {market.image ? (
                                <img src={market.image} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-700 dark:to-zinc-800 flex items-center justify-center">
                                  <span className="text-[8px] font-bold text-zinc-400">{index + 1}</span>
                                </div>
                              )}
                            </div>
                            {/* Market Info */}
                            <div className="flex-1 min-w-0">
                              <p className={`text-[10px] leading-tight line-clamp-2 ${isFocused ? "text-cyan-700 dark:text-cyan-300 font-medium" : "text-zinc-700 dark:text-zinc-300"}`}>
                                {shortenTitle(market.question, 40)}
                              </p>
                              {/* Visual Probability Bar */}
                              <div className="mt-1 flex items-center gap-1.5">
                                <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                      width: `${yesPrice * 100}%`,
                                      backgroundColor: lineColor
                                    }}
                                  />
                                </div>
                                <span className={`text-[9px] font-mono font-semibold tabular-nums ${isFocused ? "text-cyan-600 dark:text-cyan-400" : "text-zinc-600 dark:text-zinc-400"}`}>
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
                    <MultiMarketChartInline
                      marketLineData={marketLineData}
                      timeRange={timeRange}
                      onTimeRangeChange={setTimeRange}
                      isLoading={isLoadingOHLC}
                    />
                  ) : (
                    <SingleMarketChartInline
                      market={focusedMarket!}
                      marketLineData={marketLineData.find((m) => m.id === focusedMarket?.id) || null}
                      timeRange={timeRange}
                      onTimeRangeChange={setTimeRange}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Analysis Card - slides up over the chart */}
            <div
              ref={cardElementRef}
              className="absolute left-0 right-0 z-10 bg-zinc-50 dark:bg-zinc-950 px-5 gpu-accelerated"
              style={{
                top: 0,
                bottom: -CHART_AREA_HEIGHT,
                transform: `translate3d(0, ${CHART_AREA_HEIGHT}px, 0)`,
                willChange: "transform",
                backfaceVisibility: "hidden",
              }}
            >
              {viewMode === "event" ? (
                <EventAnalysisCard
                  scrollRef={innerScrollRef}
                  sectionRefs={eventSectionRefs}
                  activeSection={activeEventSection}
                  onSectionClick={scrollToEventSection}
                  event={event}
                  markets={markets}
                  marketLineData={marketLineData}
                  onMarketClick={handleMarketClick}
                />
              ) : (
                <MarketAnalysisCard
                  scrollRef={innerScrollRef}
                  sectionRefs={marketSectionRefs}
                  activeSection={activeMarketSection}
                  onSectionClick={scrollToMarketSection}
                  market={focusedMarket!}
                />
              )}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Copilot Sidebar */}
        <DeepResearchCopilot
          isOpen={isCopilotOpen}
          onToggle={() => setIsCopilotOpen(!isCopilotOpen)}
          eventTitle={event.title}
          marketQuestion={viewMode === "market" && focusedMarket ? focusedMarket.question : undefined}
          category={event.category}
        />
      </div>
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
    Finance: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    Tech: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  };

  return (
    <>
      {/* Breadcrumb / Mode indicator */}
      <div className="flex items-center gap-2 mb-1 text-xs">
        <Link href="/events" className="text-zinc-400 hover:text-cyan-500 transition-colors">Events</Link>
        <ChevronRight className="w-3 h-3 text-zinc-400" />
        <span className="text-cyan-600 dark:text-cyan-400 font-medium">Event Overview</span>
        <span className="ml-auto px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded">
          LIVE
        </span>
      </div>
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100 truncate flex-1">
          {event.title}
        </h1>
        <span className={`px-2 py-0.5 text-[10px] font-medium rounded flex-shrink-0 ${categoryColors[event.category] || "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
          {event.category}
        </span>
      </div>
      <div className="flex items-center gap-4 text-xs mt-1">
        <div className="flex items-center gap-1 text-zinc-500">
          <DollarSign className="w-3 h-3" />
          <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{formatVolume(event.volume)}</span>
        </div>
        <div className="flex items-center gap-1 text-zinc-500">
          <TrendingUp className="w-3 h-3" />
          <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{formatVolume(event.volume24hr)}</span>
          <span className="text-[10px] text-zinc-400">24h</span>
        </div>
        <div className="flex items-center gap-1 text-zinc-500">
          <LayoutGrid className="w-3 h-3" />
          <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{event.marketCount}</span>
          <span className="text-[10px] text-zinc-400">markets</span>
        </div>
        <div className="flex items-center gap-1 text-zinc-500">
          <Clock className="w-3 h-3" />
          <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{formatDate(event.endDate)}</span>
        </div>
      </div>
    </>
  );
}

// ============================================
// MARKET HEADER
// ============================================

function MarketHeader({ market, onBack, eventTitle }: { market: Market; onBack: () => void; eventTitle?: string }) {
  const prices = parseOutcomePrices(market);
  const yesPrice = prices[0] || 0;
  const noPrice = prices[1] || 1 - yesPrice;

  return (
    <>
      {/* Breadcrumb / Mode indicator */}
      <div className="flex items-center gap-2 mb-1 text-xs">
        <Link href="/events" className="text-zinc-400 hover:text-cyan-500 transition-colors">Events</Link>
        <ChevronRight className="w-3 h-3 text-zinc-400" />
        <button onClick={onBack} className="text-zinc-400 hover:text-cyan-500 transition-colors max-w-[200px] truncate" title={eventTitle}>
          {eventTitle ? shortenTitle(eventTitle, 30) : "Event"}
        </button>
        <ChevronRight className="w-3 h-3 text-zinc-400" />
        <span className="text-cyan-600 dark:text-cyan-400 font-medium">Market</span>
        <span className="ml-auto px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded">
          ACTIVE
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 p-1.5 -ml-1.5 text-zinc-400 hover:text-cyan-500 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 rounded transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100 truncate flex-1">
          {market.question}
        </h1>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-900/20">
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">YES</span>
            <span className="text-sm font-mono font-bold text-emerald-700 dark:text-emerald-300">{(yesPrice * 100).toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-rose-50 dark:bg-rose-900/20">
            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">NO</span>
            <span className="text-sm font-mono font-bold text-rose-700 dark:text-rose-300">{(noPrice * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================
// INLINE CHART COMPONENTS (No card wrapper - used inside integrated card)
// ============================================

interface MultiMarketChartInlineProps {
  marketLineData: MarketLineData[];
  timeRange: "1W" | "1M" | "3M" | "ALL";
  onTimeRangeChange: (range: "1W" | "1M" | "3M" | "ALL") => void;
  isLoading: boolean;
}

function MultiMarketChartInline({ marketLineData, timeRange, onTimeRangeChange, isLoading }: MultiMarketChartInlineProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const visibleLines = marketLineData.filter((m) => m.visible);
  const leadingMarket = visibleLines[0];

  // Fetch smart money data for the leading market
  const daysMap = { "1W": 7, "1M": 30, "3M": 90, "ALL": 90 };
  const { data: smartMoneyData } = useSmartMoneyHistory(leadingMarket?.conditionId || "", daysMap[timeRange]);

  const { xAxisData, chartSeries, yAxisRange, smartMoneyLine } = useMemo(() => {
    const allTimestamps = new Set<number>();
    visibleLines.forEach((m) => {
      m.priceHistory.forEach((p) => allTimestamps.add(p.timestamp));
    });

    const sortedTs = Array.from(allTimestamps).sort((a, b) => a - b);

    // Collect all values to calculate Y-axis range
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
        lineWidth: idx === 0 ? 3 : 2,
        opacity: idx < 3 ? 1 : 0.7,
      };
    });

    // Add padding to Y-axis range (10% on each side, min 5 points)
    const range = maxVal - minVal;
    const padding = Math.max(range * 0.15, 5);
    const yMin = Math.max(0, Math.floor((minVal - padding) / 5) * 5);
    const yMax = Math.min(100, Math.ceil((maxVal + padding) / 5) * 5);

    // Sample x-axis labels to reduce density (show ~10-15 labels max)
    const labelInterval = Math.max(1, Math.floor(sortedTs.length / 12));

    const xDates = sortedTs.map((ts) => {
      const date = new Date(ts * 1000);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });

    // Build smart money lookup by date string
    const smartMoneyByDate = new Map<string, number>();
    if (smartMoneyData?.history) {
      for (const point of smartMoneyData.history) {
        const dateStr = new Date(point.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        smartMoneyByDate.set(dateStr, point.smart_money_odds);
      }
    }

    return {
      xAxisData: xDates,
      chartSeries: series,
      yAxisRange: { min: yMin, max: yMax, labelInterval },
      smartMoneyLine: xDates.map((dateStr) => smartMoneyByDate.get(dateStr) ?? null),
    };
  }, [visibleLines, smartMoneyData]);

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
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const date = params[0].axisValue;
          const lines = params
            .filter((p: any) => p.value !== null && p.value !== undefined)
            .sort((a: any, b: any) => (b.value || 0) - (a.value || 0))
            .map((p: any) => {
              const marker = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px;"></span>`;
              const name = p.seriesName.length > 30 ? p.seriesName.slice(0, 30) + '...' : p.seriesName;
              return `<div>${marker}${name}: <b>${p.value}%</b></div>`;
            });
          return `<div style="font-size:12px;line-height:1.5"><div style="color:${textColor};margin-bottom:4px;">${date}</div>${lines.join('')}</div>`;
        },
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
      grid: { left: 50, right: smartMoneyLine.some((v) => v !== null) ? 45 : 15, bottom: 35, top: 40, containLabel: false },
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
        // Primary Y-axis (left) - Market probabilities
        {
          type: "value",
          min: yAxisRange.min,
          max: yAxisRange.max,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: {
            lineStyle: { color: gridColor, type: "dashed" as const },
          },
          axisLabel: {
            color: textColor,
            fontSize: 10,
            formatter: (value: number) => `${value}%`,
          },
        },
        // Secondary Y-axis (right) - Smart money (only shown when we have data)
        ...(smartMoneyLine.some((v) => v !== null) ? [{
          type: "value",
          min: 0,
          max: 100,
          position: "right",
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: "#22d3ee",
            fontSize: 10,
            formatter: (value: number) => `${value}%`,
          },
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
          lineStyle: { width: idx === 0 ? 2.5 : 2, color: s.color },
          emphasis: { focus: "series" as const, lineStyle: { width: 3 } },
          connectNulls: true,
          // Gradient area fill for first series
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
        // Smart money line (only if we have data) - uses secondary Y-axis
        ...(smartMoneyLine.some((v) => v !== null) ? [{
          name: "Smart Money",
          type: "line" as const,
          smooth: true,
          symbol: "none",
          data: smartMoneyLine,
          yAxisIndex: 1,
          lineStyle: { width: 2, color: "#22d3ee", type: "dashed" as const },
          emphasis: { focus: "series" as const, lineStyle: { width: 3 } },
          connectNulls: true,
        }] : []),
      ],
    };
  }, [chartSeries, xAxisData, textColor, gridColor, isDark, yAxisRange, smartMoneyLine]);

  return (
    <>
      <div className="flex items-center justify-between mb-1 flex-shrink-0">
        <div className="flex items-center gap-3">
          {leadingMarket && (
            <div className="flex items-center gap-2">
              <span className="text-xl font-mono font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
                {(leadingMarket.probability * 100).toFixed(0)}%
              </span>
              <span className="text-xs font-medium text-cyan-500 truncate max-w-[140px]">
                {leadingMarket.name}
              </span>
            </div>
          )}
          {isLoading && <span className="text-[10px] text-zinc-400">Loading...</span>}
        </div>
        <div className="flex gap-0.5 text-[10px]">
          {(["1W", "1M", "3M", "ALL"] as const).map((range) => (
            <button
              key={range}
              onClick={() => onTimeRangeChange(range)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                range === timeRange
                  ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              }`}
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
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">
            {isLoading ? "Loading..." : "No chart data"}
          </div>
        )}
      </div>
    </>
  );
}

interface SingleMarketChartInlineProps {
  market: Market;
  marketLineData: MarketLineData | null;
  timeRange: "1W" | "1M" | "3M" | "ALL";
  onTimeRangeChange: (range: "1W" | "1M" | "3M" | "ALL") => void;
}

function SingleMarketChartInline({ market, marketLineData, timeRange, onTimeRangeChange }: SingleMarketChartInlineProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const prices = parseOutcomePrices(market);
  const yesPrice = prices[0] || 0;

  // Fetch smart money history data
  const conditionId = (market.conditionId || "").replace(/^0x/i, "").toLowerCase();
  const daysMap = { "1W": 7, "1M": 30, "3M": 90, "ALL": 90 };
  const { data: smartMoneyData } = useSmartMoneyHistory(conditionId, daysMap[timeRange]);

  const { xAxisData, yesData, noData, smartMoneyLine } = useMemo(() => {
    if (!marketLineData || marketLineData.priceHistory.length === 0) {
      return { xAxisData: [], yesData: [], noData: [], smartMoneyLine: [] };
    }

    const sorted = [...marketLineData.priceHistory].sort((a, b) => a.timestamp - b.timestamp);

    // Build smart money lookup by date string
    const smartMoneyByDate = new Map<string, number>();
    if (smartMoneyData?.history) {
      for (const point of smartMoneyData.history) {
        const dateStr = new Date(point.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        smartMoneyByDate.set(dateStr, point.smart_money_odds);
      }
    }

    const xAxis = sorted.map((p) => {
      const date = new Date(p.timestamp * 1000);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });

    return {
      xAxisData: xAxis,
      yesData: sorted.map((p) => parseFloat((p.price * 100).toFixed(1))),
      noData: sorted.map((p) => parseFloat(((1 - p.price) * 100).toFixed(1))),
      smartMoneyLine: xAxis.map((dateStr) => smartMoneyByDate.get(dateStr) ?? null),
    };
  }, [marketLineData, smartMoneyData]);

  const hasSmartMoneyData = smartMoneyLine.some((v) => v !== null);

  const textColor = isDark ? "#6b7280" : "#9ca3af";
  const gridColor = isDark ? "#374151" : "#f3f4f6";
  const yesColor = "#00E0AA";
  const noColor = "#ef4444";
  const smartMoneyColor = "#22d3ee"; // Cyan

  const chartOption = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: isDark ? "#1f2937" : "#ffffff",
      borderColor: isDark ? "#374151" : "#e5e7eb",
      textStyle: { color: isDark ? "#f3f4f6" : "#1f2937", fontSize: 12 },
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const date = params[0].axisValue;
        const lines = params.map((p: any) => {
          const color = p.seriesName === "YES" ? yesColor : p.seriesName === "NO" ? noColor : smartMoneyColor;
          return `<div style="display:flex;align-items:center;gap:4px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${color};"></span>
            <span>${p.seriesName}: <b>${p.value}%</b></span>
          </div>`;
        });
        return `<div style="font-size:12px;"><div style="color:${textColor};margin-bottom:4px;">${date}</div>${lines.join('')}</div>`;
      },
    },
    legend: {
      data: ["YES", "NO", ...(hasSmartMoneyData ? ["Smart Money"] : [])],
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
      splitLine: {
        lineStyle: { color: gridColor, type: "dashed" as const },
      },
      axisLabel: {
        color: textColor,
        fontSize: 10,
        formatter: (value: number) => `${value}%`,
      },
    },
    series: [
      {
        name: "YES",
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
      {
        name: "NO",
        type: "line",
        smooth: true,
        symbol: "none",
        data: noData,
        lineStyle: { width: 2, color: noColor },
      },
      ...(hasSmartMoneyData ? [{
        name: "Smart Money",
        type: "line",
        smooth: true,
        symbol: "none",
        data: smartMoneyLine,
        lineStyle: { width: 2, color: smartMoneyColor, type: "dashed" as const },
        connectNulls: true,
      }] : []),
    ],
  }), [xAxisData, yesData, noData, smartMoneyLine, hasSmartMoneyData, textColor, gridColor, isDark]);

  return (
    <>
      <div className="flex items-center justify-between mb-1 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: yesColor }} />
            <span className="text-lg font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {(yesPrice * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] text-zinc-400">YES</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: noColor }} />
            <span className="text-lg font-mono font-bold tabular-nums text-rose-600 dark:text-rose-400">
              {((1 - yesPrice) * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] text-zinc-400">NO</span>
          </div>
        </div>
        <div className="flex gap-0.5 text-[10px]">
          {(["1W", "1M", "3M", "ALL"] as const).map((range) => (
            <button
              key={range}
              onClick={() => onTimeRangeChange(range)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                range === timeRange
                  ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              }`}
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
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">
            Loading...
          </div>
        )}
      </div>
    </>
  );
}

// ============================================
// SINGLE MARKET CHART (Market View)
// ============================================

interface SingleMarketChartProps {
  market: Market;
  marketLineData: MarketLineData | null;
  timeRange: "1W" | "1M" | "3M" | "ALL";
  onTimeRangeChange: (range: "1W" | "1M" | "3M" | "ALL") => void;
}

function SingleMarketChart({ market, marketLineData, timeRange, onTimeRangeChange }: SingleMarketChartProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const prices = parseOutcomePrices(market);
  const yesPrice = prices[0] || 0;

  // Fetch smart money history data
  const conditionId = (market.conditionId || "").replace(/^0x/i, "").toLowerCase();
  const daysMap = { "1W": 7, "1M": 30, "3M": 90, "ALL": 90 };
  const { data: smartMoneyData } = useSmartMoneyHistory(conditionId, daysMap[timeRange]);

  const { xAxisData, yesData, noData, smartMoneyLine } = useMemo(() => {
    if (!marketLineData || marketLineData.priceHistory.length === 0) {
      return { xAxisData: [], yesData: [], noData: [], smartMoneyLine: [] };
    }

    const sorted = [...marketLineData.priceHistory].sort((a, b) => a.timestamp - b.timestamp);

    // Build smart money lookup by date string
    const smartMoneyByDate = new Map<string, number>();
    if (smartMoneyData?.history) {
      for (const point of smartMoneyData.history) {
        const dateStr = new Date(point.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        smartMoneyByDate.set(dateStr, point.smart_money_odds);
      }
    }

    const xAxis = sorted.map((p) => {
      const date = new Date(p.timestamp * 1000);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });

    return {
      xAxisData: xAxis,
      yesData: sorted.map((p) => parseFloat((p.price * 100).toFixed(1))),
      noData: sorted.map((p) => parseFloat(((1 - p.price) * 100).toFixed(1))),
      smartMoneyLine: xAxis.map((dateStr) => smartMoneyByDate.get(dateStr) ?? null),
    };
  }, [marketLineData, smartMoneyData]);

  const hasSmartMoneyData = smartMoneyLine.some((v) => v !== null);

  const textColor = isDark ? "#888" : "#666";
  const gridColor = isDark ? "#333" : "#e5e5e5";
  const yesColor = isDark ? "#6ee7b7" : "#059669";
  const noColor = isDark ? "#fda4af" : "#e11d48";
  const smartMoneyColor = "#22d3ee"; // Cyan

  const chartOption = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: isDark ? "#1a1a1a" : "#fff",
      borderColor: gridColor,
      textStyle: { color: isDark ? "#e5e5e5" : "#333", fontSize: 11 },
    },
    legend: {
      data: ["YES", "NO", ...(hasSmartMoneyData ? ["Smart Money"] : [])],
      top: 5,
      right: 10,
      textStyle: { color: textColor, fontSize: 10 },
    },
    grid: { left: 45, right: 15, bottom: 35, top: 40 },
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
    series: [
      {
        name: "YES",
        type: "line",
        smooth: true,
        symbol: "none",
        data: yesData,
        lineStyle: { width: 3, color: yesColor },
        areaStyle: { color: `${yesColor}20` },
      },
      {
        name: "NO",
        type: "line",
        smooth: true,
        symbol: "none",
        data: noData,
        lineStyle: { width: 2, color: noColor, opacity: 0.7 },
      },
      ...(hasSmartMoneyData ? [{
        name: "Smart Money",
        type: "line",
        smooth: true,
        symbol: "none",
        data: smartMoneyLine,
        lineStyle: { width: 2, color: smartMoneyColor, type: "dashed" as const },
        connectNulls: true,
      }] : []),
    ],
  }), [xAxisData, yesData, noData, smartMoneyLine, hasSmartMoneyData, textColor, gridColor, yesColor, noColor, smartMoneyColor, isDark]);

  return (
    <div className={`h-[360px] bg-gradient-to-b from-white to-zinc-50/50 dark:from-zinc-900 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-3 flex flex-col shadow-md`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: yesColor }} />
            <span className="text-2xl font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {(yesPrice * 100).toFixed(0)}%
            </span>
            <span className="text-sm text-zinc-500">YES</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: noColor }} />
            <span className="text-xl font-mono font-bold tabular-nums text-rose-600 dark:text-rose-400">
              {((1 - yesPrice) * 100).toFixed(0)}%
            </span>
            <span className="text-sm text-zinc-500">NO</span>
          </div>
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
      <div className="flex-1 min-h-0">
        {xAxisData.length > 0 ? (
          <ReactECharts option={chartOption} style={{ height: "100%", width: "100%" }} opts={{ renderer: "svg" }} />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">
            Loading market data...
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// EVENT ANALYSIS CARD
// ============================================

interface EventAnalysisCardProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  sectionRefs: React.MutableRefObject<Record<EventSectionKey, HTMLDivElement | null>>;
  activeSection: EventSectionKey;
  onSectionClick: (key: EventSectionKey) => void;
  event: { title: string; marketCount: number };
  markets: Market[];
  marketLineData: MarketLineData[];
  onMarketClick: (market: Market) => void;
}

function EventAnalysisCard({ scrollRef, sectionRefs, activeSection, onSectionClick, event, markets, marketLineData, onMarketClick }: EventAnalysisCardProps) {
  return (
    <div className={`h-full flex flex-col border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} bg-white dark:bg-zinc-900 overflow-hidden`}>
      {/* Tab Header */}
      <div className="flex-shrink-0 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30">
        <div className="flex overflow-x-auto scrollbar-hide">
          {eventSections.map((section) => (
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-[80vh]">
        {/* Overview Section */}
        <div ref={(el) => { sectionRefs.current.overview = el; }} className="p-5">
          <EventOverviewSection marketLineData={marketLineData} eventTitle={event.title} />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Analysis Section */}
        <div ref={(el) => { sectionRefs.current.analysis = el; }} className="p-5">
          <EventAnalysisSection />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Smart Money Section */}
        <div ref={(el) => { sectionRefs.current["smart-money"] = el; }} className="p-5">
          <EventSmartMoneySection conditionId={markets[0]?.conditionId} />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* All Markets Section */}
        <div ref={(el) => { sectionRefs.current.markets = el; }} className="p-5">
          <EventAllMarketsSection markets={markets} onMarketClick={onMarketClick} />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Domino Effects Section */}
        <div ref={(el) => { sectionRefs.current.domino = el; }} className="p-5">
          <EventDominoSection />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Statistics Section */}
        <div ref={(el) => { sectionRefs.current.statistics = el; }} className="p-5">
          <EventStatisticsSection />
        </div>
      </div>
    </div>
  );
}

// ============================================
// MARKET ANALYSIS CARD
// ============================================

interface MarketAnalysisCardProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  sectionRefs: React.MutableRefObject<Record<MarketSectionKey, HTMLDivElement | null>>;
  activeSection: MarketSectionKey;
  onSectionClick: (key: MarketSectionKey) => void;
  market: Market;
}

function MarketAnalysisCard({ scrollRef, sectionRefs, activeSection, onSectionClick, market }: MarketAnalysisCardProps) {
  return (
    <div className={`h-full flex flex-col border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} bg-white dark:bg-zinc-900 overflow-hidden`}>
      {/* Tab Header */}
      <div className="flex-shrink-0 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30">
        <div className="flex overflow-x-auto scrollbar-hide">
          {marketSections.map((section) => (
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
        </div>
      </div>

      {/* Scrollable Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-[80vh]">
        {/* Overview Section */}
        <div ref={(el) => { sectionRefs.current.overview = el; }} className="p-5">
          <MarketOverviewSection market={market} />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Rules Section */}
        <div ref={(el) => { sectionRefs.current.rules = el; }} className="p-5">
          <MarketRulesSection market={market} />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Smart Money Section */}
        <div ref={(el) => { sectionRefs.current["smart-money"] = el; }} className="p-5">
          <MarketSmartMoneySection conditionId={market.conditionId} />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Analysis Section */}
        <div ref={(el) => { sectionRefs.current.analysis = el; }} className="p-5">
          <MarketAnalysisSection />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Correlated Section */}
        <div ref={(el) => { sectionRefs.current.correlated = el; }} className="p-5">
          <MarketCorrelatedSection />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 mx-5" />

        {/* Statistics Section */}
        <div ref={(el) => { sectionRefs.current.statistics = el; }} className="p-5">
          <MarketStatisticsSection />
        </div>
      </div>
    </div>
  );
}

// ============================================
// EVENT SECTIONS
// ============================================

function EventOverviewSection({ marketLineData, eventTitle }: { marketLineData: MarketLineData[]; eventTitle: string }) {
  const topMarkets = marketLineData.slice(0, 8);

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
        {topMarkets.map((market, index) => (
          <div
            key={market.id}
            className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <span className="w-5 text-sm font-semibold text-zinc-400 tabular-nums">#{index + 1}</span>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: market.color }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{market.name}</div>
            </div>
            <span className="text-lg font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {(market.probability * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventAnalysisSection() {
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

function EventSmartMoneySection({ conditionId }: { conditionId?: string }) {
  if (!conditionId) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="w-4 h-4 text-cyan-500" />
          <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Smart Money Signal</span>
        </div>
        <p className="text-sm text-zinc-500">Select a market to view smart money data.</p>
      </div>
    );
  }

  return (
    <SmartMoneyBreakdownComponent
      conditionId={conditionId}
      showTopPositions={true}
    />
  );
}

function EventAllMarketsSection({ markets, onMarketClick }: { markets: Market[]; onMarketClick: (market: Market) => void }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <LayoutGrid className="w-4 h-4 text-cyan-500" />
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">All Markets ({markets.length})</h3>
      </div>
      <p className="text-sm text-zinc-500 mb-4">Click any market to view detailed analysis and resolution rules</p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {markets.map((market) => (
          <MarketCard key={market.id} market={market} onClick={() => onMarketClick(market)} />
        ))}
      </div>
    </div>
  );
}

function MarketCard({ market, onClick }: { market: Market; onClick: () => void }) {
  const prices = parseOutcomePrices(market);
  const outcomes = parseOutcomes(market);

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

function EventDominoSection() {
  const cascadeEffects = [
    { title: "Lending Rates Fall", desc: "Mortgage rates drop → Housing liquidity +15-20%", impact: "+15%" },
    { title: "Dollar Weakens", desc: "USD declines → EM debt relief, commodities rise", impact: "-3%" },
    { title: "Risk Assets Rally", desc: "Growth stocks & crypto outperform (+12% in 30 days)", impact: "+12%" },
    { title: "Corporate Activity", desc: "Lower borrowing costs → M&A activity increases Q1", impact: "+8%" },
  ];

  const sectorImpacts = [
    { name: "Tech", impact: "+12%", positive: true },
    { name: "REITs", impact: "+8%", positive: true },
    { name: "Utils", impact: "+5%", positive: true },
    { name: "USD", impact: "-3%", positive: false },
  ];

  const correlatedMarkets = [
    { title: "Subsequent Q1 Rate Cut", prob: 72, correlation: "high", desc: "Likely if December cut materializes" },
    { title: "S&P 500 +5% EOY", prob: 68, correlation: "high", desc: "Historically correlated with easing" },
    { title: "BTC Above $150K Feb", prob: 45, correlation: "medium", desc: "Risk assets rally on lower rates" },
    { title: "10Y Below 4%", prob: 78, correlation: "high", desc: "Yield curve responds to Fed policy" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-cyan-500" />
          <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Domino Effects</span>
        </div>
        <span className="px-2 py-0.5 text-[10px] font-medium bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 rounded">
          If YES resolves
        </span>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed">
        If the leading outcome wins, here&apos;s how the dominoes fall. Historical accuracy: 91% match to similar setups.
      </p>

      {/* Cascade Chain */}
      <div className="space-y-2 mb-6">
        {cascadeEffects.map((effect, i) => (
          <div key={i} className={`border-l-2 ${i === 0 ? "border-cyan-400" : "border-zinc-300 dark:border-zinc-600"} pl-3 py-2`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{effect.title}</span>
              <span className={`text-xs font-mono font-semibold ${effect.impact.startsWith("+") ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
                {effect.impact}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{effect.desc}</p>
          </div>
        ))}
      </div>

      {/* 30-Day Sector Impact */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 mb-6">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-3">30-Day Sector Impact</div>
        <div className="grid grid-cols-4 gap-2">
          {sectorImpacts.map((sector, i) => (
            <div key={i} className="text-center p-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg">
              <div className={`text-sm font-mono font-bold ${sector.positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
                {sector.impact}
              </div>
              <div className="text-[10px] text-zinc-600 dark:text-zinc-400 font-medium">{sector.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Correlated Markets */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-3">Correlated Markets</div>
        <div className="grid grid-cols-2 gap-3">
          {correlatedMarkets.map((market, i) => (
            <div key={i} className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 hover:border-cyan-400 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate flex-1 mr-2">{market.title}</span>
                <span className={`text-[9px] uppercase ${market.correlation === "high" ? "text-cyan-500" : "text-zinc-400"}`}>
                  {market.correlation}
                </span>
              </div>
              <p className="text-[10px] text-zinc-500 mb-2 leading-relaxed">{market.desc}</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${market.prob}%` }} />
                </div>
                <span className="text-sm font-mono font-bold text-zinc-900 dark:text-zinc-100">{market.prob}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EventStatisticsSection() {
  // Sparkline data - 7 days of cumulative YES position flow (in millions)
  const sparklineData = [1.2, 1.8, 2.1, 2.4, 3.1, 3.6, 4.2];

  // Generate SVG path for sparkline
  const generateSparklinePath = (data: number[]) => {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const width = 100;
    const height = 32;
    const padding = 2;

    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * (width - padding * 2) + padding;
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    const linePath = `M ${points.join(" L ")}`;
    const areaPath = `${linePath} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`;

    return { linePath, areaPath };
  };

  const { linePath, areaPath } = generateSparklinePath(sparklineData);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <PieChart className="w-4 h-4 text-cyan-500" />
        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Statistical Analysis</span>
      </div>

      {/* Cascadian Prediction vs Market Consensus */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Cascadian AI Prediction */}
        <div className="p-4 rounded-lg border border-cyan-500/30 bg-gradient-to-br from-cyan-50 to-white dark:from-cyan-900/20 dark:to-zinc-900">
          <div className="text-sm font-medium text-cyan-700 dark:text-cyan-400 mb-2">Cascadian Prediction</div>
          <div className="flex items-baseline gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">94%</span>
              <span className="text-sm text-zinc-500">YES</span>
            </div>
            <span className="text-zinc-300 dark:text-zinc-600">/</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-mono tabular-nums text-zinc-400">6%</span>
              <span className="text-sm text-zinc-500">NO</span>
            </div>
          </div>
          <div className="text-[10px] text-cyan-600 dark:text-cyan-400 mt-2">
            +7 pts vs market · High confidence
          </div>
        </div>

        {/* Market Consensus */}
        <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-800/50 dark:to-zinc-900">
          <div className="text-sm font-medium text-zinc-500 mb-2">Market Consensus</div>
          <div className="flex gap-4">
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">87%</span>
                <span className="text-sm font-medium text-zinc-500">YES</span>
              </div>
              <div className="text-[10px] text-zinc-500 font-mono tabular-nums">87¢</div>
            </div>
            <div className="w-px bg-zinc-200 dark:bg-zinc-700" />
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">13%</span>
                <span className="text-sm font-medium text-zinc-500">NO</span>
              </div>
              <div className="text-[10px] text-zinc-500 font-mono tabular-nums">13¢</div>
            </div>
          </div>
        </div>
      </div>

      {/* Smart Money Activity Sparkline */}
      <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-800/50 dark:to-zinc-900 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Smart Money Activity</span>
          </div>
          <span className="text-sm font-mono tabular-nums text-zinc-700 dark:text-zinc-300">82% YES</span>
        </div>
        {/* Sparkline */}
        <div className="relative h-10">
          <svg viewBox="0 0 100 32" className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="sparklineGradientEvent" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#sparklineGradientEvent)" />
            <path d={linePath} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="98" cy="4" r="2.5" fill="#22d3ee" />
          </svg>
        </div>
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-zinc-500">7-day flow</span>
          <span className="font-mono text-cyan-600 dark:text-cyan-400 font-medium">+$4.2M</span>
        </div>
      </div>

      {/* Model Details */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">91%</div>
          <div className="text-xs text-zinc-500">Historical Match</div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">0.94</div>
          <div className="text-xs text-zinc-500">Model Confidence</div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">+7 pts</div>
          <div className="text-xs text-zinc-500">Edge vs Market</div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MARKET SECTIONS
// ============================================

function MarketOverviewSection({ market }: { market: Market }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-cyan-500" />
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Market Summary</h3>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
          <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400 font-mono">94%</div>
          <div className="text-xs text-zinc-500">Cascadian Prediction</div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">+12%</div>
          <div className="text-xs text-zinc-500">7-Day Momentum</div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
          <div className="text-2xl font-bold text-violet-600 dark:text-violet-400 font-mono">High</div>
          <div className="text-xs text-zinc-500">Confidence Level</div>
        </div>
      </div>

      {/* Quick Analysis */}
      <div className="border-l-2 border-cyan-500/50 pl-3 mb-4">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Key Insight</div>
        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
          Strong smart money accumulation detected. Historical patterns suggest high probability
          of resolution in favor of leading outcome based on similar market conditions.
        </p>
      </div>

      {/* Market Status Pills */}
      <div className="flex flex-wrap gap-2">
        <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
          Active Trading
        </span>
        <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400">
          High Volume
        </span>
        <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
          Smart Money Interest
        </span>
      </div>
    </div>
  );
}

function MarketRulesSection({ market }: { market: Market }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="w-4 h-4 text-cyan-500" />
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Resolution Rules</h3>
      </div>
      <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
        {market.description ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
            {market.description}
          </p>
        ) : (
          <p className="text-sm text-zinc-500 italic">No resolution rules provided for this market.</p>
        )}
      </div>
      <div className="mt-4">
        <a
          href={`https://polymarket.com/event/${market.slug || market.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-cyan-600 dark:text-cyan-400 hover:underline"
        >
          <ExternalLink className="w-4 h-4" />
          View on Polymarket
        </a>
      </div>
    </div>
  );
}

function MarketSmartMoneySection({ conditionId }: { conditionId?: string }) {
  if (!conditionId) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="w-4 h-4 text-cyan-500" />
          <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Smart Money Signal</span>
        </div>
        <p className="text-sm text-zinc-500">No market data available.</p>
      </div>
    );
  }

  return (
    <SmartMoneyBreakdownComponent
      conditionId={conditionId}
      showTopPositions={true}
    />
  );
}

function MarketAnalysisSection() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-4 h-4 text-cyan-500" />
        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Market Analysis</span>
      </div>
      <div className="border-l-2 border-cyan-500/50 pl-3">
        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
          Detailed analysis for this specific market outcome. Our models assess probability based on
          historical patterns, current momentum, and smart money positioning.
        </p>
      </div>
    </div>
  );
}

function MarketCorrelatedSection() {
  const yesScenarios = [
    { market: "Subsequent Q1 Rate Cut", prediction: "Rises to 85%", confidence: "High" },
    { market: "S&P 500 +5% EOY", prediction: "Rises to 75%", confidence: "High" },
    { market: "BTC Above $150K", prediction: "Rises to 55%", confidence: "Medium" },
  ];

  const noScenarios = [
    { market: "Fed Holds Through 2026", prediction: "Rises to 45%", confidence: "Medium" },
    { market: "USD/EUR Above 1.10", prediction: "Rises to 60%", confidence: "High" },
    { market: "Treasury Yields Above 4.5%", prediction: "Rises to 70%", confidence: "High" },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link2 className="w-4 h-4 text-cyan-500" />
        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Correlated Outcomes</span>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
        How this market&apos;s resolution affects related markets based on historical causation analysis.
      </p>

      {/* If YES wins */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded">
            If YES wins
          </span>
        </div>
        <div className="space-y-2">
          {yesScenarios.map((item, i) => (
            <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200/50 dark:border-emerald-800/30">
              <div>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.market}</span>
                <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-2">→ {item.prediction}</span>
              </div>
              <span className={`text-[9px] uppercase ${item.confidence === "High" ? "text-cyan-500" : "text-zinc-400"}`}>
                {item.confidence}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* If NO wins */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="px-2 py-0.5 text-[10px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 rounded">
            If NO wins
          </span>
        </div>
        <div className="space-y-2">
          {noScenarios.map((item, i) => (
            <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-rose-50/50 dark:bg-rose-900/10 border border-rose-200/50 dark:border-rose-800/30">
              <div>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.market}</span>
                <span className="text-xs text-rose-600 dark:text-rose-400 ml-2">→ {item.prediction}</span>
              </div>
              <span className={`text-[9px] uppercase ${item.confidence === "High" ? "text-cyan-500" : "text-zinc-400"}`}>
                {item.confidence}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Historical Note */}
      <div className="mt-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
        <p className="text-xs text-zinc-500 leading-relaxed">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Historical Pattern:</span> When similar markets
          resolved YES in the past 8 cycles, correlated markets moved as predicted 89% of the time.
        </p>
      </div>
    </div>
  );
}

function MarketStatisticsSection() {
  // Sparkline data for this market
  const sparklineData = [0.8, 1.1, 1.4, 1.2, 1.6, 1.8, 2.1];

  const generateSparklinePath = (data: number[]) => {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const width = 100;
    const height = 32;
    const padding = 2;

    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * (width - padding * 2) + padding;
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    const linePath = `M ${points.join(" L ")}`;
    const areaPath = `${linePath} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`;

    return { linePath, areaPath };
  };

  const { linePath, areaPath } = generateSparklinePath(sparklineData);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <PieChart className="w-4 h-4 text-cyan-500" />
        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Statistical Analysis</span>
      </div>

      {/* Cascadian Prediction vs Market */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-lg border border-cyan-500/30 bg-gradient-to-br from-cyan-50 to-white dark:from-cyan-900/20 dark:to-zinc-900">
          <div className="text-sm font-medium text-cyan-700 dark:text-cyan-400 mb-2">Cascadian Prediction</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">94%</span>
            <span className="text-sm text-cyan-600 dark:text-cyan-400">YES</span>
          </div>
          <div className="text-[10px] text-cyan-600 dark:text-cyan-400 mt-1">High confidence</div>
        </div>
        <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-800/50 dark:to-zinc-900">
          <div className="text-sm font-medium text-zinc-500 mb-2">Market Price</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">87%</span>
            <span className="text-sm text-zinc-500">YES</span>
          </div>
          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">+7 pt edge</div>
        </div>
      </div>

      {/* Smart Money Flow */}
      <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-xs text-zinc-500 uppercase tracking-wide">7-Day Position Flow</span>
          </div>
          <span className="text-sm font-mono tabular-nums text-emerald-600 dark:text-emerald-400">+$2.1M</span>
        </div>
        <div className="relative h-10">
          <svg viewBox="0 0 100 32" className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="sparklineGradientMarket" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#sparklineGradientMarket)" />
            <path d={linePath} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="98" cy="4" r="2.5" fill="#22d3ee" />
          </svg>
        </div>
      </div>

      {/* Model Metrics */}
      <div className="grid grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 text-center">
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-mono">89%</div>
          <div className="text-[10px] text-zinc-500">Historical</div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 text-center">
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-mono">0.91</div>
          <div className="text-[10px] text-zinc-500">Confidence</div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 text-center">
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-mono">76%</div>
          <div className="text-[10px] text-zinc-500">Smart Money</div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 text-center">
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono">+7</div>
          <div className="text-[10px] text-zinc-500">Edge (pts)</div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// LOADING & ERROR STATES
// ============================================

function DashboardLoadingState() {
  return (
    <div className="h-[calc(100vh-4rem)] p-2">
      <div className="flex h-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
        <div className="w-56 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 p-3 animate-pulse">
          <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded mb-4" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 bg-zinc-200 dark:bg-zinc-800 rounded mb-2" />
          ))}
        </div>
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
