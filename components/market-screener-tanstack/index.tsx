"use client"

import { useMemo, useRef, useState, useCallback, useEffect } from "react"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import ReactEChartsCore from "echarts-for-react/lib/core"
import * as echarts from "echarts/core"
import { LineChart } from "echarts/charts"
import { GridComponent } from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"
import { ArrowUpDown, Star, ChevronDown, Settings2, ArrowUp, ArrowDown, SlidersHorizontal, X, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePolymarketMarkets } from "@/hooks/use-polymarket-markets"

// Register required ECharts components
echarts.use([LineChart, GridComponent, CanvasRenderer])

interface Market {
  market_id: string
  title: string
  outcome: string
  last_price: number
  price_delta: number
  volume_24h: number
  trades_24h: number
  buyers_24h: number
  sellers_24h: number
  buy_sell_ratio: number
  whale_buy_sell_ratio: number
  whale_pressure: number
  smart_buy_sell_ratio: number
  smart_pressure: number
  momentum: number
  category: string
  sii: number
  volumeHistory?: number[]
}

interface MarketScreenerTanStackProps {
  markets?: Market[]
}

type TimeWindow = '24h' | '12h' | '6h' | '1h' | '10m';

interface FilterState {
  categories: string[];
  outcomes: string[];
  priceRange: [number, number];
  volumeRange: [number, number];
  siiRange: [number, number];
  momentumRange: [number, number];
  ratioRange: [number, number];
}

// HSL-based heatmap color scaling optimized for both light and dark mode
function getHeatmapColor(value: number, min: number, max: number, isPositive: boolean = true): string {
  const normalized = max > min ? (value - min) / (max - min) : 0
  const intensity = Math.min(normalized * 100, 100)

  if (isPositive) {
    // Green heatmap using brand color #00E0AA
    // Using opacity-based approach that works in both light and dark mode
    const opacity = 0.08 + (intensity * 0.004) // 0.08 to 0.48
    return `rgba(0, 224, 170, ${opacity})`
  } else {
    // Red heatmap
    const opacity = 0.08 + (intensity * 0.004)
    return `rgba(239, 68, 68, ${opacity})` // Red-500
  }
}

export function MarketScreenerTanStack({ markets: propMarkets = [] }: MarketScreenerTanStackProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "volume_24h", desc: true }])
  const [columnVisibility, setColumnVisibility] = useState({})
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('24h')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50) // 50 markets per page
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    outcomes: [],
    priceRange: [0, 1],
    volumeRange: [0, 500000],
    siiRange: [0, 100],
    momentumRange: [-200, 200], // Real momentum scores can be higher
    ratioRange: [0, 10], // Real buy/sell ratios can be higher (4-5 is common)
  })

  // Track price changes for flash animation
  const [changedMarkets, setChangedMarkets] = useState<Set<string>>(new Set())
  const previousMarketsRef = useRef<Map<string, { price: number; delta: number }>>(new Map())

  // Calculate offset for pagination
  const offset = (page - 1) * pageSize

  // Fetch real Polymarket data with pagination
  const { data, isLoading, error, isFetching } = usePolymarketMarkets({
    limit: pageSize,
    offset: offset
  })

  // Use real data if available, otherwise fallback to props
  const sourceMarkets = data?.markets || propMarkets
  const totalMarkets = data?.total || (propMarkets.length > 0 ? 500 : 0)
  const totalPages = Math.ceil(totalMarkets / pageSize)

  const displayMarkets = useMemo(() => {
    // Apply filters
    return sourceMarkets.filter(market => {
      // Category filter
      if (filters.categories.length > 0 && !filters.categories.includes(market.category)) {
        return false
      }

      // Outcome filter
      if (filters.outcomes.length > 0 && !filters.outcomes.includes(market.outcome)) {
        return false
      }

      // Price range filter
      if (market.last_price < filters.priceRange[0] || market.last_price > filters.priceRange[1]) {
        return false
      }

      // Volume range filter
      if (market.volume_24h < filters.volumeRange[0] || market.volume_24h > filters.volumeRange[1]) {
        return false
      }

      // SII range filter
      if (market.sii < filters.siiRange[0] || market.sii > filters.siiRange[1]) {
        return false
      }

      // Momentum range filter
      if (market.momentum < filters.momentumRange[0] || market.momentum > filters.momentumRange[1]) {
        return false
      }

      // Ratio range filter
      if (market.buy_sell_ratio < filters.ratioRange[0] || market.buy_sell_ratio > filters.ratioRange[1]) {
        return false
      }

      return true
    })
  }, [sourceMarkets, filters])

  const categories = useMemo(() => {
    const cats = new Set(sourceMarkets.map(m => m.category))
    return Array.from(cats).sort()
  }, [sourceMarkets])

  // Detect price changes for flash animation
  useEffect(() => {
    if (!sourceMarkets || sourceMarkets.length === 0) return

    const newChangedMarkets = new Set<string>()

    sourceMarkets.forEach(market => {
      const previous = previousMarketsRef.current.get(market.market_id)

      if (previous) {
        // Check if price or delta changed
        if (
          previous.price !== market.last_price ||
          previous.delta !== market.price_delta
        ) {
          newChangedMarkets.add(market.market_id)
        }
      }

      // Update previous values
      previousMarketsRef.current.set(market.market_id, {
        price: market.last_price,
        delta: market.price_delta,
      })
    })

    if (newChangedMarkets.size > 0) {
      setChangedMarkets(newChangedMarkets)

      // Clear animations after 2 seconds
      const timer = setTimeout(() => {
        setChangedMarkets(new Set())
      }, 2000)

      return () => clearTimeout(timer)
    }
  }, [sourceMarkets])

  // Calculate min/max for heatmap scaling
  const valueRanges = useMemo(() => {
    if (displayMarkets.length === 0) {
      return {
        sii: { min: 0, max: 100 },
        momentum: { min: -50, max: 50 },
        price_delta: { min: -30, max: 30 },
        volume_24h: { min: 0, max: 500000 },
        trades_24h: { min: 0, max: 5000 },
        buyers_24h: { min: 0, max: 2000 },
        sellers_24h: { min: 0, max: 2000 },
        buy_sell_ratio: { min: 0.5, max: 2.5 },
        whale_pressure: { min: -200000, max: 200000 },
        smart_pressure: { min: -150000, max: 150000 },
      }
    }

    return {
      sii: { min: 0, max: 100 },
      momentum: { min: -50, max: 50 },
      price_delta: { min: Math.min(...displayMarkets.map(m => m.price_delta)), max: Math.max(...displayMarkets.map(m => m.price_delta)) },
      volume_24h: { min: 0, max: Math.max(...displayMarkets.map(m => m.volume_24h)) },
      trades_24h: { min: 0, max: Math.max(...displayMarkets.map(m => m.trades_24h)) },
      buyers_24h: { min: 0, max: Math.max(...displayMarkets.map(m => m.buyers_24h)) },
      sellers_24h: { min: 0, max: Math.max(...displayMarkets.map(m => m.sellers_24h)) },
      buy_sell_ratio: { min: 0.5, max: 2.5 },
      whale_pressure: { min: Math.min(...displayMarkets.map(m => m.whale_pressure)), max: Math.max(...displayMarkets.map(m => m.whale_pressure)) },
      smart_pressure: { min: Math.min(...displayMarkets.map(m => m.smart_pressure)), max: Math.max(...displayMarkets.map(m => m.smart_pressure)) },
    }
  }, [displayMarkets])

  const columns = useMemo<ColumnDef<Market>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Market",
        cell: ({ row }) => (
          <Link
            href={`/analysis/market/${row.original.market_id}`}
            className="block text-xs font-medium leading-tight hover:text-[#00E0AA] transition-colors overflow-hidden text-ellipsis"
            style={{ maxWidth: '280px' }}
          >
            {row.original.title}
          </Link>
        ),
        size: 280,
      },
      {
        accessorKey: "outcome",
        header: "Outcome",
        cell: ({ row }) => (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              row.original.outcome === "YES" || row.original.outcome === "Yes"
                ? "bg-[#00E0AA]/20 text-[#00E0AA] dark:bg-[#00E0AA]/15 dark:text-[#00E0AA]"
                : "bg-rose-500/20 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
            }`}
          >
            {row.original.outcome}
          </span>
        ),
        size: 70,
      },
      {
        accessorKey: "sii",
        header: ({ column }) => (
          <button
            className="font-medium hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            SII
          </button>
        ),
        cell: ({ row }) => {
          const value = row.original.sii
          const color = getHeatmapColor(value, valueRanges.sii.min, valueRanges.sii.max, true)
          return (
            <div
              className="font-semibold text-right px-1.5 py-0.5 rounded text-xs border border-border/40"
              style={{ backgroundColor: color }}
            >
              {value}
            </div>
          )
        },
        size: 60,
      },
      {
        accessorKey: "momentum",
        header: "Momentum",
        cell: ({ row }) => {
          const value = row.original.momentum
          const isPositive = value >= 0
          const absValue = Math.abs(value)
          const color = getHeatmapColor(absValue, 0, 50, isPositive)
          return (
            <div
              className="font-semibold text-right px-1.5 py-0.5 rounded text-xs border border-border/40"
              style={{ backgroundColor: color }}
            >
              {value > 0 ? "↑" : value < 0 ? "↓" : ""} {Math.round(value)}
            </div>
          )
        },
        size: 85,
      },
      {
        accessorKey: "last_price",
        header: "Price",
        cell: ({ row }) => {
          const hasChanged = changedMarkets.has(row.original.market_id)
          return (
            <div
              className={`text-right font-mono text-xs text-muted-foreground transition-all duration-300 ${
                hasChanged ? 'animate-pulse bg-[#00E0AA]/20 rounded px-1' : ''
              }`}
            >
              {(row.original.last_price * 100).toFixed(1)}¢
            </div>
          )
        },
        size: 65,
      },
      {
        accessorKey: "price_delta",
        header: ({ column }) => (
          <button
            className="font-medium hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Price Δ
          </button>
        ),
        cell: ({ row }) => {
          const value = row.original.price_delta
          const isPositive = value >= 0
          const color = getHeatmapColor(Math.abs(value), 0, 30, isPositive)
          const hasChanged = changedMarkets.has(row.original.market_id)
          return (
            <div
              className={`font-semibold text-right px-1.5 py-0.5 rounded text-xs border transition-all duration-300 ${
                hasChanged
                  ? 'border-[#00E0AA] shadow-lg shadow-[#00E0AA]/50 scale-105'
                  : 'border-border/40'
              }`}
              style={{ backgroundColor: color }}
            >
              {value > 0 ? "↑ +" : value < 0 ? "↓ " : ""}
              {Math.abs(value).toFixed(1)}%
            </div>
          )
        },
        size: 75,
      },
      {
        accessorKey: "volume_24h",
        header: ({ column }) => (
          <button
            className="font-medium hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Volume
          </button>
        ),
        cell: ({ row }) => {
          const value = row.original.volume_24h
          const color = getHeatmapColor(value, valueRanges.volume_24h.min, valueRanges.volume_24h.max, true)

          // ECharts sparkline configuration
          const option = {
            xAxis: { show: false, type: "category" },
            yAxis: { show: false },
            grid: { top: 2, bottom: 2, left: 0, right: 0 },
            series: [
              {
                data: row.original.volumeHistory || [],
                type: "line",
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 1.5, color: "#00E0AA" },
                areaStyle: { color: "rgba(0, 224, 170, 0.15)" },
              },
            ],
          }

          return (
            <div
              className="flex items-center justify-between gap-1.5 px-1.5 py-0.5 rounded border border-border/40"
              style={{ backgroundColor: color }}
            >
              <span className="font-medium text-xs">${(value / 1000).toFixed(0)}k</span>
              <ReactEChartsCore
                echarts={echarts}
                option={option}
                style={{ height: 20, width: 50 }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          )
        },
        size: 130,
      },
      {
        accessorKey: "trades_24h",
        header: ({ column }) => (
          <button
            className="font-medium hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            # Trades
          </button>
        ),
        cell: ({ row }) => {
          const value = row.original.trades_24h
          return (
            <div className="font-medium text-right text-xs text-muted-foreground">
              {value > 0 ? value.toLocaleString() : '-'}
            </div>
          )
        },
        size: 80,
      },
      {
        accessorKey: "buyers_24h",
        header: "# Buyers",
        cell: ({ row }) => {
          const value = row.original.buyers_24h
          return (
            <div className="font-medium text-right text-xs text-muted-foreground">
              {value > 0 ? value.toLocaleString() : '-'}
            </div>
          )
        },
        size: 75,
      },
      {
        accessorKey: "sellers_24h",
        header: "# Sellers",
        cell: ({ row }) => {
          const value = row.original.sellers_24h
          return (
            <div className="font-medium text-right text-xs text-muted-foreground">
              {value > 0 ? value.toLocaleString() : '-'}
            </div>
          )
        },
        size: 75,
      },
      {
        accessorKey: "buy_sell_ratio",
        header: "B/S Ratio",
        cell: ({ row }) => {
          const value = row.original.buy_sell_ratio
          const isPositive = value >= 1
          const color = getHeatmapColor(Math.abs(value - 1), 0, 1.5, isPositive)
          return (
            <div
              className="font-semibold text-right px-1.5 py-0.5 rounded text-xs border border-border/40"
              style={{ backgroundColor: color }}
            >
              {value.toFixed(2)}
            </div>
          )
        },
        size: 70,
      },
      {
        accessorKey: "whale_buy_sell_ratio",
        header: "Whale B/S",
        cell: ({ row }) => {
          const value = row.original.whale_buy_sell_ratio
          const isPositive = value >= 1
          const color = getHeatmapColor(Math.abs(value - 1), 0, 1.5, isPositive)
          return (
            <div
              className="font-semibold text-right px-1.5 py-0.5 rounded text-xs border border-border/40"
              style={{ backgroundColor: color }}
            >
              {value.toFixed(2)}
            </div>
          )
        },
        size: 75,
      },
      {
        accessorKey: "whale_pressure",
        header: ({ column }) => (
          <button
            className="font-medium hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Whale Pressure
          </button>
        ),
        cell: ({ row }) => {
          const value = row.original.whale_pressure
          const isPositive = value >= 0
          const absValue = Math.abs(value)
          const maxAbs = Math.max(Math.abs(valueRanges.whale_pressure.min), Math.abs(valueRanges.whale_pressure.max))
          const color = getHeatmapColor(absValue, 0, maxAbs, isPositive)
          return (
            <div
              className="font-semibold text-right px-1.5 py-0.5 rounded text-xs border border-border/40"
              style={{ backgroundColor: color }}
            >
              {value > 0 ? '+' : ''}{(value / 1000).toFixed(0)}k
            </div>
          )
        },
        size: 110,
      },
      {
        accessorKey: "smart_buy_sell_ratio",
        header: "Smart B/S",
        cell: ({ row }) => {
          const value = row.original.smart_buy_sell_ratio
          const isPositive = value >= 1
          const color = getHeatmapColor(Math.abs(value - 1), 0, 1.5, isPositive)
          return (
            <div
              className="font-semibold text-right px-1.5 py-0.5 rounded text-xs border border-border/40"
              style={{ backgroundColor: color }}
            >
              {value.toFixed(2)}
            </div>
          )
        },
        size: 75,
      },
      {
        accessorKey: "smart_pressure",
        header: ({ column }) => (
          <button
            className="font-medium hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Smart Pressure
          </button>
        ),
        cell: ({ row }) => {
          const value = row.original.smart_pressure
          const isPositive = value >= 0
          const absValue = Math.abs(value)
          const maxAbs = Math.max(Math.abs(valueRanges.smart_pressure.min), Math.abs(valueRanges.smart_pressure.max))
          const color = getHeatmapColor(absValue, 0, maxAbs, isPositive)
          return (
            <div
              className="font-semibold text-right px-1.5 py-0.5 rounded text-xs border border-border/40"
              style={{ backgroundColor: color }}
            >
              {value > 0 ? '+' : ''}{(value / 1000).toFixed(0)}k
            </div>
          )
        },
        size: 110,
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }) => (
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {row.original.category}
          </span>
        ),
        size: 100,
      },
      {
        id: "actions",
        header: "",
        cell: () => (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
            <Star className="h-3 w-3" />
          </Button>
        ),
        size: 50,
      },
    ],
    [valueRanges, changedMarkets]
  )

  const table = useReactTable({
    data: displayMarkets,
    columns,
    state: {
      sorting,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const tableContainerRef = useRef<HTMLDivElement>(null)

  const { rows } = table.getRowModel()

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 36,
    overscan: 10,
  })

  // Check if any filters are active - memoized to prevent unnecessary recalculations
  const hasActiveFilters = useMemo(() => {
    return (
      filters.categories.length > 0 ||
      filters.outcomes.length > 0 ||
      filters.priceRange[0] !== 0 ||
      filters.priceRange[1] !== 1 ||
      filters.volumeRange[0] !== 0 ||
      filters.volumeRange[1] !== 500000 ||
      filters.siiRange[0] !== 0 ||
      filters.siiRange[1] !== 100 ||
      filters.momentumRange[0] !== -50 ||
      filters.momentumRange[1] !== 50
    )
  }, [filters])

  // Stable reset function to prevent unnecessary re-renders
  const resetFilters = useCallback(() => {
    setFilters({
      categories: [],
      outcomes: [],
      priceRange: [0, 1],
      volumeRange: [0, 500000],
      siiRange: [0, 100],
      momentumRange: [-50, 50],
      ratioRange: [0, 3],
    })
    setPage(1) // Reset to page 1 when clearing filters
  }, [])

  // Handle filter changes and reset to page 1
  const handleFilterChange = useCallback((filterUpdate: Partial<FilterState>) => {
    setFilters(prev => ({ ...prev, ...filterUpdate }))
    setPage(1)
  }, [])

  // Show loading state while fetching initial data
  const hasMarketData = sourceMarkets && sourceMarkets.length > 0
  if (isLoading && !hasMarketData) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="px-6 pt-5 pb-3 border-b border-border/50">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border">
              <div className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">Loading</span>
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Market Screener</h1>
          <p className="text-sm text-muted-foreground">
            Fetching live market data from Polymarket...
          </p>
        </div>
        <div className="px-6 py-6">
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-muted-foreground" />
          </div>
        </div>
      </Card>
    )
  }

  // Show error state if fetch failed after retries
  if (error) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="px-6 pt-5 pb-3 border-b border-border/50">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/20">
              <div className="h-2 w-2 rounded-full bg-rose-500" />
              <span className="text-xs font-medium text-rose-500">Error</span>
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Market Screener</h1>
          <p className="text-sm text-muted-foreground">
            Database connection issue - Supabase quota exceeded. Please upgrade your plan or try again later.
          </p>
        </div>
        <div className="px-6 py-6">
          <div className="text-center py-20 text-muted-foreground">
            <p className="mb-4">Your Supabase free tier egress limit has been exceeded (17.83 GB / 5 GB).</p>
            <p className="mb-4">Upgrade to Pro ($25/mo) for 250 GB egress, or wait for your billing cycle to reset.</p>
            <Button onClick={() => window.location.reload()} variant="outline">
              Try Again
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      {/* Header Section */}
      <div className="px-6 pt-5 pb-3">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Market Screener
          </h1>
          {isFetching && (
            <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-muted border border-border">
              <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
              <span className="text-xs text-muted-foreground">Syncing...</span>
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Find high-conviction prediction markets using SII and momentum signals.
          {totalMarkets > 0 && ` Showing ${offset + 1}-${Math.min(offset + pageSize, totalMarkets)} of ${totalMarkets} markets.`}
          {totalMarkets === 0 && !isFetching && ' Database timeout - upgrade Supabase or try again later.'}
        </p>
      </div>

      {/* Filters Section */}
      <div className="px-6 py-4 border-t border-border/50">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Time Window */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground whitespace-nowrap">
              Time Window
            </span>
            <div className="flex gap-1.5">
              {(['24h', '12h', '6h', '1h', '10m'] as TimeWindow[]).map((window) => (
                <Button
                  key={window}
                  variant="ghost"
                  size="sm"
                  onClick={() => setTimeWindow(window)}
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition",
                    timeWindow === window
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  {window}
                </Button>
              ))}
            </div>
          </div>

          <div className="h-8 w-px bg-border/50" />

          {/* Advanced Filters Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "transition-all duration-200",
                  hasActiveFilters && "bg-muted border-border"
                )}
              >
                <SlidersHorizontal className="h-4 w-4 mr-2" />
                Advanced Filters
                {hasActiveFilters && (
                  <span className="ml-2 flex items-center justify-center rounded-full bg-foreground px-2 py-0.5 text-xs font-bold text-background min-w-[20px]">
                    {filters.categories.length + filters.outcomes.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-0" align="start">
              <div className="space-y-0">
                {/* Header */}
                <div className="border-b border-border/50 bg-muted/30 px-6 py-4">
                  <h4 className="font-semibold text-base">Advanced Filters</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Narrow down markets by specific criteria
                  </p>
                </div>

                {/* Filter Content */}
                <div className="px-6 py-4 space-y-6 max-h-[500px] overflow-y-auto">
                  {/* Categories */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground">Categories</Label>
                    <div className="grid grid-cols-2 gap-3">
                      {categories.map((cat) => (
                        <div key={cat} className="flex items-center space-x-2">
                          <Checkbox
                            id={`cat-${cat}`}
                            checked={filters.categories.includes(cat)}
                            onCheckedChange={(checked) => {
                              handleFilterChange({
                                categories: checked
                                  ? [...filters.categories, cat]
                                  : filters.categories.filter(c => c !== cat)
                              })
                            }}
                            className="data-[state=checked]:bg-[#00E0AA] data-[state=checked]:border-[#00E0AA]"
                          />
                          <label
                            htmlFor={`cat-${cat}`}
                            className="text-sm cursor-pointer hover:text-foreground transition-colors"
                          >
                            {cat}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="h-px bg-border/50" />

                  {/* Outcomes */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground">Outcomes</Label>
                    <div className="flex gap-6">
                      {['YES', 'NO', 'Yes', 'No'].map((outcome) => (
                        <div key={outcome} className="flex items-center space-x-2">
                          <Checkbox
                            id={`outcome-${outcome}`}
                            checked={filters.outcomes.includes(outcome)}
                            onCheckedChange={(checked) => {
                              handleFilterChange({
                                outcomes: checked
                                  ? [...filters.outcomes, outcome]
                                  : filters.outcomes.filter(o => o !== outcome)
                              })
                            }}
                            className="data-[state=checked]:bg-[#00E0AA] data-[state=checked]:border-[#00E0AA]"
                          />
                          <label
                            htmlFor={`outcome-${outcome}`}
                            className="text-sm font-medium cursor-pointer hover:text-foreground transition-colors"
                          >
                            {outcome}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="h-px bg-border/50" />

                  {/* Price Range */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground flex items-center justify-between">
                      <span>Price Range</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {(filters.priceRange[0] * 100).toFixed(0)}¢ - {(filters.priceRange[1] * 100).toFixed(0)}¢
                      </span>
                    </Label>
                    <Slider
                      min={0}
                      max={1}
                      step={0.01}
                      value={filters.priceRange}
                      onValueChange={(value) => handleFilterChange({ priceRange: value as [number, number] })}
                      className="[&_[role=slider]]:bg-[#00E0AA] [&_[role=slider]]:border-[#00E0AA]"
                    />
                  </div>

                  {/* Volume Range */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground flex items-center justify-between">
                      <span>Volume Range</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        ${(filters.volumeRange[0] / 1000).toFixed(0)}k - ${(filters.volumeRange[1] / 1000).toFixed(0)}k
                      </span>
                    </Label>
                    <Slider
                      min={0}
                      max={500000}
                      step={10000}
                      value={filters.volumeRange}
                      onValueChange={(value) => handleFilterChange({ volumeRange: value as [number, number] })}
                      className="[&_[role=slider]]:bg-[#00E0AA] [&_[role=slider]]:border-[#00E0AA]"
                    />
                  </div>

                  {/* SII Range */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground flex items-center justify-between">
                      <span>SII Range</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {filters.siiRange[0]} - {filters.siiRange[1]}
                      </span>
                    </Label>
                    <Slider
                      min={0}
                      max={100}
                      step={5}
                      value={filters.siiRange}
                      onValueChange={(value) => handleFilterChange({ siiRange: value as [number, number] })}
                      className="[&_[role=slider]]:bg-[#00E0AA] [&_[role=slider]]:border-[#00E0AA]"
                    />
                  </div>

                  {/* Momentum Range */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground flex items-center justify-between">
                      <span>Momentum Range</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {filters.momentumRange[0]} - {filters.momentumRange[1]}
                      </span>
                    </Label>
                    <Slider
                      min={-50}
                      max={50}
                      step={5}
                      value={filters.momentumRange}
                      onValueChange={(value) => handleFilterChange({ momentumRange: value as [number, number] })}
                      className="[&_[role=slider]]:bg-[#00E0AA] [&_[role=slider]]:border-[#00E0AA]"
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t border-border/50 bg-muted/30 px-6 py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 transition-all duration-200"
                    onClick={resetFilters}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Clear All Filters
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <div className="flex-1" />

          {/* Column Visibility Toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="hover:border-[#00E0AA]/50 transition-all duration-200"
              >
                <Settings2 className="h-4 w-4 mr-2" />
                Columns
                <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Toggle Columns
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(!!value)}
                      className="capitalize"
                    >
                      {column.id}
                    </DropdownMenuCheckboxItem>
                  )
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Active Filters Pills */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border/50">
            <span className="text-xs font-medium text-muted-foreground">Active:</span>
            <div className="flex flex-wrap gap-2">
              {filters.categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => handleFilterChange({
                    categories: filters.categories.filter(c => c !== cat)
                  })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted border border-border text-xs font-medium text-foreground hover:bg-muted/80 transition-colors"
                >
                  {cat}
                  <X className="h-3 w-3" />
                </button>
              ))}
              {filters.outcomes.map((outcome) => (
                <button
                  key={outcome}
                  onClick={() => handleFilterChange({
                    outcomes: filters.outcomes.filter(o => o !== outcome)
                  })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted border border-border text-xs font-medium text-foreground hover:bg-muted/80 transition-colors"
                >
                  {outcome}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Table Container with Virtual Scrolling */}
      <div className="px-6 pb-6">
        <div className="rounded-xl border border-border/50 bg-card dark:bg-[#18181b] shadow-none overflow-hidden">
          <div
            ref={tableContainerRef}
            className="overflow-auto"
            style={{ maxHeight: "600px", width: "100%" }}
          >
            <table className="border-collapse" style={{ minWidth: "max-content" }}>
              {/* Sticky Header */}
              <thead className="sticky top-0 z-10 border-b border-border bg-card dark:bg-[#18181b]">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header, index) => {
                    const isSorted = header.column.getIsSorted()
                    const isFirstColumn = index === 0

                    return (
                      <th
                        key={header.id}
                        className={`text-left px-2 py-3 text-xs font-semibold whitespace-nowrap ${
                          isFirstColumn ? "sticky left-0 z-20 bg-card/95 backdrop-blur-md border-r border-border/20" : ""
                        } ${isSorted ? "text-[#00E0AA]" : "text-muted-foreground"}`}
                        style={{ width: header.getSize() }}
                      >
                        <div className="flex items-center gap-2">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                          {isSorted && (
                            <span className="text-[#00E0AA]">
                              {isSorted === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : (
                                <ArrowDown className="h-3 w-3" />
                              )}
                            </span>
                          )}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>

            {/* Table Body */}
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={`border-b border-border/40 transition-all duration-150 hover:bg-[#00E0AA]/5 ${
                    rowIndex % 2 === 0 ? "bg-background/50" : "bg-muted/5"
                  }`}
                >
                  {row.getVisibleCells().map((cell, cellIndex) => {
                    const isFirstColumn = cellIndex === 0

                    return (
                      <td
                        key={cell.id}
                        className={`px-2 py-1.5 text-xs whitespace-nowrap ${
                          isFirstColumn
                            ? `sticky left-0 z-10 border-r border-border/20 ${rowIndex % 2 === 0 ? "bg-background/50" : "bg-muted/5"}`
                            : ""
                        }`}
                        style={{ width: cell.column.getSize() }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
          <div className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{offset + 1}</span> to{' '}
            <span className="font-semibold text-foreground">
              {Math.min(offset + pageSize, totalMarkets)}
            </span>{' '}
            of <span className="font-semibold text-foreground">{totalMarkets}</span> markets
            {hasActiveFilters && (
              <span className="ml-1 text-[#00E0AA]">(filtered)</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || isLoading}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">Page</span>
              <span className="text-sm font-semibold text-foreground">{page}</span>
              <span className="text-sm text-muted-foreground">of</span>
              <span className="text-sm font-semibold text-foreground">{totalPages}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || isLoading}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      </div>

      {/* Live Updates Footer */}
      <div className="px-6 py-3 border-t border-border/50">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted border border-border">
            <div className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" />
            <span className="text-xs font-medium text-muted-foreground">
              Live Updates {data?.stale && '(Syncing...)'}
            </span>
          </div>
          {data?.last_synced && (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(data.last_synced).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}
