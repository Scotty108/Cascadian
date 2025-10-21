"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import {
  ArrowUpDown,
  Eye,
  Layers,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type { PnLLeaderboardRow } from "./types";

const ACCENT_COLOR = "#00E0AA";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const formatCurrency = (value: number) => currencyFormatter.format(value);
const formatCompactCurrency = (value: number) => compactCurrencyFormatter.format(value);
const formatSignedPercent = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(1)}%`;

type SortKey = keyof PnLLeaderboardRow;
type SegmentKey = "all" | "highWis" | "contrarian" | "drawdown";

type MetricTone = "positive" | "negative" | "neutral" | "accent";

interface SummaryMetric {
  id: string;
  title: string;
  primary: string;
  helper: string;
  tone: MetricTone;
  icon: LucideIcon;
}

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "realized_pnl_usd", label: "Realized PnL" },
  { value: "roi", label: "ROI" },
  { value: "win_rate", label: "Win Rate" },
  { value: "wis", label: "WIS" },
  { value: "contrarian_win_rate", label: "Contrarian Win" },
  { value: "total_invested_usd", label: "Capital Deployed" },
  { value: "last_trade_date", label: "Recent Activity" },
];

const segmentOptions: Array<{ value: SegmentKey; label: string; helper: string }> = [
  { value: "all", label: "All Wallets", helper: "Complete leaderboard" },
  { value: "highWis", label: "Signal Leaders", helper: "WIS >= 70" },
  { value: "contrarian", label: "Contrarian Edge", helper: "Contrarian win >= 65%" },
  { value: "drawdown", label: "Drawdown Watch", helper: "Negative ROI" },
];

// Mock data until API integration lands.
const WALLET_DATA: PnLLeaderboardRow[] = [
  {
    wallet_id: "0x1a2b3c",
    wallet_alias: "WhaleTrader42",
    wis: 85,
    realized_pnl_usd: 125000,
    total_invested_usd: 500000,
    roi: 25.0,
    trades_total: 156,
    win_rate: 68.5,
    contrarian_score: 42.3,
    contrarian_win_rate: 71.2,
    last_trade_date: "2025-10-19",
  },
  {
    wallet_id: "0x4d5e6f",
    wallet_alias: "ContraCaptain",
    wis: 72,
    realized_pnl_usd: 89000,
    total_invested_usd: 300000,
    roi: 29.7,
    trades_total: 203,
    win_rate: 65.0,
    contrarian_score: 78.5,
    contrarian_win_rate: 82.1,
    last_trade_date: "2025-10-20",
  },
  {
    wallet_id: "0x7g8h9i",
    wallet_alias: "MomentumMaster",
    wis: 68,
    realized_pnl_usd: 67000,
    total_invested_usd: 250000,
    roi: 26.8,
    trades_total: 98,
    win_rate: 72.4,
    contrarian_score: 18.4,
    contrarian_win_rate: 55.6,
    last_trade_date: "2025-10-19",
  },
  {
    wallet_id: "0xjklmno",
    wallet_alias: "SmartInvestor",
    wis: 91,
    realized_pnl_usd: 156000,
    total_invested_usd: 400000,
    roi: 39.0,
    trades_total: 124,
    win_rate: 78.2,
    contrarian_score: 35.5,
    contrarian_win_rate: 79.5,
    last_trade_date: "2025-10-20",
  },
  {
    wallet_id: "0xpqrstu",
    wallet_alias: "RiskTaker",
    wis: -15,
    realized_pnl_usd: -45000,
    total_invested_usd: 600000,
    roi: -7.5,
    trades_total: 289,
    win_rate: 42.6,
    contrarian_score: 62.1,
    contrarian_win_rate: 38.9,
    last_trade_date: "2025-10-18",
  },
  {
    wallet_id: "0xvwxyz1",
    wallet_alias: "SafeBets",
    wis: 45,
    realized_pnl_usd: 32000,
    total_invested_usd: 150000,
    roi: 21.3,
    trades_total: 67,
    win_rate: 59.7,
    contrarian_score: 12.3,
    contrarian_win_rate: 62.5,
    last_trade_date: "2025-10-17",
  },
];

const accentCardStyle: CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(0,224,170,0.16) 0%, rgba(0,224,170,0.05) 55%, transparent 100%)",
  boxShadow: "0 0 0 1px rgba(0,224,170,0.25)",
};

const performanceCardClasses: Record<MetricTone, string> = {
  neutral: "border-border/60 bg-muted/20 dark:bg-muted/10",
  positive: "border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/15",
  negative: "border-rose-500/30 bg-rose-500/10 dark:bg-rose-500/20",
  accent: "border-transparent",
};

const legendPaletteLight = [
  { label: "ROI >= 30%", color: ACCENT_COLOR },
  { label: "ROI 15-30%", color: "rgba(0, 224, 170, 0.6)" },
  { label: "ROI -5 to 15%", color: "#94A3B8" },
  { label: "ROI -20 to -5%", color: "#F59E0B" },
  { label: "ROI < -20%", color: "#EF4444" },
] as const;

const legendPaletteDark = [
  { label: "ROI >= 30%", color: ACCENT_COLOR },
  { label: "ROI 15-30%", color: "rgba(0, 224, 170, 0.55)" },
  { label: "ROI -5 to 15%", color: "#64748B" },
  { label: "ROI -20 to -5%", color: "#FACC15" },
  { label: "ROI < -20%", color: "#F87171" },
] as const;

const getLegendPalette = (isDark: boolean) =>
  isDark ? legendPaletteDark : legendPaletteLight;

const getSymbolSize = (trades: number) => Math.max(16, Math.min(42, trades / 4));

const getRoiColor = (roi: number, isDark: boolean) => {
  if (roi >= 30) return ACCENT_COLOR;
  if (roi >= 15) return "rgba(0, 224, 170, 0.65)";
  if (roi >= -5) return isDark ? "#64748B" : "#94A3B8";
  if (roi >= -20) return isDark ? "#FACC15" : "#F59E0B";
  return "#EF4444";
};

const getWisBadgeClass = (wis: number) => {
  if (wis >= 85) return "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
  if (wis >= 60) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (wis >= 0) return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  if (wis >= -40) return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-rose-500/40 bg-rose-500/10 text-rose-200";
};

const getPnlTextClass = (value: number) => {
  if (value >= 100000) return "text-emerald-400 font-semibold";
  if (value > 0) return "text-emerald-300";
  if (value === 0) return "text-muted-foreground";
  if (value > -50000) return "text-amber-300";
  return "text-rose-400 font-semibold";
};

const getRoiTextClass = (value: number) => {
  if (value >= 30) return "text-emerald-400 font-semibold";
  if (value >= 10) return "text-emerald-300";
  if (value >= 0) return "text-emerald-200";
  if (value > -10) return "text-amber-300";
  return "text-rose-400 font-semibold";
};

const formatDate = (isoDate: string) => dateFormatter.format(new Date(isoDate));

export function PnLLeaderboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortKey>("realized_pnl_usd");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [segment, setSegment] = useState<SegmentKey>("all");
  const { resolvedTheme } = useTheme();

  const isDark = resolvedTheme === "dark";

  const searchedWallets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return WALLET_DATA;
    }

    return WALLET_DATA.filter(
      (wallet) =>
        wallet.wallet_alias.toLowerCase().includes(query) ||
        wallet.wallet_id.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const scopedWallets = useMemo(() => {
    switch (segment) {
      case "highWis":
        return searchedWallets.filter((wallet) => wallet.wis >= 70);
      case "contrarian":
        return searchedWallets.filter((wallet) => wallet.contrarian_win_rate >= 65);
      case "drawdown":
        return searchedWallets.filter((wallet) => wallet.roi < 0);
      default:
        return searchedWallets;
    }
  }, [searchedWallets, segment]);

  const sortedWallets = useMemo(() => {
    const sorted = [...scopedWallets];

    sorted.sort((a, b) => {
      if (sortField === "last_trade_date") {
        const aTime = new Date(a.last_trade_date).getTime();
        const bTime = new Date(b.last_trade_date).getTime();
        return sortDirection === "asc" ? aTime - bTime : bTime - aTime;
      }

      const aValue = a[sortField];
      const bValue = b[sortField];

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortDirection === "asc"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return 0;
    });

    return sorted;
  }, [scopedWallets, sortField, sortDirection]);

  const topRanks = useMemo(() => {
    const rankings = new Map<string, number>();
    sortedWallets.slice(0, 3).forEach((wallet, index) => {
      rankings.set(wallet.wallet_id, index + 1);
    });
    return rankings;
  }, [sortedWallets]);

  const legendPalette = useMemo(() => getLegendPalette(isDark), [isDark]);

  const summaryMetrics = useMemo<SummaryMetric[]>(() => {
    if (!scopedWallets.length) {
      return [
        {
          id: "capital",
          title: "Capital At Work",
          primary: "$0",
          helper: "No wallets matched",
          tone: "neutral",
          icon: Layers,
        },
        {
          id: "pnl",
          title: "Realized PnL",
          primary: "$0",
          helper: "Awaiting data",
          tone: "neutral",
          icon: TrendingUp,
        },
        {
          id: "contrarian",
          title: "Contrarian Edge",
          primary: "-",
          helper: "Tune filters to explore leaders",
          tone: "accent",
          icon: Sparkles,
        },
      ];
    }

    const totalInvested = scopedWallets.reduce(
      (sum, wallet) => sum + wallet.total_invested_usd,
      0
    );
    const totalRealized = scopedWallets.reduce(
      (sum, wallet) => sum + wallet.realized_pnl_usd,
      0
    );
    const avgROI =
      scopedWallets.reduce((sum, wallet) => sum + wallet.roi, 0) / scopedWallets.length;
    const avgWinRate =
      scopedWallets.reduce((sum, wallet) => sum + wallet.win_rate, 0) /
      scopedWallets.length;
    const profitableShare =
      (scopedWallets.filter((wallet) => wallet.roi > 0).length / scopedWallets.length) *
      100;

    const contrarianLeader = scopedWallets.reduce((best, wallet) => {
      if (!best) return wallet;
      return wallet.contrarian_win_rate > best.contrarian_win_rate ? wallet : best;
    }, scopedWallets[0]);

    return [
      {
        id: "capital",
        title: "Capital At Work",
        primary: formatCompactCurrency(totalInvested),
        helper: `Avg ROI ${formatSignedPercent(avgROI)} | Win ${avgWinRate.toFixed(1)}%`,
        tone: "neutral",
        icon: Layers,
      },
      {
        id: "pnl",
        title: "Realized PnL",
        primary: formatCompactCurrency(totalRealized),
        helper: `${profitableShare.toFixed(0)}% wallets profitable`,
        tone: totalRealized >= 0 ? "positive" : "negative",
        icon: TrendingUp,
      },
      {
        id: "contrarian",
        title: "Contrarian Edge",
        primary: `${contrarianLeader.contrarian_win_rate.toFixed(1)}% win`,
        helper: `${contrarianLeader.wallet_alias} leads`,
        tone: "accent",
        icon: Sparkles,
      },
    ];
  }, [scopedWallets]);

  const scatterOption = useMemo(() => {
    const textColor = isDark ? "#A5B4CF" : "#334155";
    const axisColor = isDark ? "#1F2937" : "#CBD5F5";
    const splitLineColor = isDark ? "#243447" : "#E2E8F0";
    const tooltipBg = isDark ? "#050E1C" : "#F8FAFC";
    const tooltipText = isDark ? "#E2E8F0" : "#0F172A";

    return {
      grid: { top: 48, right: 24, bottom: 60, left: 68 },
      tooltip: {
        trigger: "item",
        borderColor: ACCENT_COLOR,
        borderWidth: 1,
        backgroundColor: tooltipBg,
        textStyle: { color: tooltipText },
        formatter: (params: any) => {
          const wallet = params.data.wallet as PnLLeaderboardRow;

          return `
            <div style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
              <strong style="font-size:14px;">${wallet.wallet_alias}</strong>
              <span>Realized PnL: <strong>${formatCurrency(wallet.realized_pnl_usd)}</strong></span>
              <span>Total Invested: <strong>${formatCurrency(wallet.total_invested_usd)}</strong></span>
              <span>ROI: <strong>${wallet.roi.toFixed(1)}%</strong></span>
              <span>WIS: <strong>${wallet.wis}</strong> | Trades: <strong>${wallet.trades_total}</strong></span>
            </div>
          `;
        },
      },
      xAxis: {
        type: "value",
        name: "Realized PnL (USD)",
        nameLocation: "middle",
        nameGap: 36,
        axisLabel: {
          color: textColor,
          formatter: (value: number) => formatCompactCurrency(value),
        },
        axisLine: { lineStyle: { color: axisColor } },
        splitLine: { lineStyle: { color: splitLineColor, type: "dashed" } },
      },
      yAxis: {
        type: "value",
        name: "Capital Deployed (USD)",
        nameLocation: "middle",
        nameGap: 48,
        axisLabel: {
          color: textColor,
          formatter: (value: number) => formatCompactCurrency(value),
        },
        axisLine: { lineStyle: { color: axisColor } },
        splitLine: { lineStyle: { color: splitLineColor, type: "dashed" } },
      },
      series: [
        {
          type: "scatter",
          data: scopedWallets.map((wallet) => ({
            value: [wallet.realized_pnl_usd, wallet.total_invested_usd],
            wallet,
            itemStyle: {
              color: getRoiColor(wallet.roi, isDark),
              shadowBlur: 8,
              shadowColor: "rgba(15, 23, 42, 0.25)",
            },
          })),
          symbolSize: (value: number[], params: any) => {
            const wallet = params.data.wallet as PnLLeaderboardRow | undefined;
            return getSymbolSize(wallet?.trades_total ?? 0);
          },
          emphasis: {
            scale: true,
            focus: "series",
          },
          animationDuration: 600,
        },
      ],
    };
  }, [scopedWallets, isDark]);

  const activeSegment = segmentOptions.find((option) => option.value === segment);
  const activeSort = sortOptions.find((option) => option.value === sortField);

  const sortIndicatorClass = (field: SortKey) =>
    cn(
      "h-4 w-4 text-muted-foreground/60 transition-transform",
      sortField === field && "text-foreground",
      sortField === field && sortDirection === "asc" && "rotate-180"
    );

  const handleSort = (field: SortKey) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const handleSortFieldChange = (field: SortKey) => {
    if (field === sortField) return;
    setSortField(field);
    setSortDirection("desc");
  };

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">PnL Leaderboard</h1>
          <p className="text-muted-foreground">
            Track the wallets with disciplined execution, contrarian conviction, and
            consistent profitability across the Cascadian network.
          </p>
        </div>
        <Badge className="self-start border-transparent bg-emerald-500/10 text-emerald-300">
          Updated 24h ago
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaryMetrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card
              key={metric.id}
              className={cn(
                "relative overflow-hidden transition-colors",
                performanceCardClasses[metric.tone]
              )}
              style={metric.tone === "accent" ? accentCardStyle : undefined}
            >
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-xl">{metric.title}</CardTitle>
                  <CardDescription>{metric.helper}</CardDescription>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-background/60 shadow-sm backdrop-blur">
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      metric.tone === "positive" && "text-emerald-300",
                      metric.tone === "negative" && "text-rose-300",
                      metric.tone === "accent" && "text-emerald-200",
                      metric.tone === "neutral" && "text-muted-foreground"
                    )}
                  />
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-3xl font-semibold tracking-tight">{metric.primary}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-border/60">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>PnL vs Capital</CardTitle>
            <CardDescription>
              Bubble size reflects trade count. Color bands map ROI performance for quick
              comparative scanning.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {legendPalette.map((entry) => (
              <div key={entry.label} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span>{entry.label}</span>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[360px] w-full">
            <ReactECharts
              option={scatterOption}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
              notMerge
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>Leaderboard</CardTitle>
            <CardDescription>
              Segment: {activeSegment?.label ?? "All wallets"} | Sorted by{" "}
              {activeSort?.label ?? "Realized PnL"} (
              {sortDirection === "desc" ? "high -> low" : "low -> high"})
            </CardDescription>
          </div>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search wallet alias or address"
                className="pl-9"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <SlidersHorizontal className="h-4 w-4" />
                Controls
              </div>
              <Select
                value={segment}
                onValueChange={(value) => setSegment(value as SegmentKey)}
              >
                <SelectTrigger className="sm:w-44">
                  <SelectValue placeholder="Segment" />
                </SelectTrigger>
                <SelectContent>
                  {segmentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={sortField}
                onValueChange={(value) => handleSortFieldChange(value as SortKey)}
              >
                <SelectTrigger className="sm:w-44">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() =>
                  setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
                }
              >
                <ArrowUpDown className={cn("h-4 w-4", sortDirection === "asc" && "rotate-180")} />
                <span className="sr-only">Toggle sort direction</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">Wallet</TableHead>
                  <TableHead
                    className="cursor-pointer whitespace-nowrap"
                    onClick={() => handleSort("wis")}
                  >
                    <div className="flex items-center gap-1">
                      WIS
                      <ArrowUpDown className={sortIndicatorClass("wis")} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer whitespace-nowrap"
                    onClick={() => handleSort("realized_pnl_usd")}
                  >
                    <div className="flex items-center gap-1">
                      Realized PnL
                      <ArrowUpDown className={sortIndicatorClass("realized_pnl_usd")} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer whitespace-nowrap"
                    onClick={() => handleSort("roi")}
                  >
                    <div className="flex items-center gap-1">
                      ROI
                      <ArrowUpDown className={sortIndicatorClass("roi")} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer whitespace-nowrap"
                    onClick={() => handleSort("total_invested_usd")}
                  >
                    <div className="flex items-center gap-1">
                      Capital
                      <ArrowUpDown className={sortIndicatorClass("total_invested_usd")} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer whitespace-nowrap"
                    onClick={() => handleSort("win_rate")}
                  >
                    <div className="flex items-center gap-1">
                      Win Rate
                      <ArrowUpDown className={sortIndicatorClass("win_rate")} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer whitespace-nowrap"
                    onClick={() => handleSort("trades_total")}
                  >
                    <div className="flex items-center gap-1">
                      Trades
                      <ArrowUpDown className={sortIndicatorClass("trades_total")} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer whitespace-nowrap"
                    onClick={() => handleSort("contrarian_score")}
                  >
                    <div className="flex items-center gap-1">
                      Contrarian %
                      <ArrowUpDown className={sortIndicatorClass("contrarian_score")} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer whitespace-nowrap"
                    onClick={() => handleSort("contrarian_win_rate")}
                  >
                    <div className="flex items-center gap-1">
                      Contrarian Win
                      <ArrowUpDown className={sortIndicatorClass("contrarian_win_rate")} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer whitespace-nowrap"
                    onClick={() => handleSort("last_trade_date")}
                  >
                    <div className="flex items-center gap-1">
                      Last Trade
                      <ArrowUpDown className={sortIndicatorClass("last_trade_date")} />
                    </div>
                  </TableHead>
                  <TableHead className="w-16">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedWallets.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No wallets match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedWallets.map((wallet) => {
                    const rank = topRanks.get(wallet.wallet_id);

                    return (
                      <TableRow
                        key={wallet.wallet_id}
                        className={cn(
                          "border-border/60 transition-colors hover:bg-muted/40",
                          wallet.roi < 0 && "bg-rose-500/5 hover:bg-rose-500/10"
                        )}
                      >
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium uppercase">
                              {wallet.wallet_alias.slice(0, 2)}
                            </div>
                            <div className="flex flex-col">
                              <Link
                                href={`/analysis/wallet/${wallet.wallet_id}`}
                                className="text-base font-semibold text-foreground hover:text-emerald-300"
                              >
                                {wallet.wallet_alias}
                              </Link>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="font-mono">{wallet.wallet_id}</span>
                                {rank ? (
                                  <Badge className="border-transparent bg-emerald-500/15 text-emerald-300">
                                    #{rank}
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={cn("px-2 py-1", getWisBadgeClass(wallet.wis))}>
                            {wallet.wis}
                          </Badge>
                        </TableCell>
                        <TableCell className={getPnlTextClass(wallet.realized_pnl_usd)}>
                          {formatCurrency(wallet.realized_pnl_usd)}
                        </TableCell>
                        <TableCell className={getRoiTextClass(wallet.roi)}>
                          {wallet.roi.toFixed(1)}%
                        </TableCell>
                        <TableCell>{formatCurrency(wallet.total_invested_usd)}</TableCell>
                        <TableCell>{wallet.win_rate.toFixed(1)}%</TableCell>
                        <TableCell>{wallet.trades_total}</TableCell>
                        <TableCell>{wallet.contrarian_score.toFixed(1)}%</TableCell>
                        <TableCell
                          className={cn(
                            wallet.contrarian_win_rate >= 65 && "text-emerald-300 font-semibold"
                          )}
                        >
                          {wallet.contrarian_win_rate.toFixed(1)}%
                        </TableCell>
                        <TableCell>{formatDate(wallet.last_trade_date)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/traders/wallet/${wallet.wallet_id}`}>
                              <Eye className="h-4 w-4" />
                              <span className="sr-only">Open wallet</span>
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 border-t border-border/60 pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Showing {sortedWallets.length} of {WALLET_DATA.length} wallets
          </span>
          <span>
            Segment: {activeSegment?.label ?? "All wallets"} | Sort:{" "}
            {activeSort?.label ?? "Realized PnL"} ({sortDirection.toUpperCase()})
          </span>
        </CardFooter>
      </Card>
    </div>
  );
}
