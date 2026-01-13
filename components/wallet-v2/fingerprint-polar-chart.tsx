"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import type { FingerprintChartProps } from "./types";
import { METRIC_COLORS_ARRAY } from "./types";

export function FingerprintPolarChart({
  metrics,
  size = 400,
  animated = true,
}: FingerprintChartProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const option = useMemo(() => {
    const data = metrics.map((m, i) => ({
      value: m.normalized,
      name: m.name,
      itemStyle: {
        color: METRIC_COLORS_ARRAY[i],
      },
    }));

    return {
      tooltip: {
        trigger: "item",
        backgroundColor: isDark ? "#1e293b" : "#ffffff",
        borderColor: isDark ? "#334155" : "#e2e8f0",
        textStyle: {
          color: isDark ? "#f1f5f9" : "#1e293b",
        },
        formatter: (params: { name: string; value: number; dataIndex: number }) => {
          const metric = metrics[params.dataIndex];
          return `
            <div style="font-weight:600;margin-bottom:4px;">${params.name}</div>
            <div style="display:flex;justify-content:space-between;gap:16px;">
              <span>Score</span>
              <strong>${params.value.toFixed(0)}/100</strong>
            </div>
            <div style="display:flex;justify-content:space-between;gap:16px;">
              <span>Value</span>
              <strong>${metric?.displayValue ?? 'N/A'}</strong>
            </div>
          `;
        },
      },
      angleAxis: {
        type: "category",
        data: metrics.map((m) => m.name),
        axisLine: {
          lineStyle: {
            color: isDark ? "#334155" : "#e2e8f0",
          },
        },
        axisLabel: {
          color: isDark ? "#94a3b8" : "#64748b",
          fontSize: 11,
          fontWeight: 500,
        },
      },
      radiusAxis: {
        min: 0,
        max: 100,
        axisLine: {
          show: false,
        },
        axisLabel: {
          show: false,
        },
        splitLine: {
          lineStyle: {
            color: isDark ? "#334155" : "#e2e8f0",
          },
        },
      },
      polar: {
        radius: ["15%", "70%"],
        center: ["50%", "50%"],
      },
      series: [
        {
          type: "bar",
          coordinateSystem: "polar",
          data,
          barWidth: "60%",
          roundCap: true,
          animationDuration: animated ? 1000 : 0,
          animationEasing: "cubicOut",
          itemStyle: {
            borderRadius: 4,
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 224, 170, 0.5)",
            },
          },
        },
      ],
    };
  }, [metrics, isDark, animated]);

  return (
    <motion.div
      initial={animated ? { opacity: 0, scale: 0.9 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <ReactECharts
        option={option}
        style={{ height: size, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge={true}
      />
    </motion.div>
  );
}
