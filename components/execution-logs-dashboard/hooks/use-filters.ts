"use client"

import { useState, useMemo, useCallback } from "react"
import type { ExecutionLog, FilterState, UseFiltersReturn } from "../types"
import { DEFAULT_FILTERS } from "../constants"
import { filterLogs } from "../utils"

export const useFilters = (logs: ExecutionLog[]): UseFiltersReturn => {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)

  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
  }, [])

  const filteredLogs = useMemo(() => {
    return filterLogs(logs, filters)
  }, [logs, filters])

  const hasActiveFilters = useMemo(() => {
    return (
      filters.search !== "" ||
      filters.level !== "all" ||
      filters.status !== "all" ||
      filters.botId !== "all" ||
      filters.action !== "all" ||
      filters.exchange !== "all" ||
      filters.dateRange.from !== null ||
      filters.dateRange.to !== null
    )
  }, [filters])

  return {
    filters,
    updateFilter,
    resetFilters,
    filteredLogs,
    hasActiveFilters,
  }
}
