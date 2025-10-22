"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Search, TrendingUp, Clock, DollarSign, ChevronRight, Filter, X, Zap, BarChart3, Activity } from "lucide-react";
import Link from "next/link";
import { useState, useMemo, useCallback } from "react";

// Mock events data
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
    return mockEvents
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
  }, [searchQuery, categoryFilter, sortBy, timeFilter, minLiquidity, maxLiquidity, minVolume, maxVolume, minMarkets, dateRanges]);

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
    <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#00E0AA]/10 via-background to-background border border-border/50 p-8">
        {/* Grid Pattern Overlay */}
        <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:32px_32px]" />

        <div className="relative z-10">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#00E0AA]/10 border border-[#00E0AA]/20">
                  <div className="h-2 w-2 rounded-full bg-[#00E0AA] animate-pulse" />
                  <span className="text-xs font-medium text-[#00E0AA]">Live Events</span>
                </div>
                <Badge variant="outline" className="border-border/50">
                  <Activity className="h-3 w-3 mr-1" />
                  {mockEvents.length} Active
                </Badge>
              </div>
              <h1 className="text-4xl font-bold tracking-tight mb-2">Events</h1>
              <p className="text-muted-foreground text-lg max-w-2xl">
                Browse prediction markets grouped by major events across politics, sports, crypto, and more
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Section */}
      <div className="flex flex-col gap-4">
        {/* Main Filters Bar */}
        <Card className="p-4 bg-card/50 backdrop-blur-sm border-border/50">
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
              variant={showFilters ? "default" : "outline"}
              onClick={() => setShowFilters(!showFilters)}
              className={`gap-2 ${showFilters ? 'bg-[#00E0AA] hover:bg-[#00E0AA]/90 text-black' : ''}`}
            >
              <Filter className="h-4 w-4" />
              Filters
              {activeFiltersCount > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0.5 bg-background text-foreground">
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>
          </div>
        </Card>

        {/* Active Filters Pills */}
        {activeFilterPills.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">Active filters:</span>
            {activeFilterPills.map((pill) => (
              <Badge
                key={pill.key}
                variant="secondary"
                className="gap-2 px-3 py-1 bg-[#00E0AA]/10 text-[#00E0AA] border border-[#00E0AA]/20 hover:bg-[#00E0AA]/20 cursor-pointer transition-colors"
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
      {filteredEvents.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredEvents.map((event) => (
            <Card
              key={event.event_id}
              className="group p-6 border-border/50 hover:border-[#00E0AA]/30 hover:shadow-lg hover:shadow-[#00E0AA]/5 transition-all duration-300 bg-card/50 backdrop-blur-sm"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge
                      variant="outline"
                      className={`${categoryColors[event.category] || 'bg-muted'} border`}
                    >
                      {event.category}
                    </Badge>
                    <Badge variant="outline" className="text-xs border-border/50">
                      <BarChart3 className="h-3 w-3 mr-1" />
                      {event.marketCount} markets
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-xs border ${getUrgencyColor(event.urgencyScore)}`}
                    >
                      <Zap className="h-3 w-3 mr-1" />
                      {event.urgencyScore}
                    </Badge>
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight mb-2 group-hover:text-[#00E0AA] transition-colors">
                    {event.title}
                  </h2>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {event.description}
                  </p>
                </div>
              </div>

              {/* Event Metrics */}
              <div className="grid grid-cols-3 gap-4 mb-6 p-4 rounded-lg bg-muted/30">
                <div className="text-center">
                  <div className="flex items-center justify-center mb-2">
                    <div className="p-2 rounded-lg bg-[#00E0AA]/10">
                      <DollarSign className="h-4 w-4 text-[#00E0AA]" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">Volume</p>
                  <p className="text-sm font-bold">${(event.totalVolume / 1000000).toFixed(1)}M</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center mb-2">
                    <div className="p-2 rounded-lg bg-[#00E0AA]/10">
                      <TrendingUp className="h-4 w-4 text-[#00E0AA]" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">Liquidity</p>
                  <p className="text-sm font-bold">${(event.totalLiquidity / 1000000).toFixed(1)}M</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center mb-2">
                    <div className="p-2 rounded-lg bg-amber-500/10">
                      <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">Closes</p>
                  <p className="text-sm font-bold">
                    {new Date(event.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
              </div>

              {/* View Event Button */}
              <Link href={`/events/${event.event_slug}`}>
                <Button className="w-full bg-[#00E0AA] hover:bg-[#00E0AA]/90 text-black font-medium group">
                  View Event Markets
                  <ChevronRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </Card>
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
            Showing <span className="font-semibold text-foreground">{filteredEvents.length}</span> of <span className="font-semibold text-foreground">{mockEvents.length}</span> events
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
  );
}
