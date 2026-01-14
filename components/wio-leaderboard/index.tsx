"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ArrowUpDown,
  Eye,
  Search,
  Trophy,
  TrendingUp,
  Users,
  Sparkles,
  Loader2,
  Bot,
  Shield,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import {
  useWIOLeaderboard,
  getTierConfig,
  formatPnL,
  formatPercent,
  formatCredibility,
  getCredibilityBadgeClass,
  getPnLTextClass,
  getROITextClass,
  type SortField,
  type SortDirection,
  type TierFilter,
  type LeaderboardEntry,
} from "@/hooks/use-wio-leaderboard";

const sortOptions: Array<{ value: SortField; label: string }> = [
  { value: "credibility", label: "Credibility" },
  { value: "pnl", label: "Total PnL" },
  { value: "roi", label: "ROI" },
  { value: "win_rate", label: "Win Rate" },
  { value: "positions", label: "Positions" },
  { value: "activity", label: "Recent Activity" },
];

// Cache for profiles (username + avatar) to avoid refetching
interface CachedProfile {
  username?: string;
  profilePicture?: string;
}
const profileCache = new Map<string, CachedProfile | null>();
const fetchingProfiles = new Set<string>();

// Prefetch wallet data on hover to make navigation feel instant
const prefetchedWallets = new Set<string>();
function prefetchWalletData(walletId: string) {
  if (prefetchedWallets.has(walletId)) return;
  prefetchedWallets.add(walletId);
  fetch(`/api/wio/wallet/${walletId}`).catch(() => {});
}

// Fetch profile from Polymarket
async function fetchProfile(walletId: string): Promise<CachedProfile | null> {
  if (profileCache.has(walletId)) return profileCache.get(walletId) || null;
  if (fetchingProfiles.has(walletId)) return null;

  fetchingProfiles.add(walletId);
  try {
    const res = await fetch(`/api/polymarket/wallet/${walletId}/profile`);
    const data = await res.json();
    const profile: CachedProfile = {
      username: data.data?.username,
      profilePicture: data.data?.profilePicture,
    };
    profileCache.set(walletId, profile);
    return profile;
  } catch {
    profileCache.set(walletId, null);
    return null;
  } finally {
    fetchingProfiles.delete(walletId);
  }
}

function WalletCell({ walletId }: { walletId: string }) {
  const [profile, setProfile] = useState<CachedProfile | null>(profileCache.get(walletId) || null);
  const cellRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Observe visibility
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    if (cellRef.current) {
      observer.observe(cellRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Fetch profile when visible
  useEffect(() => {
    if (isVisible && !profileCache.has(walletId)) {
      fetchProfile(walletId).then(setProfile);
    }
  }, [isVisible, walletId]);

  const diceBearUrl = `https://api.dicebear.com/7.x/identicon/svg?seed=${walletId}`;

  return (
    <div ref={cellRef} className="flex items-center gap-2">
      <Avatar className="h-6 w-6">
        <AvatarImage src={profile?.profilePicture || diceBearUrl} />
        <AvatarFallback className="text-[10px]">
          {walletId.slice(2, 4).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <Link
        href={`/wallet-v2/${walletId}`}
        className="hover:underline transition-colors"
        onMouseEnter={() => prefetchWalletData(walletId)}
      >
        {profile?.username ? (
          <span className="text-sm font-medium">@{profile.username}</span>
        ) : (
          <span className="font-mono text-sm text-muted-foreground">
            {walletId.slice(0, 6)}...{walletId.slice(-4)}
          </span>
        )}
      </Link>
    </div>
  );
}

const tierOptions: Array<{ value: TierFilter; label: string; description: string }> = [
  { value: "all", label: "All Tiers", description: "Show all qualified wallets" },
  { value: "superforecaster", label: "Superforecasters", description: "Top-tier predictors (529)" },
  { value: "smart", label: "Smart Money", description: "High credibility traders" },
  { value: "profitable", label: "Profitable", description: "Positive ROI wallets" },
  { value: "slight_loser", label: "Slight Losers", description: "Minor losses" },
  { value: "bot", label: "Bots", description: "Automated traders" },
];

const PAGE_SIZE = 20;

export function WIOLeaderboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("credibility");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [minPnl, setMinPnl] = useState<number>(0);
  const [minWinRate, setMinWinRate] = useState<number | null>(null);
  const [minROI, setMinROI] = useState<number | null>(null);
  const [maxDaysSinceLastTrade, setMaxDaysSinceLastTrade] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const { leaderboard, summary, tierStats, pagination, isLoading, isValidating, error } = useWIOLeaderboard({
    page: currentPage,
    pageSize: PAGE_SIZE,
    tier: tierFilter,
    minPnl,
    minWinRate,
    minROI,
    maxDaysSinceLastTrade,
    sortBy,
    sortDir,
    minPositions: 10,
  });

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [tierFilter, minPnl, minWinRate, minROI, maxDaysSinceLastTrade, sortBy, sortDir]);

  // Search filter - also filters out entries with invalid wallet_id and dedupes
  const filteredLeaderboard = useMemo(() => {
    // Dedupe by wallet_id (keep first occurrence which has highest rank)
    const seen = new Set<string>();
    const deduped = leaderboard.filter((entry) => {
      if (!entry.wallet_id || seen.has(entry.wallet_id)) return false;
      seen.add(entry.wallet_id);
      return true;
    });

    if (!searchQuery.trim()) return deduped;
    const query = searchQuery.toLowerCase();
    return deduped.filter((entry) =>
      entry.wallet_id.toLowerCase().includes(query)
    );
  }, [leaderboard, searchQuery]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  };

  const sortIndicatorClass = (field: SortField) =>
    cn(
      "h-4 w-4 transition-all duration-200",
      sortBy === field ? "text-foreground" : "text-muted-foreground/60",
      sortBy === field && sortDir === "asc" && "rotate-180"
    );

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-border/50">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-6 w-6 text-[#00E0AA]" />
            <h1 className="text-2xl font-semibold tracking-tight">Smart Money Leaderboard</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Top wallets ranked by WIO credibility score. Track superforecasters and smart money traders.
          </p>
        </div>

        <div className="px-6 py-6 flex flex-col gap-6">
          {/* Summary Cards Skeleton */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { color: "purple", label: "Superforecasters" },
              { color: "emerald", label: "Smart Money" },
              { color: "blue", label: "Profitable" },
              { color: "gray", label: "Total Qualified" },
            ].map((card, i) => (
              <Card key={i} className={`bg-${card.color}-500/5 border-${card.color}-500/20`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-9 w-20 mb-1" />
                  <Skeleton className="h-3 w-28" />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Leaderboard Table Skeleton */}
          <Card className="border-border/60 bg-card/50">
            <CardHeader className="space-y-4">
              <div>
                <Skeleton className="h-6 w-32 mb-2" />
                <Skeleton className="h-4 w-48" />
              </div>

              {/* Controls Skeleton */}
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <Skeleton className="h-9 w-full lg:max-w-sm" />
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-9 w-44" />
                  <Skeleton className="h-9 w-36" />
                  <Skeleton className="h-9 w-40" />
                  <Skeleton className="h-9 w-9" />
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-0">
              <div className="border border-border/60 rounded-xl overflow-hidden bg-background/40">
                {/* Table Header Skeleton */}
                <div className="px-3 py-3 border-b border-border/60 bg-card/95">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-4 w-8" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                </div>

                {/* Table Rows Skeleton */}
                <div className="divide-y divide-border/40">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="px-3 py-3 flex items-center gap-4">
                      <Skeleton className="h-4 w-8" />
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-14" />
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-4 w-10" />
                      <Skeleton className="h-4 w-10" />
                      <Skeleton className="h-8 w-8 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>

            <CardFooter className="border-t border-border/60 pt-4">
              <Skeleton className="h-4 w-32" />
            </CardFooter>
          </Card>
        </div>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="px-6 py-6">
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-red-500">
            <p>Error loading leaderboard: {error.message}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Smart Money Leaderboard</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Top wallets ranked by WIO credibility score. Track superforecasters and smart money traders.
        </p>
      </div>

      <div className="px-6 py-6 flex flex-col gap-6">
        {/* Summary Cards - minimal styling */}
        {summary && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                  Superforecasters
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{summary.superforecasters}</p>
                <p className="text-xs text-muted-foreground mt-1">Credibility ≥ 50%, non-bot</p>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  Smart Money
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{summary.smart_money.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">Credibility 30-50%</p>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  Profitable
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{summary.profitable.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">Positive ROI wallets</p>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Total Qualified
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{summary.total_qualified_wallets.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">≥{summary.min_positions_filter} positions</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <div className="space-y-4">
          {/* Search and Primary Filters */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search wallet address"
                className="pl-9 bg-background/60 border-border/60"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as TierFilter)}>
                <SelectTrigger className="w-40 bg-background/60 border-border/60">
                  <SelectValue placeholder="Tier" />
                </SelectTrigger>
                <SelectContent>
                  {tierOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortField)}>
                <SelectTrigger className="w-36 bg-background/60 border-border/60">
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
                variant="outline"
                size="icon"
                className="h-9 w-9 bg-background/60 border-border/60"
                onClick={() => setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))}
              >
                <ArrowUpDown className={cn("h-4 w-4", sortDir === "asc" && "rotate-180")} />
              </Button>

              {isValidating && !isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Advanced Filters Row */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground text-xs uppercase tracking-wide mr-1">Filters:</span>

            <Select value={minPnl.toString()} onValueChange={(v) => setMinPnl(Number(v))}>
              <SelectTrigger className="h-8 w-28 text-xs bg-background/60 border-border/60">
                <SelectValue placeholder="Min PnL" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Any PnL</SelectItem>
                <SelectItem value="100">$100+</SelectItem>
                <SelectItem value="1000">$1k+</SelectItem>
                <SelectItem value="10000">$10k+</SelectItem>
                <SelectItem value="100000">$100k+</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={minWinRate?.toString() ?? "any"}
              onValueChange={(v) => setMinWinRate(v === "any" ? null : Number(v))}
            >
              <SelectTrigger className="h-8 w-28 text-xs bg-background/60 border-border/60">
                <SelectValue placeholder="Win Rate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any Win%</SelectItem>
                <SelectItem value="0.5">50%+</SelectItem>
                <SelectItem value="0.55">55%+</SelectItem>
                <SelectItem value="0.6">60%+</SelectItem>
                <SelectItem value="0.7">70%+</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={minROI?.toString() ?? "any"}
              onValueChange={(v) => setMinROI(v === "any" ? null : Number(v))}
            >
              <SelectTrigger className="h-8 w-28 text-xs bg-background/60 border-border/60">
                <SelectValue placeholder="Min ROI" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any ROI</SelectItem>
                <SelectItem value="0">0%+</SelectItem>
                <SelectItem value="0.1">10%+</SelectItem>
                <SelectItem value="0.25">25%+</SelectItem>
                <SelectItem value="0.5">50%+</SelectItem>
                <SelectItem value="1">100%+</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={maxDaysSinceLastTrade?.toString() ?? "any"}
              onValueChange={(v) => setMaxDaysSinceLastTrade(v === "any" ? null : Number(v))}
            >
              <SelectTrigger className="h-8 w-32 text-xs bg-background/60 border-border/60">
                <SelectValue placeholder="Activity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any Activity</SelectItem>
                <SelectItem value="1">Last 24h</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div>
            <div className="border border-border/60 rounded-xl overflow-hidden bg-background/40">
              <div className="overflow-x-auto">
                <table className="w-full whitespace-nowrap text-sm border-collapse min-w-[900px]">
                  <thead className="sticky top-0 z-40 bg-card/95 backdrop-blur-sm border-b border-border/60">
                    <tr>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground w-12">#</th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground w-[200px]">Wallet</th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">Tier</th>
                      <th
                        className="px-3 py-3 text-left font-medium text-muted-foreground cursor-pointer"
                        onClick={() => handleSort("credibility")}
                      >
                        <div className="flex items-center gap-1.5">
                          Credibility
                          <ArrowUpDown className={sortIndicatorClass("credibility")} />
                        </div>
                      </th>
                      <th
                        className="px-3 py-3 text-left font-medium text-muted-foreground cursor-pointer"
                        onClick={() => handleSort("pnl")}
                      >
                        <div className="flex items-center gap-1.5">
                          PnL
                          <ArrowUpDown className={sortIndicatorClass("pnl")} />
                        </div>
                      </th>
                      <th
                        className="px-3 py-3 text-left font-medium text-muted-foreground cursor-pointer"
                        onClick={() => handleSort("roi")}
                      >
                        <div className="flex items-center gap-1.5">
                          ROI
                          <ArrowUpDown className={sortIndicatorClass("roi")} />
                        </div>
                      </th>
                      <th
                        className="px-3 py-3 text-left font-medium text-muted-foreground cursor-pointer"
                        onClick={() => handleSort("win_rate")}
                      >
                        <div className="flex items-center gap-1.5">
                          Win Rate
                          <ArrowUpDown className={sortIndicatorClass("win_rate")} />
                        </div>
                      </th>
                      <th
                        className="px-3 py-3 text-left font-medium text-muted-foreground cursor-pointer"
                        onClick={() => handleSort("positions")}
                      >
                        <div className="flex items-center gap-1.5">
                          Positions
                          <ArrowUpDown className={sortIndicatorClass("positions")} />
                        </div>
                      </th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">Bot Risk</th>
                      <th
                        className="px-3 py-3 text-left font-medium text-muted-foreground cursor-pointer"
                        onClick={() => handleSort("activity")}
                      >
                        <div className="flex items-center gap-1.5">
                          Activity
                          <ArrowUpDown className={sortIndicatorClass("activity")} />
                        </div>
                      </th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeaderboard.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-12 text-center text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <Search className="h-8 w-8 text-muted-foreground/40" />
                            <p>No wallets match the current filters.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredLeaderboard.map((entry) => {
                        const tierConfig = getTierConfig(entry.tier);
                        return (
                          <tr
                            key={entry.wallet_id}
                            className="border-b border-border/40 hover:bg-muted/40 transition-colors"
                          >
                            <td className="px-3 py-3 text-muted-foreground font-mono">
                              {entry.rank}
                            </td>
                            <td className="px-3 py-3">
                              <WalletCell walletId={entry.wallet_id} />
                            </td>
                            <td className="px-3 py-3">
                              <Badge className={cn("border", tierConfig.bgClass, tierConfig.textClass, tierConfig.borderClass)}>
                                {tierConfig.shortLabel}
                              </Badge>
                            </td>
                            <td className="px-3 py-3">
                              <Badge className={cn("border", getCredibilityBadgeClass(entry.credibility_score))}>
                                {formatCredibility(entry.credibility_score)}
                              </Badge>
                            </td>
                            <td className={cn("px-3 py-3 font-semibold", getPnLTextClass(entry.pnl_total_usd))}>
                              {formatPnL(entry.pnl_total_usd)}
                            </td>
                            <td className={cn("px-3 py-3", getROITextClass(entry.roi_cost_weighted))}>
                              {formatPercent(entry.roi_cost_weighted)}
                            </td>
                            <td className="px-3 py-3 text-foreground">
                              {(entry.win_rate * 100).toFixed(1)}%
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {entry.resolved_positions_n}
                            </td>
                            <td className="px-3 py-3">
                              {entry.bot_likelihood > 0.5 ? (
                                <Badge variant="destructive" className="gap-1">
                                  <Bot className="h-3 w-3" />
                                  {(entry.bot_likelihood * 100).toFixed(0)}%
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">
                                  {(entry.bot_likelihood * 100).toFixed(0)}%
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground text-xs">
                              {entry.days_since_last_trade != null ? (
                                entry.days_since_last_trade === 0 ? (
                                  <span className="text-foreground">Today</span>
                                ) : entry.days_since_last_trade === 1 ? (
                                  "Yesterday"
                                ) : (
                                  `${entry.days_since_last_trade}d ago`
                                )
                              ) : (
                                "-"
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <Button size="sm" variant="ghost" asChild>
                                <Link href={`/wallet-v2/${entry.wallet_id}`}>
                                  <Eye className="h-4 w-4" />
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
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <span className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">
              {((currentPage - 1) * PAGE_SIZE) + 1}-{Math.min(currentPage * PAGE_SIZE, pagination.totalCount)}
            </span> of <span className="font-semibold text-foreground">{pagination.totalCount.toLocaleString()}</span> wallets
            {tierFilter !== "all" && ` (${tierOptions.find(t => t.value === tierFilter)?.label})`}
          </span>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1 || isLoading}
              className="h-8 w-8 p-0"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1 || isLoading}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="flex items-center gap-1 px-2">
              <span className="text-sm text-muted-foreground">Page</span>
              <span className="text-sm font-medium">{currentPage}</span>
              <span className="text-sm text-muted-foreground">of</span>
              <span className="text-sm font-medium">{pagination.totalPages}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={currentPage >= pagination.totalPages || isLoading}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(pagination.totalPages)}
              disabled={currentPage >= pagination.totalPages || isLoading}
              className="h-8 w-8 p-0"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
