"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
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
}

interface PnLChartCardProps {
  walletAddress: string;
  polymarketUrl?: string | null;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  polymarketPnl?: number;
  isLoading?: boolean;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "" : "-";
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function PnLChartCard({
  walletAddress,
  polymarketUrl,
  totalPnl,
  realizedPnl,
  unrealizedPnl,
  polymarketPnl,
  isLoading: externalLoading,
}: PnLChartCardProps) {
  const { theme } = useTheme();
  const [period, setPeriod] = useState<Period>("ALL");

  const { data, isLoading } = useSWR<PnLHistoryResponse>(
    `/api/wio/wallet/${walletAddress}/pnl-history?period=${period}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000, keepPreviousData: true }
  );

  const isDark = theme === "dark";

  // Calculate period-specific PnL from the chart data
  const periodPnl = useMemo(() => {
    if (!data?.data || data.data.length === 0) {
      return { total: totalPnl, periodChange: 0 };
    }

    const lastPoint = data.data[data.data.length - 1];
    const periodChange = data.data.reduce((sum, d) => sum + d.daily_pnl, 0);

    // For ALL, show cumulative total; for other periods, show the change during that period
    if (period === "ALL") {
      return { total: lastPoint.cumulative_pnl, periodChange };
    }

    return { total: periodChange, periodChange };
  }, [data, period, totalPnl]);

  // Calculate % diff from Polymarket (only show for ALL time)
  // Compare realized PnL (not total) since Polymarket only shows realized PnL
  const pnlDiffPercent = period === "ALL" && polymarketPnl && polymarketPnl !== 0
    ? ((realizedPnl - polymarketPnl) / Math.abs(polymarketPnl)) * 100
    : null;

  const isPositive = periodPnl.total >= 0;

  const chartOptions = useMemo(() => {
    if (!data?.data || data.data.length === 0) return null;

    const yData = data.data.map((d) => d.cumulative_pnl);
    const xData = data.data.map((d) => {
      const date = new Date(d.timestamp);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });

    return {
      animation: true,
      animationDuration: 300,
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#1f2937" : "#ffffff",
        borderColor: isDark ? "#374151" : "#e5e7eb",
        textStyle: {
          color: isDark ? "#f3f4f6" : "#1f2937",
        },
        formatter: (params: any) => {
          const point = params[0];
          const value = point.value;
          const date = point.axisValue;
          return `<div style="font-size: 12px;">
            <div style="color: ${isDark ? '#9ca3af' : '#6b7280'};">${date}</div>
            <div style="font-weight: 600; color: ${value >= 0 ? '#00E0AA' : '#ef4444'};">
              ${formatCurrency(value)}
            </div>
          </div>`;
        },
      },
      grid: {
        top: 10,
        right: 10,
        bottom: 30,
        left: 10,
        containLabel: false,
      },
      xAxis: {
        type: "category",
        data: xData,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          show: true,
          interval: Math.floor(xData.length / 4),
          color: isDark ? "#6b7280" : "#9ca3af",
          fontSize: 10,
        },
      },
      yAxis: {
        type: "value",
        show: false,
      },
      series: [
        {
          type: "line",
          data: yData,
          smooth: true,
          symbol: "none",
          lineStyle: {
            width: 2,
            color: yData[yData.length - 1] >= 0 ? "#00E0AA" : "#ef4444",
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: yData[yData.length - 1] >= 0 ? "rgba(0, 224, 170, 0.2)" : "rgba(239, 68, 68, 0.2)" },
                { offset: 1, color: yData[yData.length - 1] >= 0 ? "rgba(0, 224, 170, 0)" : "rgba(239, 68, 68, 0)" },
              ],
            },
          },
        },
      ],
    };
  }, [data, isDark]);

  const periods: Period[] = ["1D", "1W", "1M", "ALL"];

  const periodLabel = period === "ALL" ? "All Time" : period === "1M" ? "30 Days" : period === "1W" ? "7 Days" : "24 Hours";

  return (
    <Card className="p-5 bg-card border-border/50 h-full flex flex-col">
      {/* Header with period chips */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-muted-foreground">Profit/Loss</span>

        {/* Period chips */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-full p-0.5">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-full transition-all ${
                period === p
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Total PnL */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs text-muted-foreground">
              {period === "ALL" ? "Total PnL" : `PnL (${periodLabel})`}
            </p>
            {!externalLoading && pnlDiffPercent !== null && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {pnlDiffPercent >= 0 ? "+" : ""}{pnlDiffPercent.toFixed(1)}% vs PM
              </span>
            )}
          </div>
          {externalLoading ? (
            <div className="h-9 w-28 bg-muted/50 rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold text-foreground">
              {period !== "ALL" && periodPnl.total > 0 ? "+" : ""}
              {formatCurrency(periodPnl.total)}
            </p>
          )}
        </div>

        {/* Realized PnL */}
        <div>
          <p className="text-xs text-muted-foreground mb-1">Realized PnL</p>
          {externalLoading ? (
            <div className="h-7 w-20 bg-muted/50 rounded animate-pulse" />
          ) : (
            <p className="text-xl font-bold text-foreground">
              {formatCurrency(realizedPnl)}
            </p>
          )}
        </div>

        {/* Unrealized PnL */}
        <div>
          <p className="text-xs text-muted-foreground mb-1">Unrealized PnL</p>
          {externalLoading ? (
            <div className="h-7 w-20 bg-muted/50 rounded animate-pulse" />
          ) : (
            <p className="text-xl font-bold text-foreground">
              {formatCurrency(unrealizedPnl)}
            </p>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-[120px]">
        {(isLoading || externalLoading) ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : chartOptions ? (
          <ReactECharts
            key={period}
            option={chartOptions}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "svg" }}
            notMerge={true}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No data
          </div>
        )}
      </div>
    </Card>
  );
}
