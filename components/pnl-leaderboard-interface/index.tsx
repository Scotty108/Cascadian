"use client";

import { useMemo, useState, useEffect, type CSSProperties } from "react";
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
import { cn } from "@/lib/utils";
import { CoverageBadge } from "@/components/ui/coverage-badge";
import { getSignalWalletByAddress } from "@/lib/data/wallet-signal-set";

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

// NOTE: Data now fetched from API - no more mock data

const accentCardStyle: CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(0,224,170,0.16) 0%, rgba(0,224,170,0.05) 55%, transparent 100%)",
  boxShadow: "0 0 0 1px rgba(0,224,170,0.25)",
};

const performanceCardClasses: Record<MetricTone, string> = {
  neutral: "border-border/60 bg-card/50 backdrop-blur-sm",
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
  const [walletData, setWalletData] = useState<PnLLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { resolvedTheme } = useTheme();

  const isDark = resolvedTheme === "dark";

  // Fetch wallet data from API
  useEffect(() => {
    const fetchWallets = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/whale/scoreboard?limit=1000&sort_by=pnl');
        const data = await response.json();

        if (data.success && data.data) {
          // Transform API response and filter for signal wallets only
          // GOVERNANCE: Only show wallets with coverage_pct (signal wallets)
          const transformed: PnLLeaderboardRow[] = data.data
            .map((wallet: any) => {
              const signalWallet = getSignalWalletByAddress(wallet.address);
              if (!signalWallet) return null; // Hide wallets without coverage

              return {
                wallet_id: wallet.address,
                wallet_alias: wallet.alias || wallet.address.slice(0, 8) + '...',
                wis: Math.round(wallet.sws_score || 0),
                realized_pnl_usd: wallet.realized_pnl || 0,
                total_invested_usd: wallet.total_volume || 0,
                roi: (wallet.realized_roi || 0) * 100,
                trades_total: wallet.total_trades || 0,
                win_rate: (wallet.win_rate || 0) * 100,
                contrarian_score: 0, // Not yet implemented in schema
                contrarian_win_rate: 0, // Not yet implemented in schema
                last_trade_date: wallet.last_active || new Date().toISOString(),
                coverage_pct: signalWallet.coveragePct, // Add coverage for display
              };
            })
            .filter((w: any) => w !== null);

          setWalletData(transformed);
        }
      } catch (error) {
        console.error('Error fetching wallet data:', error);
        setWalletData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchWallets();
  }, []);

  const searchedWallets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return walletData;
    }

    return walletData.filter(
      (wallet) =>
        wallet.wallet_alias.toLowerCase().includes(query) ||
        wallet.wallet_id.toLowerCase().includes(query)
    );
  }, [searchQuery, walletData]);

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
      "h-4 w-4 transition-all duration-200",
      sortField === field
        ? "text-foreground"
        : "text-muted-foreground/60",
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

  // Show loading state
  if (loading) {
    return (
      <Card className="shadow-sm rounded-2xl overflow-hidden border-0 dark:bg-[#18181b] animate-pulse">
        <div className="px-6 pt-5 pb-3 border-b border-border/50">
          <div className="h-8 bg-muted rounded w-1/3 mb-2"></div>
          <div className="h-4 bg-muted rounded w-2/3"></div>
        </div>
        <div className="px-6 py-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">Loading wallet data from database...</div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm rounded-2xl overflow-hidden border-0 dark:bg-[#18181b]">
      {/* Hero Header Section */}
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">PnL Leaderboard</h1>
        <p className="text-sm text-muted-foreground">
          Track the wallets with disciplined execution, contrarian conviction, and consistent profitability across the Cascadian network
        </p>
      </div>

      <div className="px-6 py-6 flex flex-col gap-6">

      {/* Summary Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaryMetrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card
              key={metric.id}
              className="relative overflow-hidden transition-all duration-300 hover:shadow-lg border-border/60 bg-card/50 backdrop-blur-sm"
            >
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                <div className="flex-1">
                  <CardTitle className="text-lg font-medium">{metric.title}</CardTitle>
                  <CardDescription className="text-xs mt-1">{metric.helper}</CardDescription>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border/60 bg-background/80 shadow-sm backdrop-blur transition-all duration-300 hover:scale-110 hover:border-border">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <p className="text-3xl font-semibold tracking-tight">{metric.primary}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Scatter Chart Card */}
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:shadow-lg">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-xl">PnL vs Capital</CardTitle>
            <CardDescription className="mt-1">
              Bubble size reflects trade count. Color bands map ROI performance for quick
              comparative scanning.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {legendPalette.map((entry) => (
              <div key={entry.label} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full ring-1 ring-border/30"
                  style={{ backgroundColor: entry.color }}
                />
                <span>{entry.label}</span>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[360px] w-full rounded-lg overflow-hidden">
            <ReactECharts
              option={scatterOption}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
              notMerge
            />
          </div>
        </CardContent>
      </Card>

      {/* Leaderboard Card */}
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:shadow-lg">
        <CardHeader className="space-y-4 bg-card/50 backdrop-blur-sm">
          <div>
            <CardTitle className="text-xl">Leaderboard</CardTitle>
            <CardDescription className="mt-1">
              Segment: {activeSegment?.label ?? "All wallets"} | Sorted by{" "}
              {activeSort?.label ?? "Realized PnL"} (
              {sortDirection === "desc" ? "high to low" : "low to high"})
            </CardDescription>
          </div>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search wallet alias or address"
                className="pl-9 bg-background/60 border-border/60 transition-all"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground font-medium">
                <SlidersHorizontal className="h-4 w-4" />
                Controls
              </div>
              <Select
                value={segment}
                onValueChange={(value) => setSegment(value as SegmentKey)}
              >
                <SelectTrigger className="sm:w-44 bg-background/60 border-border/60 transition-all">
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
                <SelectTrigger className="sm:w-44 bg-background/60 border-border/60 transition-all">
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
                className="h-9 w-9 bg-background/60 border-border/60 transition-all"
                onClick={() =>
                  setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
                }
              >
                <ArrowUpDown className={cn(
                  "h-4 w-4 transition-all duration-200",
                  sortDirection === "asc" && "rotate-180"
                )} />
                <span className="sr-only">Toggle sort direction</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="border border-border/60 rounded-xl overflow-hidden bg-background/40">
            <div
              className="overflow-x-auto"
              style={{
                maxHeight: '600px',
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse min-w-[880px]">
                <thead className="sticky top-0 z-40 bg-card/95 backdrop-blur-sm border-b border-border/60">
                  <tr>
                    <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground w-[220px]">Wallet</th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("wis")}
                    >
                      <div className="flex items-center gap-1.5">
                        WIS
                        <ArrowUpDown className={sortIndicatorClass("wis")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("realized_pnl_usd")}
                    >
                      <div className="flex items-center gap-1.5">
                        Realized PnL
                        <ArrowUpDown className={sortIndicatorClass("realized_pnl_usd")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("roi")}
                    >
                      <div className="flex items-center gap-1.5">
                        ROI
                        <ArrowUpDown className={sortIndicatorClass("roi")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("total_invested_usd")}
                    >
                      <div className="flex items-center gap-1.5">
                        Capital
                        <ArrowUpDown className={sortIndicatorClass("total_invested_usd")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("win_rate")}
                    >
                      <div className="flex items-center gap-1.5">
                        Win Rate
                        <ArrowUpDown className={sortIndicatorClass("win_rate")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("trades_total")}
                    >
                      <div className="flex items-center gap-1.5">
                        Trades
                        <ArrowUpDown className={sortIndicatorClass("trades_total")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("contrarian_score")}
                    >
                      <div className="flex items-center gap-1.5">
                        Contrarian %
                        <ArrowUpDown className={sortIndicatorClass("contrarian_score")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("contrarian_win_rate")}
                    >
                      <div className="flex items-center gap-1.5">
                        Contrarian Win
                        <ArrowUpDown className={sortIndicatorClass("contrarian_win_rate")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("last_trade_date")}
                    >
                      <div className="flex items-center gap-1.5">
                        Last Trade
                        <ArrowUpDown className={sortIndicatorClass("last_trade_date")} />
                      </div>
                    </th>
                    <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedWallets.length === 0 ? (
                    <tr>
                      <td
                        colSpan={11}
                        className="py-12 text-center text-muted-foreground"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <Search className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-base">No wallets match the current filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sortedWallets.map((wallet) => {
                      const rank = topRanks.get(wallet.wallet_id);

                      return (
                        <tr
                          key={wallet.wallet_id}
                          className={cn(
                            "border-b border-border/40 hover:bg-muted/40 transition-all duration-200",
                            wallet.roi < 0 && "bg-rose-500/5 hover:bg-rose-500/10"
                          )}
                        >
                          <td className="px-4 py-3 align-middle whitespace-nowrap">
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#00E0AA]/20 to-muted text-sm font-medium uppercase ring-1 ring-border/40">
                                {wallet.wallet_alias.slice(0, 2)}
                              </div>
                              <div className="flex flex-col">
                                <Link
                                  href={`/analysis/wallet/${wallet.wallet_id}`}
                                  className="text-base font-semibold text-foreground transition-colors"
                                >
                                  {wallet.wallet_alias}
                                </Link>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="font-mono">{wallet.wallet_id}</span>
                                  {rank ? (
                                    <Badge className="border-[#00E0AA]/40 bg-[#00E0AA]/15 text-[#00E0AA] px-1.5 py-0">
                                      #{rank}
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <Badge className={cn("px-2 py-1", getWisBadgeClass(wallet.wis))}>
                              {wallet.wis}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <div className="flex flex-col gap-1">
                              <span className={getPnlTextClass(wallet.realized_pnl_usd)}>
                                {formatCurrency(wallet.realized_pnl_usd)}
                              </span>
                              <CoverageBadge coveragePct={wallet.coverage_pct} showIcon={false} variant="minimal" />
                            </div>
                          </td>
                          <td className={cn("px-4 py-3 align-middle", getRoiTextClass(wallet.roi))}>
                            {wallet.roi.toFixed(1)}%
                          </td>
                          <td className="px-4 py-3 align-middle">{formatCurrency(wallet.total_invested_usd)}</td>
                          <td className="px-4 py-3 align-middle">{wallet.win_rate.toFixed(1)}%</td>
                          <td className="px-4 py-3 align-middle">{wallet.trades_total}</td>
                          <td className="px-4 py-3 align-middle">{wallet.contrarian_score.toFixed(1)}%</td>
                          <td
                            className={cn(
                              "px-4 py-3 align-middle",
                              wallet.contrarian_win_rate >= 65 && "text-emerald-300 font-semibold"
                            )}
                          >
                            {wallet.contrarian_win_rate.toFixed(1)}%
                          </td>
                          <td className="px-4 py-3 align-middle">{formatDate(wallet.last_trade_date)}</td>
                          <td className="px-4 py-3 align-middle">
                            <Button
                              size="sm"
                              variant="ghost"
                              asChild
                              className="transition-all"
                            >
                              <Link href={`/analysis/wallet/${wallet.wallet_id}`}>
                                <Eye className="h-4 w-4" />
                                <span className="sr-only">Open wallet</span>
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 border-t border-border/60 pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between bg-card/30">
          <span>
            Showing <span className="font-semibold text-foreground">{sortedWallets.length}</span> of <span className="font-semibold text-foreground">{walletData.length}</span> wallets
          </span>
          <span className="text-xs">
            Segment: {activeSegment?.label ?? "All wallets"} | Sort:{" "}
            {activeSort?.label ?? "Realized PnL"} ({sortDirection.toUpperCase()})
          </span>
        </CardFooter>
      </Card>
      </div>
    </Card>
  );
}
