"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useMarketInsights } from "@/hooks/use-market-insights"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Search,
  ChevronDown,
  ChevronUp,
  Clock,
  BarChart3,
  Loader2,
  TrendingUp,
  Flame,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

// Category configuration - subcategories are derived from tags dynamically
const CATEGORY_CONFIG = {
  trending: {
    label: 'Trending',
    icon: TrendingUp,
    sortBy: 'volume_24h',
    category: null,
  },
  new: {
    label: 'New',
    icon: Sparkles,
    sortBy: 'created_at',
    category: null,
  },
  politics: {
    label: 'Politics',
    icon: null,
    category: 'Politics',
  },
  sports: {
    label: 'Sports',
    icon: null,
    category: 'Sports',
  },
  crypto: {
    label: 'Crypto',
    icon: null,
    category: 'Crypto',
  },
  finance: {
    label: 'Finance',
    icon: null,
    category: 'Finance',
  },
  tech: {
    label: 'Tech',
    icon: null,
    category: 'Tech',
  },
  world: {
    label: 'World',
    icon: null,
    category: 'World',
  },
  economy: {
    label: 'Economy',
    icon: null,
    category: 'Economy',
  },
  culture: {
    label: 'Culture',
    icon: null,
    category: 'Culture',
  },
} as const

type CategoryKey = keyof typeof CATEGORY_CONFIG

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
  tags?: string[]
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

function formatProbability(price: number): { value: string; outcome: string } {
  const yesPct = price * 100
  const noPct = 100 - yesPct

  // Show the dominant outcome (whichever is higher)
  if (yesPct >= 50) {
    // Yes is dominant
    if (yesPct > 99 && yesPct < 100) return { value: '>99', outcome: 'yes' }
    return { value: yesPct.toFixed(0), outcome: 'yes' }
  } else {
    // No is dominant
    if (noPct > 99 && noPct < 100) return { value: '>99', outcome: 'no' }
    return { value: noPct.toFixed(0), outcome: 'no' }
  }
}

function EventCard({ event }: { event: GroupedEvent }) {
  const [isOpen, setIsOpen] = useState(false)
  const isClosed = new Date(event.end_date) < new Date()
  const isSingleMarket = event.markets.length === 1
  const singleMarket = isSingleMarket ? event.markets[0] : null

  const yesPrice = singleMarket?.current_price ?? 0.5

  // Single binary market - compact card
  if (isSingleMarket && singleMarket) {
    const prob = formatProbability(yesPrice)
    return (
      <Link href={`/events/${event.event_slug}`} className="block h-full">
        <Card className={cn(
          "overflow-hidden hover:bg-accent/50 transition-colors h-full flex flex-col",
          isClosed && "opacity-60 bg-muted/30"
        )}>
          <CardContent className="p-4 flex-1 flex flex-col">
            <div className="flex items-start gap-3 flex-1">
              {event.event_icon && (
                <img
                  src={event.event_icon}
                  alt={event.event_title}
                  className="w-10 h-10 rounded-lg flex-shrink-0 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm line-clamp-2 mb-2">{singleMarket.title}</h3>

                {/* Probability */}
                <div className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 rounded-md mb-2",
                  prob.outcome === 'yes' ? "bg-emerald-500/15" : "bg-red-500/15"
                )}>
                  <span className={cn(
                    "text-base font-semibold tabular-nums",
                    prob.outcome === 'yes' ? "text-emerald-500" : "text-red-500"
                  )}>{prob.value}%</span>
                  <span className={cn(
                    "text-[10px] uppercase tracking-wide",
                    prob.outcome === 'yes' ? "text-emerald-500/70" : "text-red-500/70"
                  )}>{prob.outcome}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-auto pt-2">
              <span className="flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                {formatCurrency(event.total_volume)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatTimeRemaining(event.end_date)}
              </span>
              {isClosed && <Badge variant="secondary" className="text-xs">Closed</Badge>}
            </div>
          </CardContent>
        </Card>
      </Link>
    )
  }

  // Multi-market event - collapsible
  return (
    <Card className={cn("overflow-hidden h-full", isClosed && "opacity-60 bg-muted/30")}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            {event.event_icon && (
              <img
                src={event.event_icon}
                alt={event.event_title}
                className="w-10 h-10 rounded-lg flex-shrink-0 object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-2">
                <Link
                  href={`/events/${event.event_slug}`}
                  className="hover:underline flex-1"
                >
                  <CardTitle className="text-sm font-medium line-clamp-2">{event.event_title}</CardTitle>
                </Link>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex-shrink-0 h-7 w-7 p-0">
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
              </div>
              <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
                {isClosed && <Badge variant="secondary" className="text-xs">Closed</Badge>}
                <div className="flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" />
                  <span>{formatCurrency(event.total_volume)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>{formatTimeRemaining(event.end_date)}</span>
                </div>
                <span className="font-medium text-foreground">
                  {event.markets.length} markets
                </span>
              </div>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="border-t pt-3 space-y-2">
              {event.markets.slice(0, 5).map((market) => (
                <MarketRow key={market.market_id} market={market} />
              ))}
              {event.markets.length > 5 && (
                <Link
                  href={`/events/${event.event_slug}`}
                  className="block text-center text-sm text-muted-foreground hover:text-foreground py-2"
                >
                  +{event.markets.length - 5} more markets →
                </Link>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function MarketRow({ market }: { market: Market }) {
  const eventSlug = market.raw_data?.event_slug || market.slug
  const isClosed = new Date(market.end_date) < new Date()
  const prob = formatProbability(market.current_price)

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
                <BarChart3 className="h-3 w-3" />
                <span>{formatCurrency(market.volume_total || market.volume_24h)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{formatTimeRemaining(market.end_date)}</span>
              </div>
            </div>
          </div>
          {/* Probability */}
          <div className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-md flex-shrink-0",
            prob.outcome === 'yes' ? "bg-emerald-500/15" : "bg-red-500/15"
          )}>
            <span className={cn(
              "text-sm font-semibold tabular-nums",
              prob.outcome === 'yes' ? "text-emerald-500" : "text-red-500"
            )}>{prob.value}%</span>
            <span className={cn(
              "text-[9px] uppercase",
              prob.outcome === 'yes' ? "text-emerald-500/70" : "text-red-500/70"
            )}>{prob.outcome}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function MarketCard({ market }: { market: Market }) {
  const eventSlug = market.raw_data?.event_slug || market.event_slug || market.slug
  const isClosed = new Date(market.end_date) < new Date()
  const prob = formatProbability(market.current_price)

  return (
    <Link href={`/events/${eventSlug}?market=${market.market_id}`} className="block h-full">
      <Card className={cn(
        "overflow-hidden hover:bg-accent/50 transition-colors h-full flex flex-col",
        isClosed && "opacity-60 bg-muted/30"
      )}>
        <CardContent className="p-4 flex-1 flex flex-col">
          <div className="flex items-start gap-3 flex-1">
            {market.image_url && (
              <img
                src={market.image_url}
                alt={market.title}
                className="w-10 h-10 rounded-lg flex-shrink-0 object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm line-clamp-2 mb-2">{market.title}</h3>

              {/* Probability */}
              <div className={cn(
                "inline-flex items-center gap-1.5 px-2 py-1 rounded-md mb-2",
                prob.outcome === 'yes' ? "bg-emerald-500/15" : "bg-red-500/15"
              )}>
                <span className={cn(
                  "text-base font-semibold tabular-nums",
                  prob.outcome === 'yes' ? "text-emerald-500" : "text-red-500"
                )}>{prob.value}%</span>
                <span className={cn(
                  "text-[10px] uppercase tracking-wide",
                  prob.outcome === 'yes' ? "text-emerald-500/70" : "text-red-500/70"
                )}>{prob.outcome}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-auto pt-2">
            <span className="flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              {formatCurrency(market.volume_total || market.volume_24h)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTimeRemaining(market.end_date)}
            </span>
            {market.category && (
              <Badge variant="outline" className="text-xs">{market.category}</Badge>
            )}
            {isClosed && <Badge variant="secondary" className="text-xs">Closed</Badge>}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export function MarketInsights() {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('trending')
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('All')
  const [viewMode, setViewMode] = useState<'events' | 'markets'>('events')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const itemsPerPage = 51 // 51 for 3-column grid (17 rows)

  const categoryConfig = CATEGORY_CONFIG[selectedCategory]

  // Fetch data from API
  const { markets, total: totalMarkets, isLoading, error: queryError, loadingProgress } = useMarketInsights({
    statusFilter,
    limit: 1000,
    offset: 0
  })

  const loading = isLoading
  const error = queryError ? (queryError as Error).message : null

  // Extract unique tags for the selected category (for subcategory buttons)
  const categoryTags = useMemo(() => {
    if (!categoryConfig.category) return [] // No tags for trending/new

    // Get markets in this category
    const categoryMarkets = markets.filter((m: any) => m.category === categoryConfig.category)

    // Count tag occurrences
    const tagCounts = new Map<string, number>()
    categoryMarkets.forEach((market: any) => {
      const tags = market.tags || []
      tags.forEach((tag: string) => {
        // Skip the category name itself as a tag
        if (tag.toLowerCase() !== categoryConfig.category?.toLowerCase()) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
        }
      })
    })

    // Sort by count and take top 15
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([tag]) => tag)
  }, [markets, categoryConfig.category])

  // Check scroll buttons visibility
  const updateScrollButtons = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current
      setCanScrollLeft(scrollLeft > 0)
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10)
    }
  }

  useEffect(() => {
    updateScrollButtons()
    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener('scroll', updateScrollButtons)
      window.addEventListener('resize', updateScrollButtons)
      return () => {
        container.removeEventListener('scroll', updateScrollButtons)
        window.removeEventListener('resize', updateScrollButtons)
      }
    }
  }, [])

  const scrollCategories = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 200
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  // Filter markets based on category, subcategory, and search
  const filteredMarkets = useMemo(() => {
    const now = new Date()

    return markets.filter((market: any) => {
      if (!market.end_date) return false

      const endDate = new Date(market.end_date)
      if (isNaN(endDate.getTime())) return false

      const diffMs = endDate.getTime() - now.getTime()

      // Filter out uninitiated markets
      const isUninitiated = Math.abs(market.current_price - 0.5) < 0.01 && market.volume_total < 100
      if (isUninitiated) return false

      // Status filter
      if (statusFilter === 'active' && diffMs < 0) return false
      if (statusFilter === 'closed' && diffMs >= 0) return false

      // Category filter (not for trending/new which show all)
      if ('category' in categoryConfig && categoryConfig.category) {
        if (market.category !== categoryConfig.category) return false
      }

      // Subcategory filter (tag-based)
      if (selectedSubcategory && selectedSubcategory !== 'All') {
        const marketTags = market.tags || []
        if (!marketTags.includes(selectedSubcategory)) return false
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
  }, [markets, statusFilter, selectedCategory, selectedSubcategory, searchQuery, categoryConfig])

  // Group markets by event
  const groupedEvents = useMemo(() => {
    const eventMap = new Map<string, GroupedEvent>()

    filteredMarkets.forEach((market: any) => {
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

  // Sort events
  const sortedEvents = useMemo(() => {
    return [...groupedEvents].sort((a, b) => {
      if (selectedCategory === 'new') {
        // Sort by most recent market creation
        const aNewest = Math.max(...a.markets.map(m => new Date(m.created_at).getTime()))
        const bNewest = Math.max(...b.markets.map(m => new Date(m.created_at).getTime()))
        return bNewest - aNewest
      }
      // Default: sort by volume
      return b.total_volume - a.total_volume
    })
  }, [groupedEvents, selectedCategory])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [selectedCategory, selectedSubcategory, statusFilter, searchQuery, viewMode])

  // Reset subcategory when category changes
  useEffect(() => {
    setSelectedSubcategory('All')
  }, [selectedCategory])

  // Scroll to top when page changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [currentPage])

  // Sort markets for markets view
  const sortedMarkets = useMemo(() => {
    return [...filteredMarkets].sort((a: Market, b: Market) => {
      if (selectedCategory === 'new') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      // Default: sort by 24h volume
      return (b.volume_24h || 0) - (a.volume_24h || 0)
    })
  }, [filteredMarkets, selectedCategory])

  // Pagination - handle both views
  const totalItems = viewMode === 'events' ? sortedEvents.length : sortedMarkets.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedEvents = sortedEvents.slice(startIndex, endIndex)
  const paginatedMarkets = sortedMarkets.slice(startIndex, endIndex)

  return (
    <div className="space-y-4">
      {/* Category Tabs & Controls */}
      <Card className="shadow-sm rounded-2xl border">
        <div className="p-4 space-y-4">
          {/* Top Row: Category tabs on left, Active/Closed + count on right */}
          <div className="flex items-center justify-between gap-4">
            {/* Scrollable Category Tabs */}
            <div className="relative flex-1 min-w-0">
              {/* Left scroll button */}
              {canScrollLeft && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 bg-background/80 backdrop-blur-sm shadow-sm"
                  onClick={() => scrollCategories('left')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}

              {/* Category tabs */}
              <div
                ref={scrollContainerRef}
                className="flex gap-1 overflow-x-auto scrollbar-hide px-1"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {(Object.keys(CATEGORY_CONFIG) as CategoryKey[]).map((key) => {
                  const config = CATEGORY_CONFIG[key]
                  const Icon = config.icon
                  const isSelected = selectedCategory === key

                  return (
                    <Button
                      key={key}
                      variant={isSelected ? "default" : "ghost"}
                      size="sm"
                      className={cn(
                        "flex-shrink-0 gap-1.5",
                        isSelected && "bg-primary text-primary-foreground"
                      )}
                      onClick={() => setSelectedCategory(key)}
                    >
                      {Icon && <Icon className="h-4 w-4" />}
                      {config.label}
                    </Button>
                  )
                })}
              </div>

              {/* Right scroll button */}
              {canScrollRight && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 bg-background/80 backdrop-blur-sm shadow-sm"
                  onClick={() => scrollCategories('right')}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Right side: Search + View toggle + Status toggle + count */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Search */}
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search markets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-9"
                />
              </div>

              {/* View Mode Toggle */}
              <ToggleGroup
                type="single"
                value={viewMode}
                onValueChange={(value) => value && setViewMode(value as 'events' | 'markets')}
                className="border rounded-lg p-1"
              >
                <ToggleGroupItem value="events" className="px-3 text-sm">
                  Events
                </ToggleGroupItem>
                <ToggleGroupItem value="markets" className="px-3 text-sm">
                  Markets
                </ToggleGroupItem>
              </ToggleGroup>

              {/* Status Toggle */}
              <ToggleGroup
                type="single"
                value={statusFilter}
                onValueChange={(value) => value && setStatusFilter(value as StatusFilter)}
                className="border rounded-lg p-1"
              >
                <ToggleGroupItem value="active" className="px-3 text-sm">
                  Active
                </ToggleGroupItem>
                <ToggleGroupItem value="closed" className="px-3 text-sm">
                  Closed
                </ToggleGroupItem>
              </ToggleGroup>

              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {viewMode === 'events' ? totalItems : filteredMarkets.length} {viewMode}
                {loading && (
                  <Loader2 className="h-3 w-3 animate-spin inline ml-2" />
                )}
              </span>
            </div>
          </div>

          {/* Second Row: Tag buttons */}
          {categoryTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant={selectedSubcategory === 'All' ? "default" : "outline"}
                className={cn(
                  "h-9 px-5 text-sm font-medium",
                  selectedSubcategory === 'All' && "bg-primary text-primary-foreground"
                )}
                onClick={() => setSelectedSubcategory('All')}
              >
                All
              </Button>
              {categoryTags.map((tag) => (
                <Button
                  key={tag}
                  variant={selectedSubcategory === tag ? "default" : "outline"}
                  className={cn(
                    "h-9 px-5 text-sm font-medium",
                    selectedSubcategory === tag && "bg-primary text-primary-foreground"
                  )}
                  onClick={() => setSelectedSubcategory(tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-6 w-16 rounded-md" />
                    <div className="flex gap-3">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <Card>
          <CardContent className="py-6">
            <p className="text-destructive text-center">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Results - 3 Column Grid */}
      {!loading && !error && (
        <>
          {viewMode === 'events' ? (
            // Events View
            paginatedEvents.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {paginatedEvents.map((event) => (
                  <EventCard key={event.event_id} event={event} />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No events found matching your filters
                </CardContent>
              </Card>
            )
          ) : (
            // Markets View
            paginatedMarkets.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {paginatedMarkets.map((market: Market) => (
                  <MarketCard key={market.market_id} market={market} />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No markets found matching your filters
                </CardContent>
              </Card>
            )
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <Card className="shadow-sm rounded-2xl border">
              <div className="p-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <Button
                    variant="outline"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>

                  <div className="flex items-center gap-2">
                    {(() => {
                      const pagesToShow = new Set<number>()

                      if (currentPage > 3) {
                        pagesToShow.add(1)
                      }

                      for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
                        pagesToShow.add(i)
                      }

                      if (currentPage < totalPages - 2) {
                        pagesToShow.add(totalPages)
                      }

                      const sortedPages = Array.from(pagesToShow).sort((a, b) => a - b)
                      const elements: React.ReactNode[] = []

                      sortedPages.forEach((page, index) => {
                        if (index > 0 && page - sortedPages[index - 1] > 1) {
                          elements.push(
                            <span key={`ellipsis-${page}`} className="text-muted-foreground">...</span>
                          )
                        }

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
            </Card>
          )}
        </>
      )}
    </div>
  )
}
