"use client"

import { useState, useMemo } from "react"
import { ArrowUpDown, Star, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import Link from "next/link"

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
}

interface MarketScreenerInterfaceProps {
  markets?: Market[]
}

// Sparkline component
function MiniSparkline({ data, trend }: { data: number[], trend: 'up' | 'down' | 'neutral' }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * 60
    const y = 20 - ((val - min) / range) * 18
    return `${x},${y}`
  }).join(' ')

  const color = trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : '#6b7280'

  return (
    <svg width="60" height="20" className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Generate sparkline data based on market momentum
function generateSparklineData(momentum: number, price_delta: number): number[] {
  const base = 50
  const variance = momentum * 2
  return Array.from({ length: 8 }, (_, i) => {
    const trend = (i / 7) * price_delta * 0.5
    const noise = (Math.random() - 0.5) * variance
    return base + trend + noise
  })
}

// Color helpers
function getSIIColor(sii: number): string {
  if (sii >= 80) return "text-green-600 dark:text-green-400 font-semibold"
  if (sii >= 60) return "text-emerald-600 dark:text-emerald-400"
  if (sii >= 40) return "text-yellow-600 dark:text-yellow-400"
  if (sii >= 20) return "text-orange-600 dark:text-orange-400"
  return "text-red-600 dark:text-red-400"
}

function getMomentumColor(momentum: number): string {
  if (momentum > 15) return "text-green-600 dark:text-green-400 font-semibold"
  if (momentum > 5) return "text-emerald-600 dark:text-emerald-400"
  if (momentum > -5) return "text-muted-foreground"
  if (momentum > -15) return "text-orange-600 dark:text-orange-400"
  return "text-red-600 dark:text-red-400 font-semibold"
}

function getRatioColorClass(ratio: number): string {
  if (ratio >= 1.5) return "text-green-600 dark:text-green-400 font-semibold"
  if (ratio >= 1.1) return "text-emerald-600 dark:text-emerald-400"
  if (ratio >= 0.9) return "text-muted-foreground"
  if (ratio >= 0.5) return "text-orange-600 dark:text-orange-400"
  return "text-red-600 dark:text-red-400 font-semibold"
}

function getPressureColorClass(pressure: number): string {
  if (pressure > 50000) return "text-green-600 dark:text-green-400 font-semibold"
  if (pressure > 10000) return "text-emerald-600 dark:text-emerald-400"
  if (pressure > -10000) return "text-muted-foreground"
  if (pressure > -50000) return "text-orange-600 dark:text-orange-400"
  return "text-red-600 dark:text-red-400 font-semibold"
}

function getVolumeColorClass(volume: number, maxVolume: number): string {
  const ratio = volume / maxVolume
  if (ratio > 0.7) return "text-green-600 dark:text-green-400 font-semibold"
  if (ratio > 0.4) return "text-emerald-600 dark:text-emerald-400"
  return "text-muted-foreground"
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

export function MarketScreenerInterface({ markets = [] }: MarketScreenerInterfaceProps) {
  const [sortField, setSortField] = useState<keyof Market>("sii")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set())
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('24h')
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    outcomes: [],
    priceRange: [0, 1],
    volumeRange: [0, 500000],
    siiRange: [0, 100],
    momentumRange: [-50, 50],
    ratioRange: [0, 3],
  })

  // Handle cell selection
  const handleCellClick = (marketId: string, field: string) => {
    const cellKey = `${marketId}-${field}`
    setSelectedCells(prev => {
      const next = new Set(prev)
      if (next.has(cellKey)) {
        next.delete(cellKey)
      } else {
        next.add(cellKey)
      }
      return next
    })
  }

  const isCellSelected = (marketId: string, field: string) => {
    return selectedCells.has(`${marketId}-${field}`)
  }

  // Dummy data generator
  const generateDummyMarkets = (): Market[] => {
    const categories = ["Politics", "Economics", "Sports", "Entertainment", "Technology", "Health"]
    const titles = [
      "Will Bitcoin reach $100k by end of 2024?",
      "Will Trump win the 2024 election?",
      "Will inflation drop below 2% this quarter?",
      "Will Lakers win NBA championship?",
      "Will new iPhone break sales records?",
      "Will Fed cut rates in next meeting?",
      "Will unemployment rise above 4%?",
      "Will stock market hit new highs?",
      "Will housing prices decline?",
      "Will recession occur in 2024?",
      "Will gas prices exceed $5/gallon?",
      "Will China GDP growth exceed 5%?",
      "Will Ethereum surpass $5000?",
      "Will SpaceX launch 100 missions?",
      "Will EU implement new crypto regulations?",
    ]

    return titles.map((title, i) => ({
      market_id: `market_${i + 1}`,
      title,
      outcome: Math.random() > 0.5 ? "YES" : "NO",
      last_price: 0.3 + Math.random() * 0.4,
      price_delta: (Math.random() - 0.5) * 30,
      volume_24h: Math.random() * 500000,
      trades_24h: Math.floor(Math.random() * 5000),
      buyers_24h: Math.floor(Math.random() * 2000),
      sellers_24h: Math.floor(Math.random() * 2000),
      buy_sell_ratio: 0.5 + Math.random() * 1.5,
      whale_buy_sell_ratio: 0.5 + Math.random() * 1.5,
      whale_pressure: (Math.random() - 0.5) * 200000,
      smart_buy_sell_ratio: 0.5 + Math.random() * 1.5,
      smart_pressure: (Math.random() - 0.5) * 150000,
      momentum: (Math.random() - 0.5) * 40,
      category: categories[Math.floor(Math.random() * categories.length)],
      sii: Math.floor(Math.random() * 100),
    }))
  }

  const displayMarkets = markets.length > 0 ? markets : generateDummyMarkets()

  // Calculate max volume for color scaling
  const maxVolume = useMemo(() => {
    return Math.max(...displayMarkets.map(m => m.volume_24h))
  }, [displayMarkets])

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(displayMarkets.map(m => m.category))
    return Array.from(cats).sort()
  }, [displayMarkets])

  // Handle sorting
  const handleSort = (field: keyof Market) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  // Filter and sort markets
  const sortedMarkets = useMemo(() => {
    let filtered = displayMarkets

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(m =>
        m.title.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Apply category filter
    if (filters.categories.length > 0) {
      filtered = filtered.filter(m => filters.categories.includes(m.category))
    }

    // Apply outcome filter
    if (filters.outcomes.length > 0) {
      filtered = filtered.filter(m => filters.outcomes.includes(m.outcome))
    }

    // Apply range filters
    filtered = filtered.filter(m =>
      m.last_price >= filters.priceRange[0] &&
      m.last_price <= filters.priceRange[1] &&
      m.volume_24h >= filters.volumeRange[0] &&
      m.volume_24h <= filters.volumeRange[1] &&
      m.sii >= filters.siiRange[0] &&
      m.sii <= filters.siiRange[1] &&
      m.momentum >= filters.momentumRange[0] &&
      m.momentum <= filters.momentumRange[1] &&
      m.buy_sell_ratio >= filters.ratioRange[0] &&
      m.buy_sell_ratio <= filters.ratioRange[1]
    )

    // Apply sorting
    return filtered.sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      return 0
    })
  }, [displayMarkets, filters, searchTerm, sortField, sortDirection])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Market Screener</h1>
        <p className="text-muted-foreground mt-2">
          Find high-conviction prediction markets using SII and momentum signals
        </p>
      </div>

      {/* Filters Row - All in one line */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="w-[300px]">
          <Input
            placeholder="Search markets..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Time Window */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium whitespace-nowrap">Time Window:</span>
          <div className="flex gap-1">
            {(['24h', '12h', '6h', '1h', '10m'] as TimeWindow[]).map((window) => (
              <Button
                key={window}
                variant={timeWindow === window ? "default" : "outline"}
                size="sm"
                onClick={() => setTimeWindow(window)}
              >
                {window}
              </Button>
            ))}
          </div>
        </div>

        {/* Advanced Filters Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Filters
              {(filters.categories.length > 0 || filters.outcomes.length > 0) && (
                <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  {filters.categories.length + filters.outcomes.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96" align="end">
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-3">Advanced Filters</h4>
              </div>

              {/* Categories */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Categories</Label>
                <div className="grid grid-cols-2 gap-2">
                  {categories.map((cat) => (
                    <div key={cat} className="flex items-center space-x-2">
                      <Checkbox
                        id={`cat-${cat}`}
                        checked={filters.categories.includes(cat)}
                        onCheckedChange={(checked) => {
                          setFilters(prev => ({
                            ...prev,
                            categories: checked
                              ? [...prev.categories, cat]
                              : prev.categories.filter(c => c !== cat)
                          }))
                        }}
                      />
                      <label
                        htmlFor={`cat-${cat}`}
                        className="text-sm cursor-pointer"
                      >
                        {cat}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Outcomes */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Outcomes</Label>
                <div className="flex gap-4">
                  {['YES', 'NO'].map((outcome) => (
                    <div key={outcome} className="flex items-center space-x-2">
                      <Checkbox
                        id={`outcome-${outcome}`}
                        checked={filters.outcomes.includes(outcome)}
                        onCheckedChange={(checked) => {
                          setFilters(prev => ({
                            ...prev,
                            outcomes: checked
                              ? [...prev.outcomes, outcome]
                              : prev.outcomes.filter(o => o !== outcome)
                          }))
                        }}
                      />
                      <label
                        htmlFor={`outcome-${outcome}`}
                        className="text-sm cursor-pointer"
                      >
                        {outcome}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Price Range */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Price Range: {(filters.priceRange[0] * 100).toFixed(0)}¢ - {(filters.priceRange[1] * 100).toFixed(0)}¢
                </Label>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={filters.priceRange}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, priceRange: value as [number, number] }))}
                />
              </div>

              {/* Volume Range */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Volume Range: ${(filters.volumeRange[0] / 1000).toFixed(0)}k - ${(filters.volumeRange[1] / 1000).toFixed(0)}k
                </Label>
                <Slider
                  min={0}
                  max={500000}
                  step={10000}
                  value={filters.volumeRange}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, volumeRange: value as [number, number] }))}
                />
              </div>

              {/* SII Range */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  SII Range: {filters.siiRange[0]} - {filters.siiRange[1]}
                </Label>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={filters.siiRange}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, siiRange: value as [number, number] }))}
                />
              </div>

              {/* Momentum Range */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Momentum Range: {filters.momentumRange[0]} - {filters.momentumRange[1]}
                </Label>
                <Slider
                  min={-50}
                  max={50}
                  step={1}
                  value={filters.momentumRange}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, momentumRange: value as [number, number] }))}
                />
              </div>

              {/* Buy/Sell Ratio Range */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Buy/Sell Ratio: {filters.ratioRange[0].toFixed(1)} - {filters.ratioRange[1].toFixed(1)}
                </Label>
                <Slider
                  min={0}
                  max={3}
                  step={0.1}
                  value={filters.ratioRange}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, ratioRange: value as [number, number] }))}
                />
              </div>

              {/* Reset Button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setFilters({
                  categories: [],
                  outcomes: [],
                  priceRange: [0, 1],
                  volumeRange: [0, 500000],
                  siiRange: [0, 100],
                  momentumRange: [-50, 50],
                  ratioRange: [0, 3],
                })}
              >
                Reset Filters
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Markets Table */}
      <div className="border rounded-lg overflow-hidden">
        <div
          className="overflow-x-auto"
          style={{
            maxHeight: '600px',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          <table className="w-full whitespace-nowrap caption-bottom  text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead className="sticky top-0 bg-background z-50 border-b-2 border-border">
              <tr className="divide-x divide-y divide-border">
                <th className="w-[300px] sticky left-0 bg-background z-50 divide-y divide-x divide-border h-10 px-2 text-left align-middle font-medium text-muted-foreground">
                  Market
                </th>
                <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">
                  Outcome
                </th>
                <th
                  className="cursor-pointer h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  onClick={() => handleSort("sii")}
                >
                  <div className="flex items-center justify-end gap-1">
                    SII
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </th>
                <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground">
                  Momentum
                </th>
                <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground">
                  Price
                </th>
                <th
                  className="cursor-pointer h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  onClick={() => handleSort("price_delta")}
                >
                  <div className="flex items-center justify-end gap-1">
                    Price Δ
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </th>
                <th
                  className="cursor-pointer h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  onClick={() => handleSort("volume_24h")}
                >
                  <div className="flex items-center justify-end gap-1">
                    Volume
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </th>
                <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground">
                  # Trades
                </th>
                <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground">
                  # Buyers
                </th>
                <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground">
                  # Sellers
                </th>
                <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground">
                  Buy/Sell
                </th>
                <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground">
                  Whale B/S
                </th>
                <th
                  className="cursor-pointer h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  onClick={() => handleSort("whale_pressure")}
                >
                  <div className="flex items-center justify-end gap-1">
                    Whale Pressure
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </th>
                <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground">
                  Smart B/S
                </th>
                <th
                  className="cursor-pointer h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  onClick={() => handleSort("smart_pressure")}
                >
                  <div className="flex items-center justify-end gap-1">
                    Smart Pressure
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </th>
                <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">
                  Category
                </th>
                <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedMarkets.map((market) => {
                const sparklineData = generateSparklineData(market.momentum, market.price_delta);
                const sparklineTrend = market.price_delta > 0 ? 'up' : 'down';

                return (
                  <tr
                    key={market.market_id}
                    className="transition-colors hover:bg-muted/50 divide-x divide-y divide-border"
                  >
                    <td className="font-medium sticky left-0 bg-background z-10 p-2 align-middle">
                      <Link
                        href={`/analysis/market/${market.market_id}`}
                        className="text-foreground  hover:text-primary hover:underline transition-colors"
                      >
                        {market.title}
                      </Link>
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'outcome')}
                      className={`p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'outcome') ? 'ring-2 ring-primary ring-inset' : ''}`}
                    >
                      <span
                        className={
                          market.outcome === "YES" ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"
                        }
                      >
                        {market.outcome}
                      </span>
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'sii')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'sii') ? 'ring-2 ring-primary ring-inset' : ''} ${getSIIColor(market.sii)}`}
                    >
                      {market.sii}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'momentum')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'momentum') ? 'ring-2 ring-primary ring-inset' : ''}`}
                    >
                      <div className="flex items-center justify-end gap-2">
                        <span className={getMomentumColor(market.momentum)}>
                          {Math.round(market.momentum)}
                        </span>
                        <MiniSparkline data={sparklineData} trend={sparklineTrend} />
                      </div>
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'price')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'price') ? 'ring-2 ring-primary ring-inset' : ''}`}
                    >
                      {(market.last_price * 100).toFixed(1)}¢
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'price_delta')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'price_delta') ? 'ring-2 ring-primary ring-inset' : ''} ${market.price_delta > 0 ? "text-green-600 dark:text-green-400 font-semibold" : market.price_delta < 0 ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}
                    >
                      {market.price_delta > 0 ? "↑ +" : market.price_delta < 0 ? "↓ " : ""}{Math.abs(market.price_delta).toFixed(1)}%
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'volume')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'volume') ? 'ring-2 ring-primary ring-inset' : ''} ${getVolumeColorClass(market.volume_24h, maxVolume)}`}
                    >
                      ${(market.volume_24h / 1000).toFixed(0)}k
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'trades')}
                      className={`text-muted-foreground text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'trades') ? 'ring-2 ring-primary ring-inset' : ''}`}
                    >
                      {market.trades_24h}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'buyers')}
                      className={`text-muted-foreground text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'buyers') ? 'ring-2 ring-primary ring-inset' : ''}`}
                    >
                      {market.buyers_24h}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'sellers')}
                      className={`text-muted-foreground text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'sellers') ? 'ring-2 ring-primary ring-inset' : ''}`}
                    >
                      {market.sellers_24h}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'buy_sell_ratio')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'buy_sell_ratio') ? 'ring-2 ring-primary ring-inset' : ''} ${getRatioColorClass(market.buy_sell_ratio)}`}
                    >
                      {market.buy_sell_ratio.toFixed(2)}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'whale_ratio')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'whale_ratio') ? 'ring-2 ring-primary ring-inset' : ''} ${getRatioColorClass(market.whale_buy_sell_ratio)}`}
                    >
                      {market.whale_buy_sell_ratio.toFixed(2)}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'whale_pressure')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'whale_pressure') ? 'ring-2 ring-primary ring-inset' : ''} ${getPressureColorClass(market.whale_pressure)}`}
                    >
                      {market.whale_pressure > 0 ? '+' : ''}{(market.whale_pressure / 1000).toFixed(0)}k
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'smart_ratio')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'smart_ratio') ? 'ring-2 ring-primary ring-inset' : ''} ${getRatioColorClass(market.smart_buy_sell_ratio)}`}
                    >
                      {market.smart_buy_sell_ratio.toFixed(2)}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'smart_pressure')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'smart_pressure') ? 'ring-2 ring-primary ring-inset' : ''} ${getPressureColorClass(market.smart_pressure)}`}
                    >
                      {market.smart_pressure > 0 ? '+' : ''}{(market.smart_pressure / 1000).toFixed(0)}k
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'category')}
                      className={`bg-secondary/50 text-secondary-foreground p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'category') ? 'ring-2 ring-primary ring-inset' : ''}`}
                    >
                      {market.category}
                    </td>
                    <td className="p-2 align-middle">
                      <Button size="sm" variant="ghost">
                        <Star className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        Showing {sortedMarkets.length} of {markets.length} markets
      </div>
    </div>
  );
}

// Export alias for compatibility
export { MarketScreenerInterface as MarketScreener };
