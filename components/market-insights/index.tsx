"use client"

import { useState, useMemo, useEffect } from "react"
import { useMarketInsights } from "@/hooks/use-market-insights"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
// import { GlowBorder } from "@/components/ui/glow-border" // COMMENTED OUT
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { CategoryLeaderboard } from "@/components/category-leaderboard"
import { Separator } from "@/components/ui/separator"
import {
  Search,
  ChevronDown,
  ChevronUp,
  Clock,
  TrendingUp,
  TrendingDown,
  Calendar,
  BarChart3,
  Loader2,
  Filter
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTheme } from "next-themes"

interface Market {
  market_id: string
  title: string
  description: string
  category: string
  current_price: number
  volume_24h: number
  volume_total: number
  liquidity: number
  active: boolean
  closed: boolean
  end_date: string
  outcomes: string[]
  slug: string
  image_url?: string
  created_at: string
  updated_at: string
  event_id?: string
  event_slug?: string
  event_title?: string
  raw_data?: {
    event_id?: string
    event_title?: string
    event_slug?: string
    icon?: string
    [key: string]: any
  }
}

interface GroupedEvent {
  event_id: string
  event_title: string
  event_slug: string
  event_icon?: string
  markets: Market[]
  total_volume: number
  end_date: string
  category: string
}

type ViewMode = 'events' | 'markets'
type TimeRange = '1d' | '3d' | '7d' | '30d' | 'all'
type SortOption = 'volume' | 'end_date' | 'created_at'
type StatusFilter = 'active' | 'closed'

function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`
  } else if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`
  }
  return `$${value.toFixed(0)}`
}

function formatTimeRemaining(endDate: string): string {
  const now = new Date()
  const end = new Date(endDate)
  const diffMs = end.getTime() - now.getTime()

  if (diffMs < 0) return 'Ended'

  const diffHours = diffMs / (1000 * 60 * 60)
  const diffDays = diffHours / 24

  if (diffDays >= 1) {
    return `${Math.floor(diffDays)}d ${Math.floor(diffHours % 24)}h`
  }
  return `${Math.floor(diffHours)}h`
}

function EventCard({ event }: { event: GroupedEvent }) {
  const [isOpen, setIsOpen] = useState(true)
  const isClosed = new Date(event.end_date) < new Date()

  return (
    <Card className={cn("overflow-hidden", isClosed && "opacity-60 bg-muted/30")}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {event.event_icon && (
                <img
                  src={event.event_icon}
                  alt={event.event_title}
                  className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <Link
                    href={`/events/${event.event_slug}`}
                    className="hover:underline"
                  >
                    <CardTitle className="text-lg">{event.event_title}</CardTitle>
                  </Link>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="flex-shrink-0">
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <div className="flex flex-wrap gap-2 items-center text-sm text-muted-foreground">
                  <Badge variant="outline">{event.category}</Badge>
                  {isClosed && <Badge variant="secondary">Closed</Badge>}
                  <div className="flex items-center gap-1">
                    <BarChart3 className="h-3 w-3" />
                    <span>{formatCurrency(event.total_volume)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{formatTimeRemaining(event.end_date)}</span>
                  </div>
                  <span className="text-muted-foreground">
                    {event.markets.length} {event.markets.length === 1 ? 'market' : 'markets'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-2">
            <div className="border-t pt-4">
              <div className="space-y-2">
                {event.markets.map((market) => (
                  <MarketRow key={market.market_id} market={market} />
                ))}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function MarketRow({ market }: { market: Market }) {
  const priceChange = 0 // We don't have price change data yet
  const isPositive = priceChange >= 0
  const eventSlug = market.raw_data?.event_slug || market.slug
  const isClosed = new Date(market.end_date) < new Date()

  return (
    <Link
      href={`/events/${eventSlug}?market=${market.market_id}`}
      className="block"
    >
      <div className={cn(
        "p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors",
        isClosed && "opacity-60 bg-muted/20"
      )}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm mb-1 line-clamp-2">{market.title}</h4>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <span className="font-mono">{(market.current_price * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                <span>{formatCurrency(market.volume_24h)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{formatTimeRemaining(market.end_date)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className={cn(
              "text-sm font-medium flex items-center gap-1",
              isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
            )}>
              {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              <span>{isPositive ? '+' : ''}{priceChange.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function MarketCard({ market }: { market: Market }) {
  const priceChange = 0 // We don't have price change data yet
  const isPositive = priceChange >= 0
  const eventSlug = market.raw_data?.event_slug || market.slug
  const eventTitle = market.raw_data?.event_title || market.title
  const icon = market.raw_data?.icon || market.image_url
  const isClosed = new Date(market.end_date) < new Date()

  return (
    <Link
      href={`/events/${eventSlug}?market=${market.market_id}`}
      className="block"
    >
      <Card className={cn(
        "hover:bg-accent/50 transition-colors",
        isClosed && "opacity-60 bg-muted/30"
      )}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {icon && (
                <img
                  src={icon}
                  alt={market.title}
                  className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium mb-1 line-clamp-2">{market.title}</h3>
                <p className="text-sm text-muted-foreground line-clamp-1">{eventTitle}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Badge variant="outline">{market.category}</Badge>
            {isClosed && <Badge variant="secondary">Closed</Badge>}
            <div className="flex items-center gap-1 text-muted-foreground">
              <span className="font-mono">{(market.current_price * 100).toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <BarChart3 className="h-4 w-4" />
              <span>{formatCurrency(market.volume_24h)}</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>{formatTimeRemaining(market.end_date)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export function MarketInsights() {
  const { theme } = useTheme()
  const isDark = theme === "dark"
  const [viewMode, setViewMode] = useState<ViewMode>('events')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [sortBy, setSortBy] = useState<SortOption>('end_date')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50 // Show 50 items per page (client-side pagination)

  // Fetch more items from server to enable rich client-side filtering
  // This balances API calls vs filtering capability
  const serverLimit = 1000
  const serverOffset = 0  // Always fetch first 1000, cache handles freshness

  // Use cached hook with pagination
  const { markets, total: totalMarkets, isLoading, error: queryError, loadingProgress } = useMarketInsights({
    statusFilter,
    limit: serverLimit,
    offset: serverOffset
  })

  const loading = isLoading
  const error = queryError ? (queryError as Error).message : null

  // Get unique categories from markets
  const availableCategories = useMemo((): string[] => {
    const categories = new Set(markets.map((m: any) => m.category).filter(Boolean))
    return Array.from(categories).sort() as string[]
  }, [markets])

  // Filter markets by time range and category
  const filteredMarkets = useMemo(() => {
    const now = new Date()

    const filtered = markets.filter((market: any) => {
      // Skip markets with invalid end dates
      if (!market.end_date) return false

      const endDate = new Date(market.end_date)

      // Skip if date is invalid
      if (isNaN(endDate.getTime())) return false

      const diffMs = endDate.getTime() - now.getTime()
      const diffDays = diffMs / (1000 * 60 * 60 * 24)

      // Filter out uninitiated markets (price = 0.5 with low volume)
      // These are placeholder markets like "Person A", "Person B", etc.
      const isUninitiated = Math.abs(market.current_price - 0.5) < 0.01 && market.volume_total < 100
      if (isUninitiated) return false

      // Category filter
      if (selectedCategories.length > 0 && !selectedCategories.includes(market.category)) {
        return false
      }

      // For active markets, only show markets that haven't ended yet
      if (statusFilter === 'active' && diffMs < 0) return false

      // For closed markets, only show markets that have ended
      if (statusFilter === 'closed' && diffMs >= 0) return false

      // Time range filter - only apply to active markets (skip 'all')
      if (statusFilter === 'active' && timeRange !== 'all') {
        if (timeRange === '1d' && diffDays > 1) return false
        if (timeRange === '3d' && diffDays > 3) return false
        if (timeRange === '7d' && diffDays > 7) return false
        if (timeRange === '30d' && diffDays > 30) return false
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const eventTitle = market.raw_data?.event_title || market.title
        return (
          market.title.toLowerCase().includes(query) ||
          eventTitle.toLowerCase().includes(query) ||
          market.category.toLowerCase().includes(query)
        )
      }

      return true
    })

    return filtered
  }, [markets, timeRange, searchQuery, statusFilter, selectedCategories])

  // Group markets by event
  const groupedEvents = useMemo(() => {
    const eventMap = new Map<string, GroupedEvent>()

    filteredMarkets.forEach((market: any) => {
      // Use event_id from direct field first, then raw_data, fallback to market_id
      // Add prefix to prevent collision between event_id and market_id
      const rawEventId = market.event_id || market.raw_data?.event_id
      const eventId = rawEventId ? `event-${rawEventId}` : `market-${market.market_id}`
      const eventTitle = market.event_title || market.raw_data?.event_title || market.title
      const eventSlug = market.event_slug || market.raw_data?.event_slug || market.slug
      const eventIcon = market.raw_data?.icon || market.image_url

      if (!eventMap.has(eventId)) {
        eventMap.set(eventId, {
          event_id: eventId,
          event_title: eventTitle,
          event_slug: eventSlug,
          event_icon: eventIcon,
          markets: [],
          total_volume: 0,
          end_date: market.end_date,
          category: market.category,
        })
      }

      const event = eventMap.get(eventId)!
      event.markets.push(market)
      event.total_volume += market.volume_24h
    })

    return Array.from(eventMap.values())
  }, [filteredMarkets])

  // Sort events/markets
  const sortedData = useMemo(() => {
    if (viewMode === 'events') {
      return [...groupedEvents].sort((a, b) => {
        if (sortBy === 'volume') {
          return b.total_volume - a.total_volume
        } else if (sortBy === 'end_date') {
          return new Date(a.end_date).getTime() - new Date(b.end_date).getTime()
        }
        return 0
      })
    } else {
      return [...filteredMarkets].sort((a, b) => {
        if (sortBy === 'volume') {
          return b.volume_24h - a.volume_24h
        } else if (sortBy === 'end_date') {
          return new Date(a.end_date).getTime() - new Date(b.end_date).getTime()
        } else if (sortBy === 'created_at') {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        }
        return 0
      })
    }
  }, [viewMode, groupedEvents, filteredMarkets, sortBy])

  // Reset to page 1 when filters change (not statusFilter since that triggers refetch)
  useEffect(() => {
    setCurrentPage(1)
  }, [viewMode, timeRange, searchQuery, selectedCategories, sortBy])

  // Scroll to top when page changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [currentPage])

  // Pagination
  const totalItems = sortedData.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedData = sortedData.slice(startIndex, endIndex)

  return (
    // <GlowBorder color="purple" intensity="subtle" speed="slow">
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      {/* Header */}
      <div className="px-6 pt-5 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Market Insights</h1>
        <p className="text-sm text-muted-foreground">
          Discover markets and events ending soon with advanced filtering
        </p>
      </div>

      {/* Filters Section */}
      <div className="px-6 py-4 border-t border-border/50 space-y-4">
          {/* View Mode & Time Range */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center flex-wrap">
              {/* View Mode Toggle */}
              <ToggleGroup
                type="single"
                value={viewMode}
                onValueChange={(value) => value && setViewMode(value as ViewMode)}
                className="border rounded-lg p-1"
              >
                <ToggleGroupItem value="events" className="px-4">
                  <Calendar className="h-4 w-4 mr-2" />
                  Events
                </ToggleGroupItem>
                <ToggleGroupItem value="markets" className="px-4">
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Markets
                </ToggleGroupItem>
              </ToggleGroup>

              {/* Status Filter */}
              <ToggleGroup
                type="single"
                value={statusFilter}
                onValueChange={(value) => value && setStatusFilter(value as StatusFilter)}
                className="border rounded-lg p-1"
              >
                <ToggleGroupItem value="active" className="px-4">
                  Active
                </ToggleGroupItem>
                <ToggleGroupItem value="closed" className="px-4">
                  Closed
                </ToggleGroupItem>
              </ToggleGroup>

              {/* Time Range Filter - Only show for active markets */}
              {statusFilter === 'active' && (
                <ToggleGroup
                  type="single"
                  value={timeRange}
                  onValueChange={(value) => value && setTimeRange(value as TimeRange)}
                  className="border rounded-lg p-1"
                >
                  <ToggleGroupItem value="1d">1d</ToggleGroupItem>
                  <ToggleGroupItem value="3d">3d</ToggleGroupItem>
                  <ToggleGroupItem value="7d">7d</ToggleGroupItem>
                  <ToggleGroupItem value="30d">30d</ToggleGroupItem>
                  <ToggleGroupItem value="all">All</ToggleGroupItem>
                </ToggleGroup>
              )}
            </div>

            {/* Sort */}
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="end_date">Ending Soonest</SelectItem>
                <SelectItem value="volume">Highest Volume</SelectItem>
                <SelectItem value="created_at">Recently Created</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search markets and events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Category Filters */}
          {availableCategories.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Categories</span>
                {selectedCategories.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedCategories([])}
                    className="h-6 px-2 text-xs"
                  >
                    Clear
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {availableCategories.map((category: string) => {
                  const isSelected = selectedCategories.includes(category)
                  return (
                    <Badge
                      key={category}
                      variant={isSelected ? "default" : "outline"}
                      className={cn(
                        "cursor-pointer transition-colors",
                        isSelected && "bg-[#00E0AA] hover:bg-[#00E0AA]/90"
                      )}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedCategories(selectedCategories.filter(c => c !== category))
                        } else {
                          setSelectedCategories([...selectedCategories, category])
                        }
                      }}
                    >
                      {category}
                    </Badge>
                  )
                })}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>
              Showing {startIndex + 1}-{Math.min(endIndex, totalItems)} of {totalItems}{' '}
              {viewMode === 'events' ? 'events' : 'markets'}
            </span>
            {viewMode === 'events' && (
              <span>
                ({filteredMarkets.length} total markets)
              </span>
            )}
            {loading && loadingProgress.total > 0 && (
              <span className="text-[#00E0AA]">
                • Loading {loadingProgress.current}/{loadingProgress.total} from database
              </span>
            )}
          </div>
        </div>

      {/* Loading State with Skeleton */}
      {loading && (
        <div className="px-6 pb-6 space-y-4">
          {/* Event cards skeleton */}
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <Skeleton className="h-6 w-3/4" />
                        <Skeleton className="h-8 w-8" />
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <Skeleton className="h-5 w-20 rounded-full" />
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-14" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="border-t pt-4">
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, j) => (
                      <div key={j} className="p-3 rounded-lg border bg-card">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <Skeleton className="h-4 w-full mb-2" />
                            <div className="flex flex-wrap gap-3">
                              <Skeleton className="h-3 w-12" />
                              <Skeleton className="h-3 w-16" />
                              <Skeleton className="h-3 w-14" />
                            </div>
                          </div>
                          <Skeleton className="h-5 w-16" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="px-6 py-6">
          <p className="text-destructive">{error}</p>
        </div>
      )}

      {/* Results */}
      {!loading && !error && (
        <div className="px-6 pb-6 space-y-4">
          {viewMode === 'events' ? (
            // Events View with Collapsible Markets
            paginatedData.length > 0 ? (
              (paginatedData as GroupedEvent[]).map((event) => (
                <EventCard key={event.event_id} event={event} />
              ))
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  No events found matching your filters
                </CardContent>
              </Card>
            )
          ) : (
            // Markets View (Flat List)
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(paginatedData as Market[]).length > 0 ? (
                (paginatedData as Market[]).map((market) => (
                  <MarketCard key={market.market_id} market={market} />
                ))
              ) : (
                <Card className="sm:col-span-2 lg:col-span-3">
                  <CardContent className="pt-6 text-center text-muted-foreground">
                    No markets found matching your filters
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="rounded-xl border border-border/50 p-6 shadow-none" >
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <Button
                    variant="outline"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>

                  <div className="flex items-center gap-2">
                    {/* Generate unique page numbers to display */}
                    {(() => {
                      const pagesToShow = new Set<number>()

                      // Always show first page if not near it
                      if (currentPage > 3) {
                        pagesToShow.add(1)
                      }

                      // Show pages around current page
                      for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
                        pagesToShow.add(i)
                      }

                      // Always show last page if not near it
                      if (currentPage < totalPages - 2) {
                        pagesToShow.add(totalPages)
                      }

                      const sortedPages = Array.from(pagesToShow).sort((a, b) => a - b)
                      const elements: React.ReactNode[] = []

                      sortedPages.forEach((page, index) => {
                        // Add ellipsis if there's a gap
                        if (index > 0 && page - sortedPages[index - 1] > 1) {
                          elements.push(
                            <span key={`ellipsis-${page}`} className="text-muted-foreground">...</span>
                          )
                        }

                        // Add page button
                        elements.push(
                          <Button
                            key={`page-${page}`}
                            variant={currentPage === page ? "default" : "outline"}
                            size="sm"
                            onClick={() => setCurrentPage(page)}
                            className={currentPage === page ? "bg-[#00E0AA] hover:bg-[#00E0AA]/90" : ""}
                          >
                            {page}
                          </Button>
                        )
                      })

                      return elements
                    })()}
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
            </div>
          )}
        </div>
      )}
    </Card>
    // </GlowBorder>
  )
}
