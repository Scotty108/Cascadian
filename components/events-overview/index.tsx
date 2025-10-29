"use client";

import { Card } from "@/components/ui/card";
// import { GlowBorder } from "@/components/ui/glow-border"; // COMMENTED OUT
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Search, TrendingUp, Clock, DollarSign, ChevronRight, Filter, X, Zap, BarChart3, Activity } from "lucide-react";
import Link from "next/link";
import { useState, useMemo, useCallback } from "react";
import { usePolymarketEvents } from "@/hooks/use-polymarket-events";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

// Mock events data (fallback only)
const mockEvents = [
  {
    event_id: "1",
    event_slug: "2024-presidential-election",
    title: "2024 Presidential Election",
    description: "Who will win the 2024 United States Presidential Election?",
    category: "Politics",
    marketCount: 8,
    totalVolume: 125000000,
    totalLiquidity: 12500000,
    endDate: "2024-11-05T00:00:00Z",
    urgencyScore: 95,
  },
  {
    event_id: "2",
    event_slug: "bitcoin-price-2024",
    title: "Bitcoin Price Predictions 2024",
    description: "Various predictions about Bitcoin's price trajectory in 2024",
    category: "Crypto",
    marketCount: 12,
    totalVolume: 89000000,
    totalLiquidity: 8900000,
    endDate: "2024-12-31T00:00:00Z",
    urgencyScore: 75,
  },
  {
    event_id: "3",
    event_slug: "nba-championship-2025",
    title: "NBA Championship 2024-2025",
    description: "Which team will win the 2024-2025 NBA Championship?",
    category: "Sports",
    marketCount: 15,
    totalVolume: 45000000,
    totalLiquidity: 4500000,
    endDate: "2025-06-30T00:00:00Z",
    urgencyScore: 60,
  },
  {
    event_id: "4",
    event_slug: "ai-developments-2024",
    title: "AI Developments 2024",
    description: "Major artificial intelligence breakthroughs and releases in 2024",
    category: "Tech",
    marketCount: 10,
    totalVolume: 67000000,
    totalLiquidity: 6700000,
    endDate: "2024-12-31T00:00:00Z",
    urgencyScore: 80,
  },
  {
    event_id: "5",
    event_slug: "climate-targets-2024",
    title: "Climate Targets 2024",
    description: "Will major countries meet their 2024 climate commitments?",
    category: "Politics",
    marketCount: 6,
    totalVolume: 23000000,
    totalLiquidity: 2300000,
    endDate: "2024-12-31T00:00:00Z",
    urgencyScore: 70,
  },
  {
    event_id: "6",
    event_slug: "oscars-2025",
    title: "Academy Awards 2025",
    description: "Predictions for the 97th Academy Awards",
    category: "Entertainment",
    marketCount: 20,
    totalVolume: 38000000,
    totalLiquidity: 3800000,
    endDate: "2025-03-02T00:00:00Z",
    urgencyScore: 55,
  },
];

// Category color mapping
const categoryColors: Record<string, string> = {
  Politics: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  Sports: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  Crypto: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  Tech: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  Entertainment: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
};

// Urgency badge color based on score
const getUrgencyColor = (score: number) => {
  if (score >= 80) return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
  if (score >= 60) return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
  return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
};

export function EventsOverview() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("urgency");
  const [timeFilter, setTimeFilter] = useState("all");
  const [minLiquidity, setMinLiquidity] = useState(0);
  const [maxLiquidity, setMaxLiquidity] = useState(15);
  const [minVolume, setMinVolume] = useState(0);
  const [maxVolume, setMaxVolume] = useState(150);
  const [minMarkets, setMinMarkets] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch real events data from API
  const { events: apiEvents, isLoading, error } = usePolymarketEvents({ limit: 100 });

  // Calculate urgency score based on time until event ends
  const calculateUrgencyScore = (endDate: string): number => {
    const now = new Date().getTime();
    const end = new Date(endDate).getTime();
    const hoursUntilEnd = (end - now) / (1000 * 60 * 60);

    if (hoursUntilEnd < 0) return 0; // Already ended
    if (hoursUntilEnd < 24) return 95; // Less than 24 hours
    if (hoursUntilEnd < 48) return 90; // 24-48 hours
    if (hoursUntilEnd < 168) return 80; // Less than a week
    if (hoursUntilEnd < 720) return 70; // Less than a month
    return 60; // More than a month
  };

  // Transform API events to match expected structure
  const transformedEvents = useMemo(() => {
    return apiEvents.map((event) => ({
      event_id: event.id,
      event_slug: event.slug,
      title: event.title,
      description: event.description || '',
      category: event.category || 'Other',
      marketCount: event.marketCount || event.markets?.length || 0,
      totalVolume: event.volume || 0,
      totalLiquidity: event.liquidity || 0,
      endDate: event.endDate || new Date().toISOString(),
      urgencyScore: calculateUrgencyScore(event.endDate || new Date().toISOString()),
    }));
  }, [apiEvents]);

  // Use real data if available, otherwise fallback to mock
  const sourceEvents = transformedEvents.length > 0 ? transformedEvents : mockEvents;

  // Calculate date ranges for time filters
  const dateRanges = useMemo(() => {
    const now = new Date();
    return {
      in24Hours: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      in7Days: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      in30Days: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    };
  }, []);

  // Filter and sort events
  const filteredEvents = useMemo(() => {
    return sourceEvents
      .filter((event) => {
        const matchesSearch = event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             event.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = categoryFilter === "all" || event.category === categoryFilter;

        // Time filter
        const eventEndDate = new Date(event.endDate);
        let matchesTime = true;
        if (timeFilter === "24h") matchesTime = eventEndDate <= dateRanges.in24Hours;
        else if (timeFilter === "7d") matchesTime = eventEndDate <= dateRanges.in7Days;
        else if (timeFilter === "30d") matchesTime = eventEndDate <= dateRanges.in30Days;

        // Liquidity filter (in millions)
        const liquidityInMillions = event.totalLiquidity / 1000000;
        const matchesLiquidity = liquidityInMillions >= minLiquidity && liquidityInMillions <= maxLiquidity;

        // Volume filter (in millions)
        const volumeInMillions = event.totalVolume / 1000000;
        const matchesVolume = volumeInMillions >= minVolume && volumeInMillions <= maxVolume;

        // Market count filter
        const matchesMarkets = event.marketCount >= minMarkets;

        return matchesSearch && matchesCategory && matchesTime && matchesLiquidity && matchesVolume && matchesMarkets;
      })
      .sort((a, b) => {
        if (sortBy === "urgency") return b.urgencyScore - a.urgencyScore;
        if (sortBy === "volume") return b.totalVolume - a.totalVolume;
        if (sortBy === "markets") return b.marketCount - a.marketCount;
        if (sortBy === "liquidity") return b.totalLiquidity - a.totalLiquidity;
        if (sortBy === "ending") return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
        return 0;
      });
  }, [sourceEvents, searchQuery, categoryFilter, sortBy, timeFilter, minLiquidity, maxLiquidity, minVolume, maxVolume, minMarkets, dateRanges]);

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    return (
      (categoryFilter !== "all" ? 1 : 0) +
      (timeFilter !== "all" ? 1 : 0) +
      (minLiquidity > 0 || maxLiquidity < 15 ? 1 : 0) +
      (minVolume > 0 || maxVolume < 150 ? 1 : 0) +
      (minMarkets > 0 ? 1 : 0)
    );
  }, [categoryFilter, timeFilter, minLiquidity, maxLiquidity, minVolume, maxVolume, minMarkets]);

  const resetFilters = useCallback(() => {
    setCategoryFilter("all");
    setTimeFilter("all");
    setMinLiquidity(0);
    setMaxLiquidity(15);
    setMinVolume(0);
    setMaxVolume(150);
    setMinMarkets(0);
  }, []);

  // Get active filter pills
  const activeFilterPills = useMemo(() => {
    const pills = [];
    if (categoryFilter !== "all") pills.push({ key: "category", label: `Category: ${categoryFilter}`, clear: () => setCategoryFilter("all") });
    if (timeFilter !== "all") pills.push({ key: "time", label: `Time: ${timeFilter}`, clear: () => setTimeFilter("all") });
    if (minLiquidity > 0 || maxLiquidity < 15) pills.push({ key: "liquidity", label: `Liquidity: $${minLiquidity}M-$${maxLiquidity}M`, clear: () => { setMinLiquidity(0); setMaxLiquidity(15); } });
    if (minVolume > 0 || maxVolume < 150) pills.push({ key: "volume", label: `Volume: $${minVolume}M-$${maxVolume}M`, clear: () => { setMinVolume(0); setMaxVolume(150); } });
    if (minMarkets > 0) pills.push({ key: "markets", label: `Min Markets: ${minMarkets}`, clear: () => setMinMarkets(0) });
    return pills;
  }, [categoryFilter, timeFilter, minLiquidity, maxLiquidity, minVolume, maxVolume, minMarkets]);

  return (
    // <GlowBorder color="blue" intensity="subtle" speed="slow">
    <Card className="shadow-none rounded-2xl border-0 dark:bg-[#18181b]">
      {/* Header */}
      <div className="px-6 pt-5 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border">
            <div className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
            <span className="text-xs font-medium text-muted-foreground">Live Events</span>
          </div>
          <Badge variant="outline" className="border-border/50">
            <Activity className="h-3 w-3 mr-1" />
            {isLoading ? '...' : sourceEvents.length} Active
          </Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Events</h1>
        <p className="text-sm text-muted-foreground">
          Browse prediction markets grouped by major events across politics, sports, crypto, and more
        </p>
      </div>

      {/* Filters Section */}
      <div className="px-6 py-4 border-t border-border/50">
        {/* Main Filters Bar */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events by title or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-background/50"
              />
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full md:w-[200px] bg-background/50">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="urgency">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Urgency
                  </div>
                </SelectItem>
                <SelectItem value="volume">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Volume
                  </div>
                </SelectItem>
                <SelectItem value="liquidity">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Liquidity
                  </div>
                </SelectItem>
                <SelectItem value="markets">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Market Count
                  </div>
                </SelectItem>
                <SelectItem value="ending">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Ending Soonest
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className={cn("gap-2", showFilters && "bg-muted border-border")}
            >
              <Filter className="h-4 w-4" />
              Filters
              {activeFiltersCount > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0.5 bg-foreground text-background">
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        {/* Active Filters Pills */}
        {activeFilterPills.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">Active filters:</span>
            {activeFilterPills.map((pill) => (
              <Badge
                key={pill.key}
                variant="secondary"
                className="gap-2 px-3 py-1 bg-muted text-foreground border border-border hover:bg-muted/80 cursor-pointer transition-colors"
                onClick={pill.clear}
              >
                {pill.label}
                <X className="h-3 w-3" />
              </Badge>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </Button>
          </div>
        )}

        {/* Advanced Filters Panel */}
        {showFilters && (
          <Card className="p-6 border-border/50 bg-card/50 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-semibold tracking-tight">Advanced Filters</h3>
                <p className="text-sm text-muted-foreground mt-1">Refine your event search</p>
              </div>
              {activeFiltersCount > 0 && (
                <Button variant="outline" size="sm" onClick={resetFilters} className="gap-2">
                  <X className="h-4 w-4" />
                  Clear All
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Category Filter */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Category</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="Politics">Politics</SelectItem>
                    <SelectItem value="Sports">Sports</SelectItem>
                    <SelectItem value="Crypto">Crypto</SelectItem>
                    <SelectItem value="Tech">Tech</SelectItem>
                    <SelectItem value="Entertainment">Entertainment</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Time Filter */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Ending Time</Label>
                <Select value={timeFilter} onValueChange={setTimeFilter}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Time</SelectItem>
                    <SelectItem value="24h">Next 24 Hours</SelectItem>
                    <SelectItem value="7d">Next 7 Days</SelectItem>
                    <SelectItem value="30d">Next 30 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Min Markets Filter */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Minimum Markets</Label>
                <Input
                  type="number"
                  min="0"
                  value={minMarkets}
                  onChange={(e) => setMinMarkets(Number(e.target.value))}
                  placeholder="0"
                  className="bg-background/50"
                />
              </div>

              {/* Liquidity Range */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">
                  Liquidity Range
                  <span className="ml-2 text-[#00E0AA] font-semibold">
                    ${minLiquidity}M - ${maxLiquidity}M
                  </span>
                </Label>
                <div className="pt-1">
                  <Slider
                    min={0}
                    max={15}
                    step={0.5}
                    value={[minLiquidity, maxLiquidity]}
                    onValueChange={([min, max]) => {
                      setMinLiquidity(min);
                      setMaxLiquidity(max);
                    }}
                    className="w-full [&_[role=slider]]:bg-[#00E0AA] [&_[role=slider]]:border-[#00E0AA] [&_.bg-primary]:bg-[#00E0AA]"
                  />
                </div>
              </div>

              {/* Volume Range */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">
                  Volume Range
                  <span className="ml-2 text-[#00E0AA] font-semibold">
                    ${minVolume}M - ${maxVolume}M
                  </span>
                </Label>
                <div className="pt-1">
                  <Slider
                    min={0}
                    max={150}
                    step={5}
                    value={[minVolume, maxVolume]}
                    onValueChange={([min, max]) => {
                      setMinVolume(min);
                      setMaxVolume(max);
                    }}
                    className="w-full [&_[role=slider]]:bg-[#00E0AA] [&_[role=slider]]:border-[#00E0AA] [&_.bg-primary]:bg-[#00E0AA]"
                  />
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Events Grid */}
      <div className="px-6 pb-6">
      {filteredEvents.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredEvents.map((event) => (
            <Link key={event.event_id} href={`/events/${event.event_slug}`} prefetch={true}>
              <Card className="group relative p-6 border border-border/50 hover:border-border hover:shadow-md transition-all duration-300 cursor-pointer bg-card/50 backdrop-blur-sm">
                {/* Header with Category and Urgency */}
                <div className="flex items-center justify-between mb-4">
                  <Badge
                    variant="outline"
                    className={`${categoryColors[event.category] || 'bg-muted'} border text-xs font-medium`}
                  >
                    {event.category}
                  </Badge>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="font-medium">
                      {new Date(event.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                </div>

                {/* Title */}
                <h2 className="text-xl font-semibold tracking-tight mb-3 group-hover:text-foreground transition-colors line-clamp-2">
                  {event.title}
                </h2>

                {/* Description */}
                <p className="text-sm text-muted-foreground line-clamp-2 mb-6">
                  {event.description}
                </p>

                {/* Footer Metrics */}
                <div className="flex items-center justify-between pt-4 border-t border-border/30">
                  <div className="flex items-center gap-4 text-xs">
                    <div>
                      <span className="text-muted-foreground">Volume</span>
                      <p className="font-semibold text-foreground">${(event.totalVolume / 1000000).toFixed(1)}M</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Liquidity</span>
                      <p className="font-semibold text-foreground">${(event.totalLiquidity / 1000000).toFixed(1)}M</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Markets</span>
                      <p className="font-semibold text-foreground">{event.marketCount}</p>
                    </div>
                  </div>

                  {/* Urgency Indicator */}
                  {event.urgencyScore >= 80 && (
                    <div className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
                      event.urgencyScore >= 90 ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    )}>
                      <Zap className="h-3 w-3" />
                      <span>Urgent</span>
                    </div>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center border-border/50 bg-card/50 backdrop-blur-sm">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No events found</h3>
            <p className="text-muted-foreground mb-6">
              No events match your current filter criteria. Try adjusting your filters or search terms.
            </p>
            {activeFiltersCount > 0 && (
              <Button variant="outline" onClick={resetFilters} className="gap-2">
                <X className="h-4 w-4" />
                Clear All Filters
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Results Info */}
      <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          <span>
            Showing <span className="font-semibold text-foreground">{filteredEvents.length}</span> of <span className="font-semibold text-foreground">{sourceEvents.length}</span> events
          </span>
        </div>
        {activeFiltersCount > 0 && (
          <>
            <span>•</span>
            <span>{activeFiltersCount} filter{activeFiltersCount !== 1 ? 's' : ''} active</span>
          </>
        )}
      </div>
      </div>
    </Card>
    // </GlowBorder>
  );
}
