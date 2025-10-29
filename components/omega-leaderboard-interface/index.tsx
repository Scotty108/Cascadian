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
  Zap,
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
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { OmegaLeaderboardRow } from "./types";

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

const formatCurrency = (value: number) => currencyFormatter.format(value);
const formatCompactCurrency = (value: number) => compactCurrencyFormatter.format(value);

type SortKey = keyof OmegaLeaderboardRow;
type SegmentKey = "all" | "sGrade" | "improving" | "highPnl" | "reasonable";

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
  { value: "omega_ratio", label: "Omega Ratio" },
  { value: "roi_per_bet", label: "ROI Per Bet" },
  { value: "overall_roi", label: "Overall ROI %" },
  { value: "omega_momentum", label: "Omega Momentum" },
  { value: "total_pnl", label: "Total PnL" },
  { value: "win_rate", label: "Win Rate" },
  { value: "avg_gain", label: "Avg Gain" },
  { value: "closed_positions", label: "Closed Positions" },
];

const segmentOptions: Array<{ value: SegmentKey; label: string; helper: string }> = [
  { value: "all", label: "All Wallets", helper: "Complete leaderboard" },
  { value: "sGrade", label: "S Grade Only", helper: "Omega > 3.0" },
  { value: "improving", label: "Hot Momentum", helper: "Improving omega" },
  { value: "highPnl", label: "High Earners", helper: "PnL > $10k" },
  { value: "reasonable", label: "Reasonable Omega", helper: "Omega ≤ 50 (filters outliers)" },
];

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

const getGradeBadgeClass = (grade: string) => {
  switch (grade) {
    case 'S':
      return "border-purple-500/40 bg-purple-500/15 text-purple-300";
    case 'A':
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
    case 'B':
      return "border-sky-500/30 bg-sky-500/10 text-sky-200";
    case 'C':
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case 'D':
      return "border-orange-500/30 bg-orange-500/10 text-orange-200";
    case 'F':
      return "border-rose-500/40 bg-rose-500/10 text-rose-200";
    default:
      return "border-border/30 bg-muted/10 text-muted-foreground";
  }
};

const getOmegaTextClass = (value: number) => {
  if (value >= 3.0) return "text-purple-400 font-semibold";
  if (value >= 2.0) return "text-emerald-400 font-semibold";
  if (value >= 1.5) return "text-emerald-300";
  if (value >= 1.0) return "text-emerald-200";
  if (value >= 0.5) return "text-amber-300";
  return "text-rose-400 font-semibold";
};

const getPnlTextClass = (value: number) => {
  if (value >= 100000) return "text-emerald-400 font-semibold";
  if (value > 0) return "text-emerald-300";
  if (value === 0) return "text-muted-foreground";
  if (value > -50000) return "text-amber-300";
  return "text-rose-400 font-semibold";
};

const getRoiTextClass = (value: number) => {
  if (value >= 50) return "text-emerald-400 font-semibold";
  if (value >= 20) return "text-emerald-300";
  if (value > 0) return "text-emerald-200";
  if (value > -20) return "text-amber-300";
  return "text-rose-400 font-semibold";
};

const getMomentumIcon = (direction: string) => {
  switch (direction) {
    case 'improving':
      return '📈';
    case 'declining':
      return '📉';
    case 'stable':
      return '➡️';
    default:
      return '⏸️';
  }
};

const getSymbolSize = (positions: number) => Math.max(16, Math.min(42, positions / 3));

const getOmegaColor = (omega: number, isDark: boolean) => {
  if (omega >= 3.0) return "#A855F7"; // Purple for S grade
  if (omega >= 2.0) return ACCENT_COLOR; // Emerald for A grade
  if (omega >= 1.5) return "rgba(0, 224, 170, 0.65)"; // Light emerald for B
  if (omega >= 1.0) return isDark ? "#64748B" : "#94A3B8"; // Slate for C
  if (omega >= 0.5) return isDark ? "#FACC15" : "#F59E0B"; // Amber for D
  return "#EF4444"; // Red for F
};

const legendPaletteLight = [
  { label: "S Grade (>3.0)", color: "#A855F7" },
  { label: "A Grade (>2.0)", color: ACCENT_COLOR },
  { label: "B Grade (>1.5)", color: "rgba(0, 224, 170, 0.6)" },
  { label: "C Grade (>1.0)", color: "#94A3B8" },
  { label: "D Grade (>0.5)", color: "#F59E0B" },
  { label: "F Grade (≤0.5)", color: "#EF4444" },
] as const;

const legendPaletteDark = [
  { label: "S Grade (>3.0)", color: "#A855F7" },
  { label: "A Grade (>2.0)", color: ACCENT_COLOR },
  { label: "B Grade (>1.5)", color: "rgba(0, 224, 170, 0.55)" },
  { label: "C Grade (>1.0)", color: "#64748B" },
  { label: "D Grade (>0.5)", color: "#FACC15" },
  { label: "F Grade (≤0.5)", color: "#F87171" },
] as const;

const getLegendPalette = (isDark: boolean) =>
  isDark ? legendPaletteDark : legendPaletteLight;

export function OmegaLeaderboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortKey>("omega_ratio");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [segment, setSegment] = useState<SegmentKey>("all");
  const [walletData, setWalletData] = useState<OmegaLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false); // For subsequent fetches after initial load
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Track first load
  const { resolvedTheme } = useTheme();

  // Filter controls
  const [topWallets, setTopWallets] = useState(50);
  const [minTrades, setMinTrades] = useState(10);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Debounced values for API calls
  const [debouncedTopWallets, setDebouncedTopWallets] = useState(50);
  const [debouncedMinTrades, setDebouncedMinTrades] = useState(10);

  // Market categories (from ClickHouse wallet_metrics_by_category)
  const categories = [
    { value: "all", label: "All Categories" },
    { value: "Politics / Geopolitics", label: "Politics / Geopolitics" },
    { value: "Crypto / DeFi", label: "Crypto / DeFi" },
    { value: "Sports", label: "Sports" },
    { value: "Macro / Economy", label: "Macro / Economy" },
    { value: "Pop Culture / Media", label: "Pop Culture / Media" },
    { value: "Earnings / Business", label: "Earnings / Business" },
  ];

  const isDark = resolvedTheme === "dark";

  // Debounce the slider values to avoid too many API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTopWallets(topWallets);
    }, 500); // Wait 500ms after user stops moving slider

    return () => clearTimeout(timer);
  }, [topWallets]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedMinTrades(minTrades);
    }, 500);

    return () => clearTimeout(timer);
  }, [minTrades]);

  // Fetch wallet data from API
  useEffect(() => {
    const fetchWallets = async () => {
      // Use different loading states for initial vs subsequent loads
      if (isInitialLoad) {
        setLoading(true);
      } else {
        setFetching(true);
      }

      try {
        const url = `/api/omega/leaderboard?limit=${debouncedTopWallets}&min_trades=${debouncedMinTrades}&category=${selectedCategory}`;
        console.log('Fetching omega data:', url);
        const response = await fetch(url);
        const data = await response.json();

        console.log('Received data:', data);
        if (data.success && data.data) {
          setWalletData(data.data);
          console.log('Updated walletData:', data.data.length, 'wallets');
        }
      } catch (error) {
        console.error('Error fetching omega leaderboard data:', error);
        setWalletData([]);
      } finally {
        if (isInitialLoad) {
          setIsInitialLoad(false);
          setLoading(false);
        } else {
          setFetching(false);
        }
      }
    };

    fetchWallets();
  }, [debouncedTopWallets, debouncedMinTrades, selectedCategory]);

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
      case "sGrade":
        return searchedWallets.filter((wallet) => wallet.grade === 'S');
      case "improving":
        return searchedWallets.filter((wallet) => wallet.momentum_direction === 'improving');
      case "highPnl":
        return searchedWallets.filter((wallet) => wallet.total_pnl > 10000);
      case "reasonable":
        return searchedWallets.filter((wallet) => wallet.omega_ratio <= 50);
      default:
        return searchedWallets;
    }
  }, [searchedWallets, segment]);

  const sortedWallets = useMemo(() => {
    const sorted = [...scopedWallets];

    sorted.sort((a, b) => {
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
          id: "avgOmega",
          title: "Avg Omega Ratio",
          primary: "-",
          helper: "No wallets matched",
          tone: "neutral",
          icon: Zap,
        },
        {
          id: "pnl",
          title: "Total PnL",
          primary: "$0",
          helper: "Awaiting data",
          tone: "neutral",
          icon: TrendingUp,
        },
        {
          id: "momentum",
          title: "Hot Wallets",
          primary: "-",
          helper: "Tune filters to explore leaders",
          tone: "accent",
          icon: Sparkles,
        },
      ];
    }

    const avgOmega =
      scopedWallets.reduce((sum, wallet) => sum + wallet.omega_ratio, 0) / scopedWallets.length;
    const medianOmega = [...scopedWallets].sort((a, b) => a.omega_ratio - b.omega_ratio)[
      Math.floor(scopedWallets.length / 2)
    ].omega_ratio;
    const totalPnl = scopedWallets.reduce((sum, wallet) => sum + wallet.total_pnl, 0);
    const improvingCount = scopedWallets.filter((w) => w.momentum_direction === 'improving').length;
    const improvingPercent = (improvingCount / scopedWallets.length) * 100;

    const gradeDistribution = scopedWallets.reduce((acc, w) => {
      acc[w.grade] = (acc[w.grade] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topGrade = Object.entries(gradeDistribution).sort(([, a], [, b]) => b - a)[0];

    return [
      {
        id: "avgOmega",
        title: "Avg Omega Ratio",
        primary: avgOmega.toFixed(2),
        helper: `Median: ${medianOmega.toFixed(2)} | ${scopedWallets.length} wallets`,
        tone: avgOmega >= 1.5 ? "positive" : avgOmega >= 1.0 ? "neutral" : "negative",
        icon: Zap,
      },
      {
        id: "pnl",
        title: "Total PnL",
        primary: formatCompactCurrency(totalPnl),
        helper: `Avg per wallet: ${formatCompactCurrency(totalPnl / scopedWallets.length)}`,
        tone: totalPnl >= 0 ? "positive" : "negative",
        icon: TrendingUp,
      },
      {
        id: "momentum",
        title: "Hot Wallets",
        primary: `${improvingPercent.toFixed(0)}%`,
        helper: `${improvingCount} improving | Most common: ${topGrade[0]} grade`,
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
          const wallet = params.data.wallet as OmegaLeaderboardRow;

          const categoryInfo = wallet.category && wallet.pct_of_total_trades
            ? `<span style="color:#A855F7;font-size:12px;">${wallet.category}: ${wallet.trades_in_category} trades (${wallet.pct_of_total_trades.toFixed(1)}% of wallet activity)</span>`
            : '';

          return `
            <div style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
              <strong style="font-size:14px;">${wallet.wallet_alias}</strong>
              ${categoryInfo}
              <span>Omega Ratio: <strong>${wallet.omega_ratio.toFixed(2)}</strong> (${wallet.grade} Grade)</span>
              <span>Total PnL: <strong>${formatCurrency(wallet.total_pnl)}</strong></span>
              <span>Win Rate: <strong>${wallet.win_rate.toFixed(1)}%</strong></span>
              <span>Positions: <strong>${wallet.closed_positions}</strong> | ${getMomentumIcon(wallet.momentum_direction)}</span>
            </div>
          `;
        },
      },
      xAxis: {
        type: "value",
        name: "Omega Ratio",
        nameLocation: "middle",
        nameGap: 36,
        axisLabel: {
          color: textColor,
          formatter: (value: number) => value.toFixed(1),
        },
        axisLine: { lineStyle: { color: axisColor } },
        splitLine: { lineStyle: { color: splitLineColor, type: "dashed" } },
      },
      yAxis: {
        type: "value",
        name: "Total PnL (USD)",
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
            value: [wallet.omega_ratio, wallet.total_pnl],
            wallet,
            itemStyle: {
              color: getOmegaColor(wallet.omega_ratio, isDark),
              shadowBlur: 8,
              shadowColor: "rgba(15, 23, 42, 0.25)",
            },
          })),
          symbolSize: (value: number[], params: any) => {
            const wallet = params.data.wallet as OmegaLeaderboardRow | undefined;
            return getSymbolSize(wallet?.closed_positions ?? 0);
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
            <div className="text-muted-foreground">Loading wallet omega scores from database...</div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm rounded-2xl overflow-hidden border-0 dark:bg-[#18181b]">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">
          Omega Ratio Leaderboard
          {selectedCategory !== "all" && (
            <Badge className="ml-3 border-purple-500/40 bg-purple-500/15 text-purple-300">
              {selectedCategory}
            </Badge>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {selectedCategory === "all"
            ? "Track wallets with asymmetric upside. Omega ratio measures total gains divided by total losses. Higher ratios indicate superior risk-adjusted returns"
            : `Showing ${selectedCategory}-specific performance. These omega ratios are calculated using only ${selectedCategory} trades for each wallet.`}
        </p>
      </div>

      <div className="px-6 py-6 flex flex-col gap-6">

      {/* Filter Controls Card */}
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm relative">
        {fetching && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-lg">
            <div className="flex items-center gap-2 text-purple-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent"></div>
              <span className="text-sm font-medium">Updating...</span>
            </div>
          </div>
        )}
        <CardHeader>
          <CardTitle className="text-lg">Formula Controls</CardTitle>
          <CardDescription>
            Adjust parameters to filter wallets and calculate average omega ratio
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            {/* Top X Wallets Control */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="top-wallets" className="text-sm font-medium">
                  Top Wallets
                </Label>
                <span className="text-sm font-semibold text-purple-400">
                  {topWallets}
                </span>
              </div>
              <Slider
                id="top-wallets"
                min={10}
                max={200}
                step={10}
                value={[topWallets]}
                onValueChange={(value) => setTopWallets(value[0])}
                className="[&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-500"
              />
              <p className="text-xs text-muted-foreground">
                Show the top {topWallets} wallets by omega ratio
                {topWallets !== debouncedTopWallets && (
                  <span className="ml-1 text-purple-400">(updating...)</span>
                )}
              </p>
            </div>

            {/* Minimum Trades Control */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="min-trades" className="text-sm font-medium">
                  Minimum Trades
                </Label>
                <span className="text-sm font-semibold text-purple-400">
                  {minTrades}+
                </span>
              </div>
              <Slider
                id="min-trades"
                min={5}
                max={100}
                step={5}
                value={[minTrades]}
                onValueChange={(value) => setMinTrades(value[0])}
                className="[&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-500"
              />
              <p className="text-xs text-muted-foreground">
                Only wallets with {minTrades}+ closed positions (eliminates one-hit wonders)
                {minTrades !== debouncedMinTrades && (
                  <span className="ml-1 text-purple-400">(updating...)</span>
                )}
              </p>
            </div>

            {/* Category Filter Control */}
            <div className="space-y-3">
              <Label htmlFor="category-filter" className="text-sm font-medium">
                Market Category
              </Label>
              <Select
                value={selectedCategory}
                onValueChange={setSelectedCategory}
              >
                <SelectTrigger
                  id="category-filter"
                  className="bg-background/60 border-border/60"
                >
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedCategory === "all"
                  ? "Showing overall omega ratios across all market categories"
                  : `Showing ${selectedCategory}-specific omega ratios (wallets must have ≥${minTrades} trades in this category)`}
              </p>
            </div>
          </div>

          {/* Live Stats Display */}
          <div className="grid gap-3 sm:grid-cols-3 rounded-lg border border-border/40 bg-muted/20 p-4 relative">
            {fetching && (
              <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] rounded-lg flex items-center justify-center">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent"></div>
              </div>
            )}
            <div className="text-center">
              <div className="text-2xl font-bold text-foreground">
                {scopedWallets.length > 0
                  ? (scopedWallets.reduce((sum, w) => sum + w.omega_ratio, 0) / scopedWallets.length).toFixed(2)
                  : '-'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Avg Omega</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">
                {scopedWallets.length > 0
                  ? [...scopedWallets].sort((a, b) => a.omega_ratio - b.omega_ratio)[Math.floor(scopedWallets.length / 2)]?.omega_ratio.toFixed(2)
                  : '-'}
              </div>
              <div className="text-xs text-purple-300/80 mt-1">Median Omega</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-foreground">
                {scopedWallets.length}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Wallets Shown</div>
            </div>
          </div>
        </CardContent>
      </Card>

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
            <CardTitle className="text-xl">Omega Ratio vs Total PnL</CardTitle>
            <CardDescription className="mt-1">
              Bubble size reflects closed positions. Color bands represent grade levels from S (purple) to F (red).
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
              {activeSort?.label ?? "Omega Ratio"} (
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
                      onClick={() => handleSort("grade")}
                    >
                      <div className="flex items-center gap-1.5">
                        Grade
                        <ArrowUpDown className={sortIndicatorClass("grade")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("omega_ratio")}
                    >
                      <div className="flex items-center gap-1.5">
                        Omega Ratio
                        <ArrowUpDown className={sortIndicatorClass("omega_ratio")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("omega_momentum")}
                    >
                      <div className="flex items-center gap-1.5">
                        Momentum
                        <ArrowUpDown className={sortIndicatorClass("omega_momentum")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("roi_per_bet")}
                    >
                      <div className="flex items-center gap-1.5">
                        ROI/Bet
                        <ArrowUpDown className={sortIndicatorClass("roi_per_bet")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("overall_roi")}
                    >
                      <div className="flex items-center gap-1.5">
                        ROI %
                        <ArrowUpDown className={sortIndicatorClass("overall_roi")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("total_pnl")}
                    >
                      <div className="flex items-center gap-1.5">
                        Total PnL
                        <ArrowUpDown className={sortIndicatorClass("total_pnl")} />
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
                      onClick={() => handleSort("avg_gain")}
                    >
                      <div className="flex items-center gap-1.5">
                        Avg Gain
                        <ArrowUpDown className={sortIndicatorClass("avg_gain")} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap transition-colors"
                      onClick={() => handleSort("closed_positions")}
                    >
                      <div className="flex items-center gap-1.5">
                        Positions
                        <ArrowUpDown className={sortIndicatorClass("closed_positions")} />
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
                            wallet.grade === 'S' && "bg-purple-500/5 hover:bg-purple-500/10"
                          )}
                        >
                          <td className="px-4 py-3 align-middle whitespace-nowrap">
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-500/20 to-muted text-sm font-medium uppercase ring-1 ring-border/40">
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
                                    <Badge className="border-purple-500/40 bg-purple-500/15 text-purple-400 px-1.5 py-0">
                                      #{rank}
                                    </Badge>
                                  ) : null}
                                </div>
                                {wallet.category && wallet.pct_of_total_trades && wallet.pct_of_total_trades > 0 ? (
                                  <div className="text-xs text-purple-400 mt-1">
                                    {wallet.trades_in_category} {wallet.category} trades ({wallet.pct_of_total_trades.toFixed(1)}% of activity)
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <Badge className={cn("px-2 py-1", getGradeBadgeClass(wallet.grade))}>
                              {wallet.grade}
                            </Badge>
                          </td>
                          <td className={cn("px-4 py-3 align-middle font-semibold", getOmegaTextClass(wallet.omega_ratio))}>
                            {wallet.omega_ratio.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <div className="flex items-center gap-2">
                              <span>{getMomentumIcon(wallet.momentum_direction)}</span>
                              <span className={cn(
                                wallet.momentum_direction === 'improving' && "text-emerald-300",
                                wallet.momentum_direction === 'declining' && "text-rose-300"
                              )}>
                                {wallet.omega_momentum > 0 ? '+' : ''}{(wallet.omega_momentum * 100).toFixed(1)}%
                              </span>
                            </div>
                          </td>
                          <td className={cn("px-4 py-3 align-middle font-semibold", getRoiTextClass(wallet.roi_per_bet || 0))}>
                            {formatCurrency(wallet.roi_per_bet || 0)}
                          </td>
                          <td className={cn("px-4 py-3 align-middle", getRoiTextClass(wallet.overall_roi || 0))}>
                            {(wallet.overall_roi || 0).toFixed(1)}%
                          </td>
                          <td className={cn("px-4 py-3 align-middle", getPnlTextClass(wallet.total_pnl))}>
                            {formatCurrency(wallet.total_pnl)}
                          </td>
                          <td className="px-4 py-3 align-middle">{wallet.win_rate.toFixed(1)}%</td>
                          <td className="px-4 py-3 align-middle text-emerald-300">{formatCurrency(wallet.avg_gain)}</td>
                          <td className="px-4 py-3 align-middle">{wallet.closed_positions}</td>
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
            {activeSort?.label ?? "Omega Ratio"} ({sortDirection.toUpperCase()})
          </span>
        </CardFooter>
      </Card>
      </div>
    </Card>
  );
}
