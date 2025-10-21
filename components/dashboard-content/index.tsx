"use client";

import { useMemo, useState, type ReactNode } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { Activity, Award, Gauge, Info, Layers, Target, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { mockDefaultStrategy } from "@/components/strategy-dashboard/mock-data";

const ACCENT_COLOR = "#12B48A";
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
      tone: totalPnL >= 0 ? "positive" : "negative",
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
      tone: "positive",
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
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(accentColor, isDark ? 0.35 : 0.25) },
                { offset: 1, color: withAlpha(accentColor, 0) },
              ],
            },
          },
        },
      ],
    };
  }, [accentColor, isDark, timeline]);

  return (
    <div className="space-y-8 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Dashboard Overview
            </h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              Track capital, risk, and SII-driven alpha across every Cascadian Intelligence bot.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Award className="h-4 w-4 text-[#12B48A]" />
            <span>
              Active strategy: <span className="font-semibold text-foreground">{mockDefaultStrategy.name}</span>{" "}
              {formatSignedCurrency(mockDefaultStrategy.balance - mockDefaultStrategy.initialBalance)} · {mockDefaultStrategy.statistics.winRate}% win rate
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-4 w-4 text-[#12B48A]" />
            <span>
              SII (Signal Intelligence Index) measures Cascadian's conviction from -100 (bearish) to +100 (bullish) by blending momentum, whale flow, and sentiment signals.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/80 p-1">
          {TIMEFRAME_OPTIONS.map((option) => (
            <Button
              key={option.key}
              size="sm"
              variant="ghost"
              onClick={() => setTimeframe(option.key)}
              className={cn(
                "px-4 py-2 text-sm font-medium text-muted-foreground transition focus-visible:ring-0 focus-visible:ring-offset-0",
                timeframe === option.key
                  ? "bg-[#12B48A] text-slate-900 shadow-[0_10px_30px_rgba(18,180,138,0.35)] hover:bg-[#12B48A]"
                  : "hover:bg-muted/60 hover:text-foreground"
              )}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryMetrics.map((metric) => (
          <Card
            key={metric.id}
            className="group relative overflow-hidden border border-border/60 bg-card/90 p-5 transition hover:-translate-y-0.5 hover:border-[rgba(18,180,138,0.45)] hover:shadow-[0_18px_40px_rgba(18,180,138,0.08)]"
          >
            <div className="flex items-start justify-between">
              <div className="text-sm font-medium text-muted-foreground">{metric.title}</div>
              <div className="rounded-full bg-muted/70 p-2 text-muted-foreground transition group-hover:text-foreground">
                {metric.icon}
              </div>
            </div>
            <div className="mt-4 text-2xl font-semibold tracking-tight">{metric.value}</div>
            <div
              className={cn(
                "mt-2 text-sm",
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
            <span className="pointer-events-none absolute right-2 top-2 h-24 w-24 rounded-full bg-[#12B48A]/10 blur-2xl" />
          </Card>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[2.1fr,1fr]">
        <Card className="border border-border/60 bg-card/90 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Portfolio Performance</h2>
              <p className="text-sm text-muted-foreground">
                Net PnL across all active Cascadian trading strategies
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {timeframeMeta.description}
              </p>
              <p className="text-lg font-semibold" style={{ color: accentColor }}>
                {formatSignedCurrency(periodPnL)}
              </p>
              <p className="text-xs text-muted-foreground">
                Average {formatCurrency(averageDailyPnL, 0)} per day
              </p>
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

        <Card className="border border-border/60 bg-card/90 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Strategy Spotlight</h2>
              <p className="text-sm text-muted-foreground">Performance statistics</p>
            </div>
            <div className="rounded-full bg-[#12B48A]/15 p-2 text-[#12B48A]">
              <Award className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-6 space-y-4 rounded-xl border border-[#12B48A]/30 bg-[#12B48A]/5 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[#12B48A]">Active Strategy</p>
                <h3 className="mt-1 text-lg font-semibold">{mockDefaultStrategy.name}</h3>
              </div>
              <div className="text-right">
                <div className="text-xl font-semibold" style={{ color: accentColor }}>
                  {formatSignedCurrency(mockDefaultStrategy.balance - mockDefaultStrategy.initialBalance)}
                </div>
                <div className="text-sm font-medium" style={{ color: accentColor }}>
                  +{((mockDefaultStrategy.balance - mockDefaultStrategy.initialBalance) / mockDefaultStrategy.initialBalance * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="grid gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Win Rate</span>
                <span className="font-semibold">{mockDefaultStrategy.statistics.winRate}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Trades Per Day</span>
                <span className="font-semibold">
                  {(mockDefaultStrategy.statistics.totalTrades / 15).toFixed(1)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sharpe Ratio</span>
                <span className="font-semibold">{mockDefaultStrategy.statistics.sharpeRatio.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Active Positions</span>
                <span className="font-semibold">{mockDefaultStrategy.statistics.activePositions}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Trades</span>
                <span className="font-semibold">{mockDefaultStrategy.statistics.totalTrades}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Profit Factor</span>
                <span className="font-semibold">{mockDefaultStrategy.statistics.profitFactor.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </Card>
      </section>
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
