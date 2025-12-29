"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import { useQueries } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { Expand, Minimize2, X, RefreshCw } from "lucide-react";

// ============================================
// TYPES
// ============================================

interface Market {
  id: string;
  question: string;
  outcomes: string[] | string;
  outcomePrices: string;
  active: boolean;
  closed: boolean;
}

interface OHLCDataPoint {
  t: number;  // Unix timestamp (seconds)
  c: number;  // Close price (probability)
}

interface OutcomeTimeline {
  marketId: string;
  marketTitle: string;
  outcome: string;
  outcomeIndex: number;
  color: string;
  data: Array<{ timestamp: number; probability: number }>;
  currentProb: number;
}

interface ProbabilityTimelineRealProps {
  markets: Market[];
  eventTitle?: string;
}

// ============================================
// COLOR PALETTE
// ============================================

const OUTCOME_COLORS = [
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
  "#2dd4bf", // teal
  "#facc15", // yellow
];

const CORNER_STYLE: "rounded" | "sharp" = "sharp";

// ============================================
// MAIN COMPONENT
// ============================================

export function ProbabilityTimelineReal({ markets, eventTitle }: ProbabilityTimelineRealProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isExpanded, setIsExpanded] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [timeRange, setTimeRange] = useState<"1W" | "1M" | "3M" | "6M" | "ALL">("1M");

  // SSR-safe portal container
  useEffect(() => {
    setPortalContainer(document.body);
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isExpanded) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isExpanded]);

  // Prevent body scroll when expanded
  useEffect(() => {
    if (isExpanded) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isExpanded]);

  // Limit to top 8 markets by default to avoid visual clutter
  const topMarkets = useMemo(() => {
    // Sort by highest probability outcome and take top 8
    return markets.slice(0, 8);
  }, [markets]);

  // Fetch OHLC data for each market
  const ohlcQueries = useQueries({
    queries: topMarkets.map((market) => ({
      queryKey: ["market-ohlc", market.id, timeRange],
      queryFn: async () => {
        // Calculate time range
        const now = Math.floor(Date.now() / 1000);
        const ranges: Record<string, number> = {
          "1W": 7 * 24 * 60 * 60,
          "1M": 30 * 24 * 60 * 60,
          "3M": 90 * 24 * 60 * 60,
          "6M": 180 * 24 * 60 * 60,
          "ALL": 365 * 24 * 60 * 60,
        };
        const startTs = now - (ranges[timeRange] || ranges["1M"]);

        const response = await fetch(
          `/api/polymarket/ohlc/${market.id}?interval=max&startTs=${startTs}&endTs=${now}`
        );

        if (!response.ok) {
          return { data: [], marketId: market.id };
        }

        const result = await response.json();
        return { data: result.data || [], marketId: market.id };
      },
      staleTime: 2 * 60 * 1000, // 2 minutes
      retry: 1,
    })),
  });

  const isLoading = ohlcQueries.some((q) => q.isLoading);
  const hasError = ohlcQueries.every((q) => q.isError);

  // Build outcome timelines from OHLC data
  const outcomeTimelines = useMemo(() => {
    const timelines: OutcomeTimeline[] = [];
    let colorIndex = 0;

    topMarkets.forEach((market, marketIndex) => {
      const queryResult = ohlcQueries[marketIndex];
      const ohlcData = queryResult.data?.data || [];

      // Parse outcomes
      let outcomes: string[] = [];
      if (Array.isArray(market.outcomes)) {
        outcomes = market.outcomes;
      } else if (typeof market.outcomes === "string") {
        try {
          outcomes = JSON.parse(market.outcomes);
        } catch {
          outcomes = [];
        }
      }

      // Parse current prices
      let prices: number[] = [];
      try {
        const parsed = JSON.parse(market.outcomePrices || "[]");
        prices = parsed.map((p: string | number) => (typeof p === "string" ? parseFloat(p) : p));
      } catch {
        prices = [];
      }

      // For binary markets (YES/NO), we only show the YES outcome
      // For multi-outcome markets, we show all outcomes
      const isBinary = outcomes.length === 2 &&
        (outcomes.includes("Yes") || outcomes.includes("YES") || outcomes.includes("yes"));

      if (isBinary) {
        // Only add YES outcome
        const yesIndex = outcomes.findIndex(o =>
          o.toLowerCase() === "yes"
        );
        const idx = yesIndex >= 0 ? yesIndex : 0;

        timelines.push({
          marketId: market.id,
          marketTitle: market.question,
          outcome: shortenMarketTitle(market.question),
          outcomeIndex: idx,
          color: OUTCOME_COLORS[colorIndex % OUTCOME_COLORS.length],
          data: ohlcData.map((point: OHLCDataPoint) => ({
            timestamp: point.t,
            probability: point.c,
          })),
          currentProb: prices[idx] || 0,
        });
        colorIndex++;
      } else {
        // Multi-outcome market - add all outcomes
        outcomes.forEach((outcome, idx) => {
          // For multi-outcome, all share the same OHLC data (approximation)
          // In reality, each token would have its own price history
          // For now, we show the market-level price and label by outcome
          if (idx === 0) {
            timelines.push({
              marketId: market.id,
              marketTitle: market.question,
              outcome: outcome.length > 25 ? outcome.slice(0, 22) + "..." : outcome,
              outcomeIndex: idx,
              color: OUTCOME_COLORS[colorIndex % OUTCOME_COLORS.length],
              data: ohlcData.map((point: OHLCDataPoint) => ({
                timestamp: point.t,
                probability: point.c,
              })),
              currentProb: prices[idx] || 0,
            });
            colorIndex++;
          }
        });
      }
    });

    // Sort by current probability (highest first)
    return timelines.sort((a, b) => b.currentProb - a.currentProb).slice(0, 10);
  }, [topMarkets, ohlcQueries]);

  // Build unified x-axis (all timestamps across all timelines)
  const { xAxisData, chartData } = useMemo(() => {
    // Collect all unique timestamps
    const allTimestamps = new Set<number>();
    outcomeTimelines.forEach((timeline) => {
      timeline.data.forEach((d) => allTimestamps.add(d.timestamp));
    });

    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    // Build data for each timeline aligned to x-axis
    const data = outcomeTimelines.map((timeline) => {
      const timestampMap = new Map(timeline.data.map((d) => [d.timestamp, d.probability]));
      return sortedTimestamps.map((ts) => {
        const prob = timestampMap.get(ts);
        return prob !== undefined ? parseFloat((prob * 100).toFixed(1)) : null;
      });
    });

    return {
      xAxisData: sortedTimestamps.map((ts) => {
        const date = new Date(ts * 1000);
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }),
      chartData: data,
    };
  }, [outcomeTimelines]);

  // Theme-aware colors
  const textColor = isDark ? "#888" : "#666";
  const gridColor = isDark ? "#333" : "#e5e5e5";
  const bgTooltip = isDark ? "#1a1a1a" : "#fff";

  // ECharts option
  const chartOption = useMemo(() => {
    if (outcomeTimelines.length === 0) return {};

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: bgTooltip,
        borderColor: gridColor,
        borderWidth: 1,
        textStyle: { color: isDark ? "#e5e5e5" : "#333", fontSize: 12 },
        formatter: (params: any) => {
          if (!params?.length) return "";
          const date = params[0].name;
          let html = `<div style="color:${textColor};margin-bottom:4px;font-weight:600">${date}</div>`;

          params.forEach((p: any) => {
            if (p.value !== null && p.value !== undefined) {
              html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">`;
              html += `<span style="width:8px;height:8px;border-radius:50%;background:${p.color}"></span>`;
              html += `<span style="flex:1;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.seriesName}</span>`;
              html += `<strong style="color:${p.color}">${p.value}%</strong>`;
              html += `</div>`;
            }
          });
          return html;
        },
      },
      legend: {
        type: "scroll",
        data: outcomeTimelines.map((t) => t.outcome),
        top: 5,
        right: 10,
        left: 100,
        textStyle: { color: textColor, fontSize: 10 },
        itemWidth: 16,
        itemHeight: 3,
        pageTextStyle: { color: textColor },
      },
      grid: {
        left: 45,
        right: 20,
        bottom: 35,
        top: 45,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: xAxisData,
        axisLabel: {
          color: textColor,
          fontSize: 9,
          interval: "auto",
        },
        axisLine: { lineStyle: { color: gridColor } },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: {
          formatter: "{value}%",
          color: textColor,
          fontSize: 9,
        },
        splitLine: { lineStyle: { color: gridColor, opacity: 0.4 } },
        axisLine: { show: false },
      },
      series: outcomeTimelines.map((timeline, idx) => ({
        name: timeline.outcome,
        type: "line",
        smooth: true,
        symbol: "none",
        data: chartData[idx],
        lineStyle: {
          width: idx === 0 ? 3 : 2,
          color: timeline.color,
          opacity: idx < 3 ? 1 : 0.7,
        },
        emphasis: {
          focus: "series",
          lineStyle: { width: 4 },
        },
      })),
    };
  }, [outcomeTimelines, xAxisData, chartData, textColor, gridColor, bgTooltip, isDark]);

  // Find leading outcome
  const leadingOutcome = outcomeTimelines[0];

  if (hasError || markets.length === 0) {
    return (
      <div className={`h-full bg-gradient-to-b from-white to-zinc-50/50 dark:from-zinc-900 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-4 flex items-center justify-center`}>
        <p className="text-sm text-zinc-500">No price history available</p>
      </div>
    );
  }

  return (
    <div className={`h-full bg-gradient-to-b from-white to-zinc-50/50 dark:from-zinc-900 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-3 flex flex-col shadow-md hover:shadow-lg transition-shadow duration-200`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          {leadingOutcome && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-mono font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {(leadingOutcome.currentProb * 100).toFixed(0)}%
                </span>
                <span className="text-sm font-medium text-cyan-500 truncate max-w-[140px]">
                  {leadingOutcome.outcome}
                </span>
              </div>
            </>
          )}
          {isLoading && (
            <RefreshCw className="w-4 h-4 text-cyan-500 animate-spin" />
          )}
        </div>

        {/* Time range + Expand */}
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 text-[11px]">
            {(["1W", "1M", "3M", "6M", "ALL"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2 py-1 rounded transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 ${
                  range === timeRange
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {range}
              </button>
            ))}
          </div>
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
            title="Expand to fullscreen"
          >
            <Expand className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Fullscreen Expanded Modal */}
      {portalContainer && isExpanded && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`bg-white dark:bg-zinc-900 ${CORNER_STYLE === "rounded" ? "rounded-2xl" : "rounded-xl"} w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl border border-zinc-200 dark:border-zinc-700`}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-4">
                {leadingOutcome && (
                  <div className="flex items-center gap-2">
                    <span className="text-3xl font-mono font-bold text-zinc-800 dark:text-zinc-100">
                      {(leadingOutcome.currentProb * 100).toFixed(0)}%
                    </span>
                    <span className="text-lg font-medium text-cyan-500">
                      {leadingOutcome.outcome}
                    </span>
                  </div>
                )}
                {eventTitle && (
                  <span className="text-sm text-zinc-500">{eventTitle}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1 text-sm mr-4">
                  {(["1W", "1M", "3M", "6M", "ALL"] as const).map((range) => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={`px-3 py-1.5 rounded transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 ${
                        range === timeRange
                          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                          : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  title="Minimize (Esc)"
                >
                  <Minimize2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  title="Close (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Expanded Chart */}
            <div className="flex-1 p-6">
              {isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <RefreshCw className="w-8 h-8 text-cyan-500 animate-spin" />
                </div>
              ) : (
                <ReactECharts
                  option={chartOption}
                  style={{ height: "100%", width: "100%" }}
                  opts={{ renderer: "canvas", devicePixelRatio: 2 }}
                />
              )}
            </div>

            {/* Outcome Legend - Footer */}
            <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800">
              <div className="flex flex-wrap gap-4">
                {outcomeTimelines.slice(0, 8).map((t) => (
                  <div key={t.marketId + t.outcomeIndex} className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                    <span className="text-sm text-zinc-600 dark:text-zinc-400 truncate max-w-[180px]">
                      {t.outcome}
                    </span>
                    <span className="text-sm font-mono font-bold text-zinc-900 dark:text-zinc-100">
                      {(t.currentProb * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>,
        portalContainer
      )}

      {/* Chart */}
      <div className="flex-1 min-h-[160px]">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <RefreshCw className="w-6 h-6 text-cyan-500 animate-spin" />
          </div>
        ) : xAxisData.length > 0 ? (
          <ReactECharts
            option={chartOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas", devicePixelRatio: 2 }}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-zinc-500">No historical data available</p>
          </div>
        )}
      </div>

      {/* Outcome Chips - Bottom Bar */}
      <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-3 overflow-x-auto scrollbar-hide">
        {outcomeTimelines.slice(0, 5).map((t) => (
          <div
            key={t.marketId + t.outcomeIndex}
            className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 flex-shrink-0"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: t.color }}
            />
            <span className="text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[100px]">
              {t.outcome}
            </span>
            <span className="text-xs font-mono font-semibold text-zinc-900 dark:text-zinc-100">
              {(t.currentProb * 100).toFixed(0)}%
            </span>
          </div>
        ))}
        {outcomeTimelines.length > 5 && (
          <span className="text-xs text-zinc-500 flex-shrink-0">
            +{outcomeTimelines.length - 5} more
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================
// HELPERS
// ============================================

function shortenMarketTitle(title: string): string {
  // Remove common prefixes and simplify the title
  const cleaned = title
    .replace(/^Will\s+/i, "")
    .replace(/\?$/g, "")
    .replace(/\s+in\s+\d{4}$/i, "")
    .replace(/\s+by\s+end\s+of\s+\d{4}$/i, "");

  if (cleaned.length > 30) {
    return cleaned.slice(0, 27) + "...";
  }
  return cleaned;
}
