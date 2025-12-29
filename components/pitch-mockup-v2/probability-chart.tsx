"use client";

import { useTheme } from "next-themes";
import ReactECharts from "echarts-for-react";

// Hardcoded historical data
const historicalData = [
  { date: "2025-06-01", yes: 45 },
  { date: "2025-06-15", yes: 48 },
  { date: "2025-07-01", yes: 52 },
  { date: "2025-07-15", yes: 55 },
  { date: "2025-08-01", yes: 58 },
  { date: "2025-08-15", yes: 54 },
  { date: "2025-09-01", yes: 61 },
  { date: "2025-09-15", yes: 65 },
  { date: "2025-10-01", yes: 68 },
  { date: "2025-10-15", yes: 72 },
  { date: "2025-11-01", yes: 78 },
  { date: "2025-11-15", yes: 82 },
  { date: "2025-12-01", yes: 85 },
  { date: "2025-12-10", yes: 87 },
];

// AI Projection (dotted)
const projectionData = [
  { date: "2025-12-10", yes: 87 },
  { date: "2025-12-12", yes: 88 },
  { date: "2025-12-14", yes: 90 },
  { date: "2025-12-16", yes: 92 },
  { date: "2025-12-18", yes: 94 },
];

/**
 * Probability Chart - OpenBB Terminal Style
 * Theme-aware, teal accent color
 */
export function ProbabilityChart() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // Theme-aware colors
  const textColor = isDark ? "#888" : "#666";
  const gridColor = isDark ? "#333" : "#e5e5e5";
  const bgTooltip = isDark ? "#1a1a1a" : "#fff";

  const chartOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: bgTooltip,
      borderColor: gridColor,
      borderWidth: 1,
      textStyle: { color: isDark ? "#e5e5e5" : "#333", fontSize: 11 },
      formatter: (params: any) => {
        if (!params?.[0]) return "";
        const isProjection = params[0].seriesName.includes("Projection");
        const label = isProjection ? "AI PROJECTION" : "MARKET";
        return `<span style="color:${textColor}">${label}</span><br/>
          ${params[0].name}<br/>
          YES: <strong>${params[0].value}%</strong>`;
      },
    },
    legend: {
      data: ["Market Probability", "Cascadian AI Projection"],
      top: 5,
      right: 10,
      textStyle: { color: textColor, fontSize: 10 },
      itemWidth: 16,
      itemHeight: 2,
    },
    grid: {
      left: 50,
      right: 20,
      bottom: 30,
      top: 35,
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
          return `${date.getMonth() + 1}/${date.getDate()}`;
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
      splitLine: { lineStyle: { color: gridColor, opacity: 0.5 } },
      axisLine: { show: false },
    },
    series: [
      // Historical line - teal color
      {
        name: "Market Probability",
        type: "line",
        smooth: true,
        symbol: "none",
        data: [
          ...historicalData.map((d) => d.yes),
          ...Array(projectionData.length - 1).fill(null),
        ],
        lineStyle: { width: 2, color: "#3b82f6" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(59, 130, 246, 0.2)" },
              { offset: 1, color: "rgba(59, 130, 246, 0)" },
            ],
          },
        },
      },
      // AI Projection (dotted)
      {
        name: "Cascadian AI Projection",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        data: [
          ...Array(historicalData.length - 1).fill(null),
          ...projectionData.map((d) => d.yes),
        ],
        lineStyle: {
          width: 2,
          color: isDark ? "#888" : "#666",
          type: "dashed",
        },
        itemStyle: { color: isDark ? "#888" : "#666" },
      },
      // Vertical "NOW" line
      {
        name: "Now",
        type: "line",
        markLine: {
          silent: true,
          symbol: "none",
          data: [
            {
              xAxis: "2025-12-10",
              lineStyle: { color: textColor, type: "solid", width: 1 },
              label: {
                formatter: "NOW",
                position: "start",
                color: textColor,
                fontSize: 8,
              },
            },
          ],
        },
      },
    ],
  };

  return (
    <div className="h-full bg-card border border-border rounded-lg p-3 flex flex-col">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">Price Performance</span>
          <div className="flex items-center gap-1">
            <span className="text-2xl font-mono font-bold text-blue-500">87%</span>
            <span className="text-blue-500">+2.3%</span>
          </div>
        </div>

        {/* Time range */}
        <div className="flex gap-0.5 text-[10px]">
          {["1W", "1M", "3M", "6M", "ALL"].map((range) => (
            <button
              key={range}
              className={`px-2 py-1 rounded ${
                range === "6M"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ReactECharts
          option={chartOption}
          style={{ height: "100%", width: "100%" }}
          opts={{ renderer: "canvas" }}
        />
      </div>
    </div>
  );
}
