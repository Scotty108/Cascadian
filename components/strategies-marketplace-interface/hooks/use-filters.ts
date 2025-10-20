"use client"

import { useState, useMemo } from "react"
import type { Strategy, FilterState } from "../types"
import { filterStrategies, sortStrategies } from "../utils"

interface UseFiltersProps {
  strategies: Strategy[]
}

export const useFilters = ({ strategies }: UseFiltersProps) => {
  const [filters, setFilters] = useState<FilterState>({
    searchQuery: "",
    selectedCategory: "All",
    selectedPriceRange: "All",
    sortOption: "Most Popular",
    activeTab: "all",
  })

  const filteredAndSortedStrategies = useMemo(() => {
    const filtered = filterStrategies(
      strategies,
      filters.searchQuery,
      filters.selectedCategory,
      filters.selectedPriceRange,
      filters.activeTab,
    )
    return sortStrategies(filtered, filters.sortOption)
  }, [strategies, filters])

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const resetFilters = () => {
    setFilters({
      searchQuery: "",
      selectedCategory: "All",
      selectedPriceRange: "All",
      sortOption: "Most Popular",
      activeTab: "all",
    })
  }

  return {
    filters,
    filteredAndSortedStrategies,
    updateFilter,
    resetFilters,
  }
}
