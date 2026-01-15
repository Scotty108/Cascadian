"use client";

import { useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Clock } from "lucide-react";
import { useTheme } from "next-themes";
import ReactECharts from "echarts-for-react";
import useSWR from "swr";

type Period = "1D" | "1W" | "1M" | "ALL";

interface PnLDataPoint {
  timestamp: string;
  daily_pnl: number;
  cumulative_pnl: number;
}

interface PnLHistoryResponse {
  success: boolean;
  data: PnLDataPoint[];
  total_realized_pnl: number;
  period: string;
  using_fallback?: boolean;
  last_activity?: string;
  total_positions?: number;
}

interface PnLHistoryChartProps {
  walletAddress: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatDate(dateStr: string, period: Period): string {
  const date = new Date(dateStr);

  // Check if timestamp has time component
  const hasTime = dateStr.includes("T") || dateStr.includes(" ");

  if (period === "1D") {
    // For 1D (15-min intervals), show time with minutes
    if (hasTime) {
      return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  if (period === "1W") {
    // For 1W (hourly), show date + hour
    if (hasTime) {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
        " " + date.toLocaleTimeString("en-US", { hour: "2-digit" });
    }
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  if (period === "1M") {
    // For 1M (6-hour intervals), show date + time block
    if (hasTime) {
      const hour = date.getHours();
      const timeBlock = hour === 0 ? "00:00" : `${hour}:00`;
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + timeBlock;
    }
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // For ALL (6-hour intervals), show date + time if available
  if (hasTime) {
    const hour = date.getHours();
    if (hour !== 0) {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + hour + ":00";
    }
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

export function PnLHistoryChart({ walletAddress }: PnLHistoryChartProps) {
  const { theme } = useTheme();
  const [period, setPeriod] = useState<Period>("ALL");
  const [mounted, setMounted] = useState(false);

  // Prevent SSR/hydration issues with ECharts tooltips
  useEffect(() => {
    setMounted(true);
  }, []);

  const { data, isLoading, error } = useSWR<PnLHistoryResponse>(
    `/api/wio/wallet/${walletAddress}/pnl-history?period=${period}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  const isDark = theme === "dark";

  // Calculate change for the selected period
  const periodChange = useMemo(() => {
    if (!data?.data || data.data.length < 2) return null;
    const first = data.data[0].cumulative_pnl - data.data[0].daily_pnl;
    const last = data.data[data.data.length - 1].cumulative_pnl;
    return last - first;
  }, [data]);

  const chartOptions = useMemo(() => {
    if (!data?.data || data.data.length === 0) return null;

    const xData = data.data.map((d) => formatDate(d.timestamp, period));
    const yData = data.data.map((d) => d.cumulative_pnl);

    // Determine line color based on trend (green if ending higher than starting)
    const isPositive = yData.length > 1 ? yData[yData.length - 1] >= yData[0] : true;
    const lineColor = isPositive ? "#00E0AA" : "#ef4444";
    const areaColor = isPositive
      ? "rgba(0, 224, 170, 0.1)"
      : "rgba(239, 68, 68, 0.1)";

    return {
      grid: {
        top: 20,
        right: 20,
        bottom: 30,
        left: 60,
        containLabel: false,
      },
      tooltip: {
        trigger: "axis",
        appendToBody: true,
        backgroundColor: isDark ? "#1f1f1f" : "#fff",
        borderColor: isDark ? "#333" : "#e5e5e5",
        textStyle: {
          color: isDark ? "#fff" : "#333",
        },
        formatter: (params: any) => {
          const point = params[0];
          const dataIndex = point.dataIndex;
          const original = data.data[dataIndex];
          return `
            <div style="font-size: 12px;">
              <div style="font-weight: 600; margin-bottom: 4px;">${point.name}</div>
              <div>Cumulative: <span style="color: ${lineColor}; font-weight: 600;">${formatCurrency(original.cumulative_pnl)}</span></div>
              <div>Period: <span style="color: ${original.daily_pnl >= 0 ? "#00E0AA" : "#ef4444"};">${formatCurrency(original.daily_pnl)}</span></div>
            </div>
          `;
        },
      },
      xAxis: {
        type: "category",
        data: xData,
        axisLine: {
          lineStyle: { color: isDark ? "#333" : "#e5e5e5" },
        },
        axisLabel: {
          color: isDark ? "#888" : "#666",
          fontSize: 11,
          interval: Math.floor(xData.length / 6),
        },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        splitLine: {
          lineStyle: { color: isDark ? "#222" : "#f0f0f0" },
        },
        axisLabel: {
          color: isDark ? "#888" : "#666",
          fontSize: 11,
          formatter: (value: number) => {
            if (Math.abs(value) >= 1000) {
              return `$${(value / 1000).toFixed(0)}k`;
            }
            return `$${value.toFixed(0)}`;
          },
        },
      },
      series: [
        {
          type: "line",
          data: yData,
          smooth: true,
          symbol: "none",
          lineStyle: {
            color: lineColor,
            width: 2,
          },
          areaStyle: {
            color: areaColor,
          },
        },
      ],
    };
  }, [data, isDark, period]);

  const periods: Period[] = ["1D", "1W", "1M", "ALL"];

  return (
    <Card className="p-6 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-[#00E0AA]" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            PnL Over Time
          </h2>
          {periodChange !== null && (
            <span
              className={`text-sm font-semibold ${
                periodChange >= 0 ? "text-[#00E0AA]" : "text-red-500"
              }`}
            >
              {formatCurrency(periodChange)}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {periods.map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "ghost"}
              size="sm"
              onClick={() => setPeriod(p)}
              className={`h-7 px-3 text-xs ${
                period === p
                  ? "bg-[#00E0AA] text-black hover:bg-[#00E0AA]/90"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </Button>
          ))}
        </div>
      </div>

      {/* Fallback indicator */}
      {data?.using_fallback && data?.last_activity && (
        <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>
            Last activity: {formatTimeAgo(data.last_activity)} — Showing recent {data.data.length} positions
          </span>
        </div>
      )}

      <div className="h-[280px]">
        {(isLoading || !mounted) && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-[#00E0AA]" />
          </div>
        )}

        {mounted && error && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Failed to load PnL history
          </div>
        )}

        {mounted && !isLoading && !error && (!data?.data || data.data.length === 0) && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No resolved positions yet
          </div>
        )}

        {mounted && !isLoading && !error && chartOptions && (
          <ReactECharts
            option={chartOptions}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "svg" }}
          />
        )}
      </div>
    </Card>
  );
}
