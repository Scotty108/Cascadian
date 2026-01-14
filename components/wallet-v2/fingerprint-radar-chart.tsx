"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import type { FingerprintChartProps } from "./types";
import { METRIC_COLORS_ARRAY } from "./types";

export function FingerprintRadarChart({
  metrics,
  size = 400,
  animated = true,
}: FingerprintChartProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const option = useMemo(() => {
    const indicator = metrics.map((m, i) => ({
      name: m.name,
      max: 100,
      color: isDark ? "#94a3b8" : "#64748b",
    }));

    const values = metrics.map((m) => m.normalized);

    return {
      tooltip: {
        trigger: "item",
        backgroundColor: isDark ? "#1e293b" : "#ffffff",
        borderColor: isDark ? "#334155" : "#e2e8f0",
        textStyle: {
          color: isDark ? "#f1f5f9" : "#1e293b",
        },
        formatter: (params: { value: number[] }) => {
          return metrics
            .map(
              (m, i) =>
                `<div style="display:flex;justify-content:space-between;gap:16px;">
                  <span style="color:${METRIC_COLORS_ARRAY[i]}">${m.name}</span>
                  <strong>${m.displayValue}</strong>
                </div>`
            )
            .join("");
        },
      },
      radar: {
        indicator,
        shape: "polygon",
        splitNumber: 4,
        center: ["50%", "50%"],
        radius: "70%",
        axisName: {
          color: isDark ? "#94a3b8" : "#64748b",
          fontSize: 10,
          fontWeight: 500,
          padding: [0, 0, 0, 0],
        },
        nameGap: 8,
        axisLine: {
          lineStyle: {
            color: isDark ? "#334155" : "#e2e8f0",
          },
        },
        splitLine: {
          lineStyle: {
            color: isDark ? "#334155" : "#e2e8f0",
          },
        },
        splitArea: {
          show: true,
          areaStyle: {
            color: isDark
              ? ["rgba(51, 65, 85, 0.2)", "rgba(51, 65, 85, 0.1)"]
              : ["rgba(226, 232, 240, 0.5)", "rgba(226, 232, 240, 0.2)"],
          },
        },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: values,
              name: "Wallet Fingerprint",
              symbol: "circle",
              symbolSize: 6,
              lineStyle: {
                color: "#00E0AA",
                width: 2,
              },
              areaStyle: {
                color: {
                  type: "radial",
                  x: 0.5,
                  y: 0.5,
                  r: 0.5,
                  colorStops: [
                    { offset: 0, color: "rgba(0, 224, 170, 0.4)" },
                    { offset: 1, color: "rgba(0, 224, 170, 0.1)" },
                  ],
                },
              },
              itemStyle: {
                color: "#00E0AA",
                borderColor: "#fff",
                borderWidth: 2,
              },
            },
          ],
          animationDuration: animated ? 1000 : 0,
          animationEasing: "cubicOut",
        },
      ],
    };
  }, [metrics, isDark, animated]);

  return (
    <div style={{ width: size, height: size }}>
      <ReactECharts
        option={option}
        style={{ height: "100%", width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge={true}
      />
    </div>
  );
}
