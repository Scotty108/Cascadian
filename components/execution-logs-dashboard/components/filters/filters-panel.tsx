"use client"

import { ChevronDown, ChevronUp, Filter, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SearchInput } from "./search-input"
import { LevelSelector } from "./level-selector"
import { DateRangePicker } from "./date-range-picker"
import { AdvancedFilters } from "./advanced-filters"
import type { FilterState } from "../../types"

interface FiltersPanelProps {
  filters: FilterState
  onFilterChange: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void
  onResetFilters: () => void
  hasActiveFilters: boolean
}

export const FiltersPanel = ({ filters, onFilterChange, onResetFilters, hasActiveFilters }: FiltersPanelProps) => {
  const activeFilterCount = [
    filters.search,
    filters.level !== "all" ? filters.level : null,
    filters.status !== "all" ? filters.status : null,
    filters.botId !== "all" ? filters.botId : null,
    filters.action !== "all" ? filters.action : null,
    filters.exchange !== "all" ? filters.exchange : null,
    filters.dateRange.from,
    filters.dateRange.to,
  ].filter(Boolean).length

  return (
    <div className="space-y-4 mb-6">
      {/* Main Filters */}
      <div className="flex flex-wrap gap-3">
        <SearchInput
          value={filters.search}
          onChange={(value) => onFilterChange("search", value)}
          className="min-w-64"
        />

        <LevelSelector value={filters.level} onChange={(value) => onFilterChange("level", value)} className="w-32" />

        <DateRangePicker
          from={filters.dateRange.from}
          to={filters.dateRange.to}
          onDateRangeChange={(from, to) => onFilterChange("dateRange", { from, to })}
          className="w-48"
        />

        <Collapsible open={filters.showAdvanced} onOpenChange={(open) => onFilterChange("showAdvanced", open)}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="w-4 h-4 mr-2" />
              Advanced
              {filters.showAdvanced ? <ChevronUp className="w-4 h-4 ml-2" /> : <ChevronDown className="w-4 h-4 ml-2" />}
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-3">
            <AdvancedFilters filters={filters} onFilterChange={onFilterChange} />
          </CollapsibleContent>
        </Collapsible>

        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={onResetFilters} className="text-red-600 hover:text-red-700">
            <X className="w-4 h-4 mr-2" />
            Clear All
          </Button>
        )}
      </div>

      {/* Active Filters Summary */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Active filters:</span>
          <Badge variant="secondary">
            {activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} applied
          </Badge>
        </div>
      )}
    </div>
  )
}
