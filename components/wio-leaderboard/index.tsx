"use client";

import { useState, useMemo } from "react";
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
];

const tierOptions: Array<{ value: TierFilter; label: string; description: string }> = [
  { value: "all", label: "All Tiers", description: "Show all qualified wallets" },
  { value: "superforecaster", label: "Superforecasters", description: "Top-tier predictors (529)" },
  { value: "smart", label: "Smart Money", description: "High credibility traders" },
  { value: "profitable", label: "Profitable", description: "Positive ROI wallets" },
  { value: "slight_loser", label: "Slight Losers", description: "Minor losses" },
  { value: "bot", label: "Bots", description: "Automated traders" },
];

export function WIOLeaderboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("credibility");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");

  const { leaderboard, summary, tierStats, isLoading, error } = useWIOLeaderboard({
    limit: 200,
    tier: tierFilter,
    sortBy,
    sortDir,
    minPositions: 10,
  });

  // Search filter - also filters out entries with invalid wallet_id
  const filteredLeaderboard = useMemo(() => {
    const validEntries = leaderboard.filter((entry) => entry.wallet_id);
    if (!searchQuery.trim()) return validEntries;
    const query = searchQuery.toLowerCase();
    return validEntries.filter((entry) =>
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

  // Loading state
  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="px-6 py-6">
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
            <p className="text-muted-foreground">Loading WIO leaderboard...</p>
          </div>
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
          <Shield className="h-6 w-6 text-[#00E0AA]" />
          <h1 className="text-2xl font-semibold tracking-tight">Smart Money Leaderboard</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Top wallets ranked by WIO credibility score. Track superforecasters and smart money traders.
        </p>
      </div>

      <div className="px-6 py-6 flex flex-col gap-6">
        {/* Summary Cards */}
        {summary && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="bg-purple-500/5 border-purple-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-purple-400" />
                  Superforecasters
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-purple-400">{summary.superforecasters}</p>
                <p className="text-xs text-muted-foreground mt-1">Credibility ≥ 50%, non-bot</p>
              </CardContent>
            </Card>

            <Card className="bg-[#00E0AA]/5 border-[#00E0AA]/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#00E0AA]" />
                  Smart Money
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-[#00E0AA]">{summary.smart_money.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">Credibility 30-50%</p>
              </CardContent>
            </Card>

            <Card className="bg-blue-500/5 border-blue-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-400" />
                  Profitable
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-blue-400">{summary.profitable.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">Positive ROI wallets</p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Users className="h-4 w-4" />
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

        {/* Leaderboard Table */}
        <Card className="border-border/60 bg-card/50">
          <CardHeader className="space-y-4">
            <div>
              <CardTitle className="text-xl">Leaderboard</CardTitle>
              <CardDescription className="mt-1">
                Sorted by {sortOptions.find(s => s.value === sortBy)?.label} ({sortDir === "desc" ? "high to low" : "low to high"})
              </CardDescription>
            </div>

            {/* Controls */}
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
                  <SelectTrigger className="w-44 bg-background/60 border-border/60">
                    <SelectValue placeholder="Filter by tier" />
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
                  <SelectTrigger className="w-40 bg-background/60 border-border/60">
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
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="border border-border/60 rounded-xl overflow-hidden bg-background/40">
              <div className="overflow-x-auto" style={{ maxHeight: '600px', overflowY: 'auto' }}>
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
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeaderboard.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-12 text-center text-muted-foreground">
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
                              <Link
                                href={`/analysis/wallet/${entry.wallet_id}`}
                                className="font-mono text-sm hover:text-[#00E0AA] transition-colors"
                              >
                                {entry.wallet_id.slice(0, 6)}...{entry.wallet_id.slice(-4)}
                              </Link>
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
                            <td className={cn("px-3 py-3", entry.win_rate >= 0.5 ? "text-emerald-400" : "text-red-400")}>
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
                            <td className="px-3 py-3">
                              <Button size="sm" variant="ghost" asChild>
                                <Link href={`/analysis/wallet/${entry.wallet_id}`}>
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
          </CardContent>

          <CardFooter className="border-t border-border/60 pt-4 text-sm text-muted-foreground">
            <span>
              Showing <span className="font-semibold text-foreground">{filteredLeaderboard.length}</span> wallets
              {tierFilter !== "all" && ` (filtered by ${tierOptions.find(t => t.value === tierFilter)?.label})`}
            </span>
          </CardFooter>
        </Card>
      </div>
    </Card>
  );
}
