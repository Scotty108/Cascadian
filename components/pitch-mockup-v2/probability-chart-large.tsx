"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import ReactECharts from "echarts-for-react";
import { Expand, Minimize2, X } from "lucide-react";

// ============================================
// TOGGLE: Change to "rounded" to revert back
// ============================================
const CORNER_STYLE: "rounded" | "sharp" = "sharp";

// Historical market data with dates
const historicalData = [
  { date: "2025-06-01", yes: 38 },
  { date: "2025-06-15", yes: 45 },
  { date: "2025-07-01", yes: 52 },
  { date: "2025-07-15", yes: 48 },
  { date: "2025-08-01", yes: 55 },
  { date: "2025-08-15", yes: 42 },
  { date: "2025-09-01", yes: 58 },
  { date: "2025-09-15", yes: 68 },
  { date: "2025-10-01", yes: 62 },
  { date: "2025-10-15", yes: 71 },
  { date: "2025-11-01", yes: 78 },
  { date: "2025-11-15", yes: 82 },
  { date: "2025-12-01", yes: 85 },
  { date: "2025-12-10", yes: 87 },
];

// Cascadian AI predictions - consistently higher than market
const cascadianHistorical = [
  { date: "2025-06-01", yes: 58 },
  { date: "2025-06-15", yes: 62 },
  { date: "2025-07-01", yes: 68 },
  { date: "2025-07-15", yes: 65 },
  { date: "2025-08-01", yes: 72 },
  { date: "2025-08-15", yes: 67 },
  { date: "2025-09-01", yes: 75 },
  { date: "2025-09-15", yes: 82 },
  { date: "2025-10-01", yes: 80 },
  { date: "2025-10-15", yes: 85 },
  { date: "2025-11-01", yes: 89 },
  { date: "2025-11-15", yes: 91 },
  { date: "2025-12-01", yes: 93 },
  { date: "2025-12-10", yes: 94 },
];

// AI Future Projection
const projectionData = [
  { date: "2025-12-10", yes: 94 },
  { date: "2025-12-12", yes: 95 },
  { date: "2025-12-14", yes: 96 },
  { date: "2025-12-16", yes: 97 },
  { date: "2025-12-18", yes: 98 },
];

// Key events that moved the market
const eventMarkers = [
  { date: "2025-07-01", yes: 52, event: "FOMC Minutes", detail: "Dovish tone noted" },
  { date: "2025-08-15", yes: 42, event: "Jobs Report", detail: "Market panicked, AI stayed bullish" },
  { date: "2025-09-15", yes: 68, event: "Powell Speech", detail: "Market caught up to AI" },
  { date: "2025-11-01", yes: 78, event: "CPI Data", detail: "2.3% vs 2.5% expected" },
  { date: "2025-12-01", yes: 85, event: "Beige Book", detail: "Economy cooling confirmed" },
];

// Cascadian AI insight markers - showing why AI was confident
const aiInsightMarkers = [
  { date: "2025-06-15", yes: 62, insight: "Fed Language Shift", detail: "NLP detected dovish pivot in communications" },
  { date: "2025-08-15", yes: 67, insight: "Contrarian Signal", detail: "Smart money accumulating despite panic" },
  { date: "2025-10-01", yes: 80, insight: "Pattern Match", detail: "91% match to Dec 2018 setup" },
  { date: "2025-11-15", yes: 91, insight: "Convergence", detail: "All signals aligned: Fed + inflation + labor" },
];

/**
 * Probability Chart - Large Version
 * Full-width chart with YES/NO lines and AI projection
 */
export function ProbabilityChartLarge() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isExpanded, setIsExpanded] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

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

  // Theme-aware colors
  const textColor = isDark ? "#888" : "#666";
  const gridColor = isDark ? "#333" : "#e5e5e5";
  const bgTooltip = isDark ? "#1a1a1a" : "#fff";

  // Soft distinguishable colors for YES/NO lines
  const yesLineColor = isDark ? "#6ee7b7" : "#059669"; // Soft emerald/green
  const noLineColor = isDark ? "#fda4af" : "#e11d48";   // Soft rose/pink

  const chartOption = {
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
        let html = `<div style="color:${textColor};margin-bottom:4px">${date}</div>`;

        // Check if this is an event marker
        const eventParam = params.find((p: any) => p.seriesName === "Events");
        if (eventParam && eventParam.data) {
          const eventData = eventParam.data;
          html += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid ${gridColor}">`;
          html += `<div style="color:${isDark ? "#a1a1aa" : "#71717a"};font-weight:600">📰 ${eventData.event}</div>`;
          html += `<div style="color:${textColor};font-size:11px">${eventData.detail}</div>`;
          html += `</div>`;
        }

        // Check if this is an AI insight marker
        const aiParam = params.find((p: any) => p.seriesName === "AI Insights");
        if (aiParam && aiParam.data) {
          const aiData = aiParam.data;
          html += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid ${gridColor}">`;
          html += `<div style="color:#22d3ee;font-weight:600">◆ ${aiData.insight}</div>`;
          html += `<div style="color:${textColor};font-size:11px">${aiData.detail}</div>`;
          html += `</div>`;
        }

        params.forEach((p: any) => {
          if (p.value !== null && p.value !== undefined && p.seriesName !== "Events" && p.seriesName !== "AI Insights") {
            const color = p.seriesName.includes("YES") ? yesLineColor :
                         p.seriesName.includes("NO") ? noLineColor :
                         p.seriesName.includes("Cascadian") ? "#22d3ee" : textColor;
            html += `<div>${p.seriesName}: <strong style="color:${color}">${p.value}%</strong></div>`;
          }
        });
        return html;
      },
    },
    legend: {
      data: ["YES (Market)", "NO (Market)", "Cascadian AI"],
      top: 5,
      right: 10,
      textStyle: { color: textColor, fontSize: 10 },
      itemWidth: 16,
      itemHeight: 3,
    },
    grid: {
      left: 45,
      right: 20,
      bottom: 35,
      top: 40,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: [
        ...historicalData.map((d) => d.date),
        ...projectionData.slice(1).map((d) => d.date),
      ],
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          return `${date.toLocaleDateString("en-US", { month: "short" })} ${date.getDate()}`;
        },
        color: textColor,
        fontSize: 9,
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
    series: [
      // YES line - soft emerald/green (historical)
      {
        name: "YES (Market)",
        type: "line",
        smooth: true,
        symbol: "none",
        data: [
          ...historicalData.map((d) => d.yes),
          ...Array(projectionData.length - 1).fill(null),
        ],
        lineStyle: { width: 2, color: yesLineColor, opacity: 0.7 },
      },
      // YES projection - teal dashed line from NOW (Cascadian projection)
      {
        name: "YES Projection",
        type: "line",
        smooth: true,
        symbol: "none",
        data: [
          ...Array(historicalData.length - 1).fill(null),
          historicalData[historicalData.length - 1].yes, // Start at last historical point
          ...projectionData.slice(1).map((d) => d.yes),
        ],
        lineStyle: { width: 2, color: "#22d3ee", type: "dashed", opacity: 0.8 },
      },
      // NO line - soft rose/pink (historical)
      {
        name: "NO (Market)",
        type: "line",
        smooth: true,
        symbol: "none",
        data: [
          ...historicalData.map((d) => 100 - d.yes),
          ...Array(projectionData.length - 1).fill(null),
        ],
        lineStyle: { width: 1.5, color: noLineColor, opacity: 0.5 },
      },
      // NO projection - teal dashed line from NOW (Cascadian projection)
      {
        name: "NO Projection",
        type: "line",
        smooth: true,
        symbol: "none",
        data: [
          ...Array(historicalData.length - 1).fill(null),
          100 - historicalData[historicalData.length - 1].yes, // Start at last historical point
          ...projectionData.slice(1).map((d) => 100 - d.yes),
        ],
        lineStyle: { width: 1.5, color: "#22d3ee", type: "dashed", opacity: 0.5 },
      },
      // Cascadian AI - historical predictions (solid cyan)
      {
        name: "Cascadian AI",
        type: "line",
        smooth: true,
        symbol: "none",
        data: [
          ...cascadianHistorical.map((d) => d.yes),
          ...projectionData.slice(1).map((d) => d.yes),
        ],
        lineStyle: { width: 3, color: "#22d3ee" },
      },
      // "NOW" line - Label at bottom center, above date axis
      {
        name: "Now",
        type: "line",
        markLine: {
          silent: true,
          symbol: ["none", "none"],
          data: [
            {
              xAxis: "2025-12-10",
              lineStyle: {
                color: "#22d3ee",
                type: "solid",
                width: 2,
                shadowColor: "rgba(34, 211, 238, 0.4)",
                shadowBlur: 6,
              },
              label: {
                formatter: "NOW",
                position: "insideEndBottom",
                color: "#22d3ee",
                fontSize: 10,
                fontWeight: "bold",
                backgroundColor: isDark ? "#18181b" : "#ffffff",
                padding: [2, 6],
                borderRadius: 3,
                borderColor: "#22d3ee",
                borderWidth: 1,
                rotate: 0,
                offset: [0, 5],
              },
            },
          ],
        },
      },
      // Mark area for "past" region - subtle shading
      {
        name: "Past",
        type: "line",
        markArea: {
          silent: true,
          data: [
            [
              { xAxis: "2025-06-01" },
              { xAxis: "2025-12-10" },
            ],
          ],
          itemStyle: {
            color: isDark ? "rgba(39, 39, 42, 0.3)" : "rgba(244, 244, 245, 0.5)",
          },
        },
      },
      // Event markers - subtle points on market line
      {
        name: "Events",
        type: "scatter",
        symbol: "circle",
        symbolSize: 8,
        z: 10,
        data: eventMarkers.map((e) => ({
          value: [e.date, e.yes],
          event: e.event,
          detail: e.detail,
        })),
        itemStyle: {
          color: isDark ? "#a1a1aa" : "#71717a",
          borderColor: isDark ? "#09090b" : "#fff",
          borderWidth: 2,
        },
        emphasis: {
          scale: 1.4,
          itemStyle: {
            shadowBlur: 8,
            shadowColor: "rgba(113, 113, 122, 0.5)",
          },
        },
        cursor: "pointer",
      },
      // Cascadian AI insight markers - cyan dots on AI line
      {
        name: "AI Insights",
        type: "scatter",
        symbol: "diamond",
        symbolSize: 10,
        z: 11,
        data: aiInsightMarkers.map((e) => ({
          value: [e.date, e.yes],
          insight: e.insight,
          detail: e.detail,
        })),
        itemStyle: {
          color: "#22d3ee",
          borderColor: isDark ? "#09090b" : "#fff",
          borderWidth: 2,
        },
        emphasis: {
          scale: 1.5,
          itemStyle: {
            shadowBlur: 12,
            shadowColor: "rgba(34, 211, 238, 0.6)",
          },
        },
        cursor: "pointer",
      },
    ],
  };

  return (
    <div className={`h-full bg-gradient-to-b from-white to-zinc-50/50 dark:from-zinc-900 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-3 flex flex-col shadow-md hover:shadow-lg transition-shadow duration-200`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-mono font-bold tabular-nums text-zinc-800 dark:text-zinc-100">87%</span>
            <span className="text-sm font-medium text-cyan-500">+2.3%</span>
          </div>
          <span className="text-[10px] text-zinc-500 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-zinc-400" />
            Events
          </span>
          <span className="text-[10px] text-zinc-500 flex items-center gap-1">
            <span className="w-2 h-2 rotate-45 bg-cyan-400" />
            AI Insights
          </span>
        </div>

        {/* Time range + Expand */}
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 text-[11px]">
            {["1W", "1M", "3M", "6M", "ALL"].map((range) => (
              <button
                key={range}
                className={`px-2 py-1 rounded transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 ${
                  range === "6M"
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
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-mono font-bold text-zinc-800 dark:text-zinc-100">87%</span>
                  <span className="text-lg font-medium text-cyan-500">+2.3%</span>
                </div>
                <span className="text-sm text-zinc-500">Fed Rate Cut December 2025</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1 text-sm mr-4">
                  {["1W", "1M", "3M", "6M", "ALL"].map((range) => (
                    <button
                      key={range}
                      className={`px-3 py-1.5 rounded transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 ${
                        range === "6M"
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
              <ReactECharts
                option={chartOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas", devicePixelRatio: 2 }}
              />
            </div>

            {/* Smart Money Signal - Footer */}
            <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <span className="text-sm text-zinc-500 uppercase tracking-wide font-medium">Smart Money</span>
                <div className="w-48 h-3 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-400 rounded-full" style={{ width: "82%" }} />
                </div>
                <span className="text-lg font-mono font-bold text-zinc-800 dark:text-zinc-100">82% YES</span>
              </div>
              <div className="flex items-center gap-4 text-sm text-zinc-500">
                <span><span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">38</span> superforecasters betting YES</span>
                <span className="text-zinc-400">Polymarket · Kalshi · Robinhood</span>
              </div>
            </div>
          </div>
        </div>,
        portalContainer
      )}

      {/* Chart */}
      <div className="flex-1 min-h-[160px]">
        <ReactECharts
          option={chartOption}
          style={{ height: "100%", width: "100%" }}
          opts={{ renderer: "canvas", devicePixelRatio: 2 }}
        />
      </div>

      {/* Smart Money Signal - Sized up */}
      <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xs text-zinc-500 uppercase tracking-wide font-medium whitespace-nowrap">Smart Money</span>
          <div className="w-28 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-400 rounded-full" style={{ width: "82%" }} />
          </div>
          <span className="text-sm font-mono font-bold text-zinc-800 dark:text-zinc-100 whitespace-nowrap">82% YES</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="whitespace-nowrap"><span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">38</span> superforecasters betting YES</span>
          <span className="text-[11px] text-zinc-400 whitespace-nowrap">Polymarket · Kalshi · Robinhood</span>
        </div>
      </div>
    </div>
  );
}
