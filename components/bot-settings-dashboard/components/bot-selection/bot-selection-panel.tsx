"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Slider } from "@/components/ui/slider"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Bot, Filter, ArrowUpDown } from "lucide-react"
import type { BotConfig } from "../../types"
import { BotSearch } from "./bot-search"
import { BotListItem } from "./bot-list-item"

interface BotSelectionPanelProps {
  bots: BotConfig[]
  selectedBot: string
  searchQuery: string
  onBotSelect: (botId: string) => void
  onSearchChange: (query: string) => void
}

interface FilterState {
  status: string[]
  type: string[]
  exchange: string[]
  profitabilityRange: [number, number]
}

type SortOption = "name" | "profitability" | "lastRun" | "status"
type SortDirection = "asc" | "desc"

export function BotSelectionPanel({
  bots,
  selectedBot,
  searchQuery,
  onBotSelect,
  onSearchChange,
}: BotSelectionPanelProps) {
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOption, setSortOption] = useState<SortOption>("name")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [filters, setFilters] = useState<FilterState>({
    status: [],
    type: [],
    exchange: [],
    profitabilityRange: [-100, 100],
  })

  // Get unique values for filter options
  const uniqueStatuses = [...new Set(bots.map((bot) => bot.status))]
  const uniqueTypes = [...new Set(bots.map((bot) => bot.type))]
  const uniqueExchanges = [...new Set(bots.map((bot) => bot.exchange))]

  // Apply filters to bots
  const filteredBots = bots.filter((bot) => {
    // Search query filter
    if (
      searchQuery &&
      !bot.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !bot.pair.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !bot.exchange.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false
    }

    // Status filter
    if (filters.status.length > 0 && !filters.status.includes(bot.status)) {
      return false
    }

    // Type filter
    if (filters.type.length > 0 && !filters.type.includes(bot.type)) {
      return false
    }

    // Exchange filter
    if (filters.exchange.length > 0 && !filters.exchange.includes(bot.exchange)) {
      return false
    }

    // Profitability range filter
    if (bot.profitability < filters.profitabilityRange[0] || bot.profitability > filters.profitabilityRange[1]) {
      return false
    }

    return true
  })

  // Apply sorting to filtered bots
  const sortedBots = [...filteredBots].sort((a, b) => {
    let comparison = 0

    switch (sortOption) {
      case "name":
        comparison = a.name.localeCompare(b.name)
        break
      case "profitability":
        comparison = a.profitability - b.profitability
        break
      case "lastRun":
        // Simple string comparison for demo - in real app you'd parse dates
        comparison = a.lastRun.localeCompare(b.lastRun)
        break
      case "status":
        comparison = a.status.localeCompare(b.status)
        break
    }

    return sortDirection === "asc" ? comparison : -comparison
  })

  const handleFilter = () => {
    setFilterOpen(true)
  }

  const handleSort = (option: SortOption) => {
    if (sortOption === option) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortOption(option)
      setSortDirection("asc")
    }
  }

  const handleFilterChange = (key: keyof FilterState, value: any) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const clearFilters = () => {
    setFilters({
      status: [],
      type: [],
      exchange: [],
      profitabilityRange: [-100, 100],
    })
  }

  const hasActiveFilters =
    filters.status.length > 0 ||
    filters.type.length > 0 ||
    filters.exchange.length > 0 ||
    filters.profitabilityRange[0] !== -100 ||
    filters.profitabilityRange[1] !== 100

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Trading Bots</CardTitle>
        <CardDescription>Select a bot to configure</CardDescription>
        <BotSearch value={searchQuery} onChange={onSearchChange} />
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="px-4 pb-4 space-y-2">
            {sortedBots.map((bot) => (
              <BotListItem
                key={bot.id}
                bot={bot}
                isSelected={selectedBot === bot.id}
                onClick={() => onBotSelect(bot.id)}
              />
            ))}
            {sortedBots.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Bot className="h-12 w-12 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No bots found</p>
                <p className="text-xs text-muted-foreground">
                  {searchQuery || hasActiveFilters
                    ? "Try adjusting your search or filters"
                    : "Try a different search term"}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>

      {/* Filter and Sort Controls */}
      <div className="flex justify-between border-t p-4">
        <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" onClick={handleFilter}>
              <Filter className="mr-2 h-4 w-4" />
              Filter
              {hasActiveFilters && (
                <span className="ml-1 bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-xs">
                  {filters.status.length +
                    filters.type.length +
                    filters.exchange.length +
                    (filters.profitabilityRange[0] !== -100 || filters.profitabilityRange[1] !== 100 ? 1 : 0)}
                </span>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Filter Bots</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              {/* Status Filter */}
              <div className="space-y-2">
                <Label>Status</Label>
                <div className="space-y-2">
                  {uniqueStatuses.map((status) => (
                    <div key={status} className="flex items-center space-x-2">
                      <Checkbox
                        id={`status-${status}`}
                        checked={filters.status.includes(status)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            handleFilterChange("status", [...filters.status, status])
                          } else {
                            handleFilterChange(
                              "status",
                              filters.status.filter((s) => s !== status),
                            )
                          }
                        }}
                      />
                      <Label htmlFor={`status-${status}`} className="capitalize">
                        {status}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Type Filter */}
              <div className="space-y-2">
                <Label>Bot Type</Label>
                <div className="space-y-2">
                  {uniqueTypes.map((type) => (
                    <div key={type} className="flex items-center space-x-2">
                      <Checkbox
                        id={`type-${type}`}
                        checked={filters.type.includes(type)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            handleFilterChange("type", [...filters.type, type])
                          } else {
                            handleFilterChange(
                              "type",
                              filters.type.filter((t) => t !== type),
                            )
                          }
                        }}
                      />
                      <Label htmlFor={`type-${type}`}>{type}</Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Exchange Filter */}
              <div className="space-y-2">
                <Label>Exchange</Label>
                <div className="space-y-2">
                  {uniqueExchanges.map((exchange) => (
                    <div key={exchange} className="flex items-center space-x-2">
                      <Checkbox
                        id={`exchange-${exchange}`}
                        checked={filters.exchange.includes(exchange)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            handleFilterChange("exchange", [...filters.exchange, exchange])
                          } else {
                            handleFilterChange(
                              "exchange",
                              filters.exchange.filter((e) => e !== exchange),
                            )
                          }
                        }}
                      />
                      <Label htmlFor={`exchange-${exchange}`}>{exchange}</Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Profitability Range Filter */}
              <div className="space-y-2">
                <Label>Profitability Range (%)</Label>
                <div className="px-2">
                  <Slider
                    value={filters.profitabilityRange}
                    onValueChange={(value) => handleFilterChange("profitabilityRange", value as [number, number])}
                    min={-100}
                    max={100}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-sm text-muted-foreground mt-1">
                    <span>{filters.profitabilityRange[0]}%</span>
                    <span>{filters.profitabilityRange[1]}%</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={clearFilters}>
                  Clear All
                </Button>
                <Button onClick={() => setFilterOpen(false)}>Apply Filters</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <ArrowUpDown className="mr-2 h-4 w-4" />
              Sort
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleSort("name")}>
              Name {sortOption === "name" && (sortDirection === "asc" ? "↑" : "↓")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleSort("profitability")}>
              Profitability {sortOption === "profitability" && (sortDirection === "asc" ? "↑" : "↓")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleSort("lastRun")}>
              Last Run {sortOption === "lastRun" && (sortDirection === "asc" ? "↑" : "↓")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleSort("status")}>
              Status {sortOption === "status" && (sortDirection === "asc" ? "↑" : "↓")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  )
}
