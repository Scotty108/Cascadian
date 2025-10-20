"use client"

import { useState, useMemo } from "react"
import type { TemplateFilters, BotTemplate } from "../types"
import { filterTemplates, sortTemplates } from "../utils"

const initialFilters: TemplateFilters = {
  searchQuery: "",
  selectedCategory: "all",
  selectedType: "all",
  selectedComplexity: "all",
  sortBy: "popular",
  activeTab: "all",
}

export const useFilters = (templates: BotTemplate[]) => {
  const [filters, setFilters] = useState<TemplateFilters>(initialFilters)
  const [showFilters, setShowFilters] = useState(false)

  const filteredAndSortedTemplates = useMemo(() => {
    const filtered = filterTemplates(templates, filters)
    return sortTemplates(filtered, filters.sortBy)
  }, [templates, filters])

  const updateFilter = (key: keyof TemplateFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const resetFilters = () => {
    setFilters(initialFilters)
  }

  const hasActiveFilters = useMemo(() => {
    return filters.selectedCategory !== "all" || filters.selectedType !== "all" || filters.selectedComplexity !== "all"
  }, [filters])

  return {
    filters,
    filteredAndSortedTemplates,
    showFilters,
    setShowFilters,
    updateFilter,
    resetFilters,
    hasActiveFilters,
  }
}
