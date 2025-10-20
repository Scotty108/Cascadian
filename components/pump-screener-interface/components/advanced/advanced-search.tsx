"use client"

import { useState } from "react"
import { Search, Filter, X, Star } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"

interface AdvancedSearchProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  customFilters: {
    minMarketCap?: number
    maxMarketCap?: number
    minVolume24h?: number
    maxVolume24h?: number
    minSocialMentions?: number
    patternTypes: string[]
    excludeSymbols: string[]
  }
  onFiltersChange: (filters: any) => void
  showFavorites: boolean
  onToggleFavorites: () => void
  filterStats: {
    totalAlerts: number
    filteredAlerts: number
    activeFiltersCount: number
  }
  onClearFilters: () => void
}

const PATTERN_TYPES = [
  "Volume Spike",
  "Price Surge",
  "Social Spike",
  "Whale Activity",
  "Coordinated Pump",
  "Organic Growth",
  "Social Media Driven",
]

const POPULAR_SYMBOLS = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "PEPE/USDT",
  "DOGE/USDT",
  "SHIB/USDT",
  "ADA/USDT",
  "DOT/USDT",
  "LINK/USDT",
  "UNI/USDT",
]

export function AdvancedSearch({
  searchQuery,
  onSearchChange,
  customFilters,
  onFiltersChange,
  showFavorites,
  onToggleFavorites,
  filterStats,
  onClearFilters,
}: AdvancedSearchProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [marketCapRange, setMarketCapRange] = useState([
    customFilters.minMarketCap || 0,
    customFilters.maxMarketCap || 1000000000000,
  ])
  const [volumeRange, setVolumeRange] = useState([
    customFilters.minVolume24h || 0,
    customFilters.maxVolume24h || 50000000000,
  ])

  const handleMarketCapChange = (values: number[]) => {
    setMarketCapRange(values)
    onFiltersChange({
      minMarketCap: values[0] > 0 ? values[0] : undefined,
      maxMarketCap: values[1] < 1000000000000 ? values[1] : undefined,
    })
  }

  const handleVolumeChange = (values: number[]) => {
    setVolumeRange(values)
    onFiltersChange({
      minVolume24h: values[0] > 0 ? values[0] : undefined,
      maxVolume24h: values[1] < 50000000000 ? values[1] : undefined,
    })
  }

  const handlePatternTypeToggle = (pattern: string, checked: boolean) => {
    const newPatterns = checked
      ? [...customFilters.patternTypes, pattern]
      : customFilters.patternTypes.filter((p) => p !== pattern)

    onFiltersChange({ patternTypes: newPatterns })
  }

  const handleExcludeSymbol = (symbol: string) => {
    const newExcluded = customFilters.excludeSymbols.includes(symbol)
      ? customFilters.excludeSymbols.filter((s) => s !== symbol)
      : [...customFilters.excludeSymbols, symbol]

    onFiltersChange({ excludeSymbols: newExcluded })
  }

  const formatMarketCap = (value: number) => {
    if (value >= 1000000000) return `$${(value / 1000000000).toFixed(1)}B`
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value}`
  }

  const formatVolume = (value: number) => {
    if (value >= 1000000000) return `$${(value / 1000000000).toFixed(1)}B`
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value}`
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <CardTitle className="text-lg">Advanced Search & Filters</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {filterStats.filteredAlerts} / {filterStats.totalAlerts} alerts
            </Badge>
            {filterStats.activeFiltersCount > 0 && (
              <Button variant="outline" size="sm" onClick={onClearFilters}>
                <X className="h-3 w-3 mr-1" />
                Clear ({filterStats.activeFiltersCount})
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by symbol, exchange, or pattern type..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={showFavorites ? "default" : "outline"} size="sm" onClick={onToggleFavorites}>
            <Star className="h-3 w-3 mr-1" />
            Favorites Only
          </Button>

          <Button variant="outline" size="sm" onClick={() => setShowAdvanced(!showAdvanced)}>
            <Filter className="h-3 w-3 mr-1" />
            Advanced Filters
          </Button>

          {customFilters.patternTypes.length > 0 && (
            <Badge variant="secondary">
              {customFilters.patternTypes.length} pattern{customFilters.patternTypes.length !== 1 ? "s" : ""}
            </Badge>
          )}

          {customFilters.excludeSymbols.length > 0 && (
            <Badge variant="destructive">{customFilters.excludeSymbols.length} excluded</Badge>
          )}
        </div>

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="space-y-6 pt-4 border-t">
            {/* Market Cap Range */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Market Cap Range</Label>
              <div className="px-3">
                <Slider
                  value={marketCapRange}
                  onValueChange={handleMarketCapChange}
                  max={1000000000000}
                  min={0}
                  step={1000000}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>{formatMarketCap(marketCapRange[0])}</span>
                  <span>{formatMarketCap(marketCapRange[1])}</span>
                </div>
              </div>
            </div>

            {/* Volume Range */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">24h Volume Range</Label>
              <div className="px-3">
                <Slider
                  value={volumeRange}
                  onValueChange={handleVolumeChange}
                  max={50000000000}
                  min={0}
                  step={1000000}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>{formatVolume(volumeRange[0])}</span>
                  <span>{formatVolume(volumeRange[1])}</span>
                </div>
              </div>
            </div>

            {/* Social Mentions */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Minimum Social Mentions</Label>
              <Input
                type="number"
                placeholder="e.g., 100"
                value={customFilters.minSocialMentions || ""}
                onChange={(e) =>
                  onFiltersChange({
                    minSocialMentions: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </div>

            <Separator />

            {/* Pattern Types */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Pattern Types</Label>
              <div className="grid grid-cols-2 gap-2">
                {PATTERN_TYPES.map((pattern) => (
                  <div key={pattern} className="flex items-center space-x-2">
                    <Checkbox
                      id={pattern}
                      checked={customFilters.patternTypes.includes(pattern)}
                      onCheckedChange={(checked) => handlePatternTypeToggle(pattern, !!checked)}
                    />
                    <Label htmlFor={pattern} className="text-sm">
                      {pattern}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Exclude Symbols */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Exclude Symbols</Label>
              <div className="flex flex-wrap gap-2">
                {POPULAR_SYMBOLS.map((symbol) => (
                  <Button
                    key={symbol}
                    variant={customFilters.excludeSymbols.includes(symbol) ? "destructive" : "outline"}
                    size="sm"
                    onClick={() => handleExcludeSymbol(symbol)}
                  >
                    {customFilters.excludeSymbols.includes(symbol) && <X className="h-3 w-3 mr-1" />}
                    {symbol}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
