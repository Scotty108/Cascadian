"use client"

import { useState, useMemo } from "react"
import type { FilterState } from "../types"
import { mockAssets, mockAccounts } from "../data"
import { filterAssets, filterAccounts, calculateTotalPortfolioValue } from "../utils"
import { DEFAULT_DATE_RANGE } from "../constants"

export const useOverviewDashboard = () => {
  const [dateRange, setDateRange] = useState(DEFAULT_DATE_RANGE)
  const [filters, setFilters] = useState<FilterState>({
    assetSearch: "",
    accountSearch: "",
    assetType: "all",
    accountType: "all",
  })

  const filteredAssets = useMemo(
    () => filterAssets(mockAssets, filters.assetSearch, filters.assetType),
    [filters.assetSearch, filters.assetType],
  )

  const filteredAccounts = useMemo(
    () => filterAccounts(mockAccounts, filters.accountSearch, filters.accountType),
    [filters.accountSearch, filters.accountType],
  )

  const totalPortfolioValue = useMemo(() => calculateTotalPortfolioValue(mockAssets), [])

  const updateFilter = (key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const clearFilters = () => {
    setFilters({
      assetSearch: "",
      accountSearch: "",
      assetType: "all",
      accountType: "all",
    })
  }

  return {
    dateRange,
    setDateRange,
    filters,
    updateFilter,
    clearFilters,
    filteredAssets,
    filteredAccounts,
    totalPortfolioValue,
    allAssets: mockAssets,
    allAccounts: mockAccounts,
  }
}
