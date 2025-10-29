"use client";

import { useMemo, useState, type ReactNode } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { Activity, Award, Layers, Target, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { mockDefaultStrategy } from "@/components/strategy-dashboard/mock-data";

const ACCENT_COLOR = "#00B512";
const NEGATIVE_LIGHT = "#ef4444";
const NEGATIVE_DARK = "#fca5a5";
const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type SummaryTone = "positive" | "negative" | "neutral";

interface SummaryMetric {
  id: string;
  title: string;
  value: string;
  helper: string;
  tone: SummaryTone;
  icon: ReactNode;
}

interface Strategy {
  id: string;
  name: string;
  status: "active" | "paused";
  totalPnL: number;
  pnlPercent: number;
  winRate: number;
  totalTrades: number;
  activePositions: number;
  avgTradeSize: number;
  sharpeRatio: number;
  capitalAtWork: number;
  maxDrawdown: number;
  runtimeDays: number;
  dailyPnL: number[];
}

interface TimePoint {
  label: string;
  value: number;
}

type TimeframeKey = "7d" | "30d" | "90d";

const STRATEGIES: Strategy[] = [
  {
    id: "strat-1",
    name: "High SII Momentum",
    status: "active",
    totalPnL: 12450,
    pnlPercent: 24.5,
    winRate: 68,
    totalTrades: 145,
    activePositions: 8,
    avgTradeSize: 250,
    sharpeRatio: 2.1,
    capitalAtWork: 42000,
    maxDrawdown: 5.4,
    runtimeDays: 42,
    dailyPnL: [120, 340, -80, 450, 210, 380, 290],
  },
  {
    id: "strat-2",
    name: "Whale Following",
    status: "active",
    totalPnL: 8920,
    pnlPercent: 17.8,
    winRate: 72,
    totalTrades: 98,
    activePositions: 5,
    avgTradeSize: 420,
    sharpeRatio: 1.8,
    capitalAtWork: 36500,
    maxDrawdown: 4.6,
    runtimeDays: 58,
    dailyPnL: [210, 180, 420, -120, 350, 280, 180],
  },
  {
    id: "strat-3",
    name: "Contrarian Signals",
    status: "active",
    totalPnL: -1240,
    pnlPercent: -4.2,
    winRate: 45,
    totalTrades: 67,
    activePositions: 3,
    avgTradeSize: 180,
    sharpeRatio: 0.6,
    capitalAtWork: 18750,
    maxDrawdown: 9.3,
    runtimeDays: 31,
    dailyPnL: [-80, -120, 50, -90, -40, 20, -80],
  },
  {
    id: "strat-4",
    name: "Category Rotation",
    status: "active",
    totalPnL: 5630,
    pnlPercent: 11.3,
    winRate: 58,
    totalTrades: 112,
    activePositions: 6,
    avgTradeSize: 310,
    sharpeRatio: 1.4,
    capitalAtWork: 29840,
    maxDrawdown: 6.1,
    runtimeDays: 47,
    dailyPnL: [90, 180, 120, 240, -60, 190, 150],
  },
];

const DAILY_TOTALS = STRATEGIES.length
  ? Array.from({ length: STRATEGIES[0].dailyPnL.length }, (_, index) =>
      STRATEGIES.reduce((sum, strategy) => sum + strategy.dailyPnL[index], 0)
    )
  : [];

function createTimeline(days: number): TimePoint[] {
  if (!DAILY_TOTALS.length) return [];

  const baseLength = DAILY_TOTALS.length;
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  let runningTotal = 0;

  return Array.from({ length: days }, (_, index) => {
    const baseValue = DAILY_TOTALS[index % baseLength];
    runningTotal += baseValue;
    const oscillation = Math.sin(index / 2.4) * Math.abs(baseValue) * 0.3;
    const current = new Date(start.getTime() + index * 86400000);

    const label =
      days <= 7
        ? current.toLocaleDateString(undefined, { weekday: "short" })
        : current.toLocaleDateString(undefined, { month: "short", day: "numeric" });

    return {
      label,
      value: Math.round(runningTotal + oscillation),
    };
  });
}

const TIMEFRAME_SERIES: Record<TimeframeKey, TimePoint[]> = {
  "7d": createTimeline(7),
  "30d": createTimeline(30),
  "90d": createTimeline(90),
};

const TIMEFRAME_OPTIONS: { key: TimeframeKey; label: string; description: string }[] = [
  { key: "7d", label: "7D", description: "Trailing week" },
  { key: "30d", label: "30D", description: "Last 30 days" },
  { key: "90d", label: "90D", description: "Quarter to date" },
];

export function DashboardContent() {
  const { theme } = useTheme();
  const [timeframe, setTimeframe] = useState<TimeframeKey>("7d");

  const accentColor = ACCENT_COLOR;
  const isDark = theme === "dark";
  const negativeColor = isDark ? NEGATIVE_DARK : NEGATIVE_LIGHT;

  const totalPnL = STRATEGIES.reduce((sum, strategy) => sum + strategy.totalPnL, 0);
  const totalCapital = STRATEGIES.reduce((sum, strategy) => sum + strategy.capitalAtWork, 0);
  const totalInvested = 100000;
  const pnlPercent = (totalPnL / totalInvested) * 100;
  const activeStrategiesCount = STRATEGIES.filter((strategy) => strategy.status === "active").length;
  const totalActivePositions = STRATEGIES.reduce(
    (sum, strategy) => sum + strategy.activePositions,
    0
  );
  const avgWinRate =
    STRATEGIES.reduce((sum, strategy) => sum + strategy.winRate, 0) / STRATEGIES.length;
  const timeline = TIMEFRAME_SERIES[timeframe] ?? [];
  const periodPnL = timeline.length ? timeline[timeline.length - 1].value : 0;
  const averageDailyPnL = timeline.length ? periodPnL / timeline.length : 0;
  const timeframeMeta =
    TIMEFRAME_OPTIONS.find((option) => option.key === timeframe) ?? TIMEFRAME_OPTIONS[0];

  const summaryMetrics: SummaryMetric[] = [
    {
      id: "net-pnl",
      title: "Net PnL",
      value: formatSignedCurrency(totalPnL),
      helper: `${formatSignedPercent(pnlPercent)} vs capital deployed`,
      tone: "neutral",
      icon: <TrendingUp className="h-5 w-5" />,
    },
    {
      id: "capital",
      title: "Capital Allocated",
      value: formatCurrency(totalCapital, 0, true),
      helper: `${formatSignedPercent((totalPnL / totalCapital) * 100, 1)} yield on capital`,
      tone: "neutral",
      icon: <Layers className="h-5 w-5" />,
    },
    {
      id: "strategies",
      title: "Active Strategies",
      value: `${activeStrategiesCount}`,
      helper: `${totalActivePositions} open market positions`,
      tone: "neutral",
      icon: <Activity className="h-5 w-5" />,
    },
    {
      id: "win-rate",
      title: "Avg Win Rate",
      value: `${avgWinRate.toFixed(1)}%`,
      helper: `Default Template: ${mockDefaultStrategy.statistics.winRate}% win · Sharpe ${mockDefaultStrategy.statistics.sharpeRatio.toFixed(1)}`,
      tone: "neutral",
      icon: <Target className="h-5 w-5" />,
    },
  ];

  const chartOption = useMemo(() => {
    const axisColor = isDark ? "rgba(148,163,184,0.75)" : "rgba(71,85,105,0.7)";
    const splitColor = isDark ? "rgba(30,41,59,0.6)" : "rgba(226,232,240,0.7)";

    return {
      animationDuration: 600,
      backgroundColor: "transparent",
      textStyle: {
        color: axisColor,
        fontFamily: "Inter, sans-serif",
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.92)",
        borderColor: "transparent",
        textStyle: {
          color: isDark ? "#e2e8f0" : "#0f172a",
          fontSize: 12,
        },
        formatter: (params: any) => {
          if (!params || !params.length) {
            return "";
          }

          const point = params[0];
          const rawValue = toNumber(point.value ?? point.data);

          return `<div style="font-size:12px;">
            <div style="font-weight:600;margin-bottom:4px;">${point.axisValue}</div>
            <div>Net PnL: ${formatSignedCurrency(rawValue)}</div>
          </div>`;
        },
      },
      grid: {
        left: "2%",
        right: "3%",
        top: "8%",
        bottom: "5%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: timeline.map((point) => point.label),
        boundaryGap: false,
        axisLine: { lineStyle: { color: axisColor } },
        axisLabel: { color: axisColor, fontSize: 12 },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: splitColor, type: "dashed" } },
        axisLabel: {
          color: axisColor,
          formatter: (value: number) => formatCurrency(value, 0, true),
        },
      },
      series: [
        {
          type: "line",
          data: timeline.map((point) => Math.round(point.value)),
          smooth: true,
          showSymbol: false,
          symbol: "circle",
          symbolSize: 8,
          lineStyle: { width: 3, color: accentColor },
          itemStyle: {
            color: accentColor,
            borderWidth: 1.5,
            borderColor: isDark ? "#020617" : "#ffffff",
          },
        },
      ],
    };
  }, [accentColor, isDark, timeline]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[3fr,1fr] gap-6">
      {/* Main Card - 3/4 width */}
      <Card className="shadow-sm rounded-2xl overflow-hidden border-0" style={{ backgroundColor: isDark ? '#18181b' : undefined }}>
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-lg font-medium text-foreground">Overview</h2>
        </div>
        <section className="grid grid-cols-4 gap-3 px-6 py-4">
          {summaryMetrics.map((metric) => (
            <Card
              key={metric.id}
              className="group relative overflow-hidden p-3 shadow-none"
              style={{ backgroundColor: isDark ? '#27272a' : undefined }}
            >
              <div className="flex items-start justify-between">
                <div className="text-xs font-medium text-muted-foreground">{metric.title}</div>
                <div className="rounded-full bg-muted/70 p-1.5 text-muted-foreground">
                  {metric.icon}
                </div>
              </div>
              <div className="mt-2 text-lg font-semibold tracking-tight">{metric.value}</div>
              <div
                className={cn(
                  "mt-1 text-xs",
                  metric.tone === "neutral" && "text-muted-foreground"
                )}
                style={
                  metric.tone === "positive"
                    ? { color: accentColor }
                    : metric.tone === "negative"
                    ? { color: negativeColor }
                    : undefined
                }
              >
                {metric.helper}
              </div>
            </Card>
          ))}
        </section>

        <section className="px-6 pb-6">
          <Card className="p-6 shadow-none" style={{ backgroundColor: isDark ? '#18181b' : undefined }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Portfolio Performance</h2>
              <p className="text-sm text-muted-foreground">
                Net PnL across all active Cascadian trading strategies
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 p-1">
              {TIMEFRAME_OPTIONS.map((option) => (
                <Button
                  key={option.key}
                  size="sm"
                  variant="ghost"
                  onClick={() => setTimeframe(option.key)}
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition focus-visible:ring-0 focus-visible:ring-offset-0",
                    timeframe === option.key
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="mt-4 h-[320px] w-full">
            <ReactECharts
              option={chartOption}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
              notMerge
              lazyUpdate
            />
          </div>
        </Card>
        </section>
      </Card>

      {/* Sidebar - 1/4 width */}
      <div className="space-y-6">
        <Card className="p-6 shadow-sm rounded-2xl border-0" style={{ backgroundColor: isDark ? '#18181b' : undefined }}>
          <h2 className="text-xl font-semibold tracking-tight mb-4">Active Strategies</h2>

          <div className="space-y-3">
            {/* Consensus Copy Trades */}
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-sm">Consensus Copy Trades</h3>
                <div className="text-right">
                  <div className="text-sm font-semibold text-foreground">+$2,450</div>
                  <div className="text-xs text-muted-foreground">+18.2%</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Win Rate</span>
                  <div className="font-medium">72%</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Positions</span>
                  <div className="font-medium">5</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Trades</span>
                  <div className="font-medium">34</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Sharpe</span>
                  <div className="font-medium">1.8</div>
                </div>
              </div>
            </div>

            {/* Smart Money Imbalance */}
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-sm">Smart Money Imbalance</h3>
                <div className="text-right">
                  <div className="text-sm font-semibold text-foreground">+$3,120</div>
                  <div className="text-xs text-muted-foreground">+24.5%</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Win Rate</span>
                  <div className="font-medium">68%</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Positions</span>
                  <div className="font-medium">8</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Trades</span>
                  <div className="font-medium">52</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Sharpe</span>
                  <div className="font-medium">2.1</div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last === "number" ? last : Number(last ?? 0);
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withAlpha(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatCurrency(value: number, maximumFractionDigits = 0, compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
    notation: compact ? "compact" : "standard",
  }).format(value);
}

function formatSignedCurrency(value: number, maximumFractionDigits = 0, compact = false) {
  const formatted = formatCurrency(Math.abs(value), maximumFractionDigits, compact);
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function formatSignedPercent(value: number, fractionDigits = 1) {
  const absValue = Math.abs(value).toFixed(fractionDigits);
  return `${value >= 0 ? "+" : "-"}${absValue}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
