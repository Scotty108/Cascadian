"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Search, TrendingUp, Clock, DollarSign, ChevronRight, Filter, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

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
  const now = new Date();
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Filter and sort events
  const filteredEvents = mockEvents
    .filter((event) => {
      const matchesSearch = event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           event.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === "all" || event.category === categoryFilter;

      // Time filter
      const eventEndDate = new Date(event.endDate);
      let matchesTime = true;
      if (timeFilter === "24h") matchesTime = eventEndDate <= in24Hours;
      else if (timeFilter === "7d") matchesTime = eventEndDate <= in7Days;
      else if (timeFilter === "30d") matchesTime = eventEndDate <= in30Days;

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

  // Count active filters
  const activeFiltersCount =
    (categoryFilter !== "all" ? 1 : 0) +
    (timeFilter !== "all" ? 1 : 0) +
    (minLiquidity > 0 || maxLiquidity < 15 ? 1 : 0) +
    (minVolume > 0 || maxVolume < 150 ? 1 : 0) +
    (minMarkets > 0 ? 1 : 0);

  const resetFilters = () => {
    setCategoryFilter("all");
    setTimeFilter("all");
    setMinLiquidity(0);
    setMaxLiquidity(15);
    setMinVolume(0);
    setMaxVolume(150);
    setMinMarkets(0);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Events</h1>
        <p className="text-muted-foreground">
          Browse prediction markets grouped by major events
        </p>
      </div>

      {/* Main Filters Bar */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-full md:w-[200px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="urgency">Urgency</SelectItem>
              <SelectItem value="volume">Volume</SelectItem>
              <SelectItem value="liquidity">Liquidity</SelectItem>
              <SelectItem value="markets">Market Count</SelectItem>
              <SelectItem value="ending">Ending Soonest</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={showFilters ? "default" : "outline"}
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFiltersCount > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0.5">
                {activeFiltersCount}
              </Badge>
            )}
          </Button>
        </div>

        {/* Advanced Filters Panel */}
        {showFilters && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Advanced Filters</h3>
              {activeFiltersCount > 0 && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-2">
                  <X className="h-4 w-4" />
                  Clear All
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Category Filter */}
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger>
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
                <Label>Ending Time</Label>
                <Select value={timeFilter} onValueChange={setTimeFilter}>
                  <SelectTrigger>
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
                <Label>Minimum Markets</Label>
                <Input
                  type="number"
                  min="0"
                  value={minMarkets}
                  onChange={(e) => setMinMarkets(Number(e.target.value))}
                  placeholder="0"
                />
              </div>

              {/* Liquidity Range */}
              <div className="space-y-2">
                <Label>Liquidity Range (${minLiquidity}M - ${maxLiquidity}M)</Label>
                <div className="pt-2">
                  <Slider
                    min={0}
                    max={15}
                    step={0.5}
                    value={[minLiquidity, maxLiquidity]}
                    onValueChange={([min, max]) => {
                      setMinLiquidity(min);
                      setMaxLiquidity(max);
                    }}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Volume Range */}
              <div className="space-y-2">
                <Label>Volume Range (${minVolume}M - ${maxVolume}M)</Label>
                <div className="pt-2">
                  <Slider
                    min={0}
                    max={150}
                    step={5}
                    value={[minVolume, maxVolume]}
                    onValueChange={([min, max]) => {
                      setMinVolume(min);
                      setMaxVolume(max);
                    }}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Events Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredEvents.map((event) => (
          <Card key={event.event_id} className="p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Badge>{event.category}</Badge>
                  <Badge variant="outline" className="text-xs">
                    {event.marketCount} markets
                  </Badge>
                </div>
                <h2 className="text-xl font-semibold mb-2">{event.title}</h2>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {event.description}
                </p>
              </div>
            </div>

            {/* Event Metrics */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <DollarSign className="h-4 w-4 mx-auto mb-1 text-green-600" />
                <p className="text-xs text-muted-foreground">Volume</p>
                <p className="text-sm font-bold">${(event.totalVolume / 1000000).toFixed(1)}M</p>
              </div>
              <div className="text-center">
                <TrendingUp className="h-4 w-4 mx-auto mb-1 text-blue-600" />
                <div className="text-xs text-muted-foreground">Urgency</div>
                <div className="text-sm font-bold">{event.urgencyScore}</div>
              </div>
              <div className="text-center">
                <Clock className="h-4 w-4 mx-auto mb-1 text-amber-600" />
                <p className="text-xs text-muted-foreground">Closes</p>
                <p className="text-sm font-bold">
                  {new Date(event.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
            </div>

            {/* View Event Button */}
            <Link href={`/events/${event.event_slug}`}>
              <Button className="w-full" variant="outline">
                View Event Markets
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </Card>
        ))}
      </div>

      {filteredEvents.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No events found matching your criteria</p>
        </div>
      )}

      {/* Results Info */}
      <div className="text-sm text-muted-foreground text-center">
        Showing {filteredEvents.length} of {mockEvents.length} events
      </div>
    </div>
  );
}
