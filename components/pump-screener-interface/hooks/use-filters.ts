"use client"

import { useState, useCallback } from "react"
import type { FilterParams } from "../types"

export function useFilters() {
  const [filterParams, setFilterParams] = useState<FilterParams>({
    minPriceChange: 3,
    minVolumeChange: 200,
    timeFrame: "all",
    riskLevel: "all",
    exchanges: ["all"],
  })

  const updateFilterParams = useCallback((updates: Partial<FilterParams>) => {
    setFilterParams((prev) => ({ ...prev, ...updates }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilterParams({
      minPriceChange: 3,
      minVolumeChange: 200,
      timeFrame: "all",
      riskLevel: "all",
      exchanges: ["all"],
    })
  }, [])

  return {
    filterParams,
    updateFilterParams,
    resetFilters,
  }
}
