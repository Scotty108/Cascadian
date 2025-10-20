"use client"

import { useState, useEffect, useCallback } from "react"
import { stakingPools as initialPools } from "../data"
import { filterPools } from "../utils"
import type { StakingPool, FilterState } from "../types"

export const useStakingPools = () => {
  const [pools, setPools] = useState<StakingPool[]>(initialPools)
  const [filteredPools, setFilteredPools] = useState<StakingPool[]>(initialPools)

  const [filters, setFilters] = useState<FilterState>({
    searchQuery: "",
    selectedChains: [],
    selectedRiskLevels: [],
    selectedStakingTypes: [],
    minApy: 0,
    showLiquidStakingOnly: false,
    showVerifiedOnly: false,
    showNoLockOnly: false,
    sortBy: "apy",
    sortOrder: "desc",
  })

  // Apply filters whenever filters or pools change
  useEffect(() => {
    const filtered = filterPools(pools, filters)
    setFilteredPools(filtered)
  }, [pools, filters])

  const updateFilters = useCallback((newFilters: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilters({
      searchQuery: "",
      selectedChains: [],
      selectedRiskLevels: [],
      selectedStakingTypes: [],
      minApy: 0,
      showLiquidStakingOnly: false,
      showVerifiedOnly: false,
      showNoLockOnly: false,
      sortBy: "apy",
      sortOrder: "desc",
    })
  }, [])

  const toggleFavorite = useCallback((poolId: string) => {
    setPools((prevPools) =>
      prevPools.map((pool) => (pool.id === poolId ? { ...pool, isFavorite: !pool.isFavorite } : pool)),
    )
  }, [])

  return {
    pools,
    filteredPools,
    filters,
    updateFilters,
    resetFilters,
    toggleFavorite,
  }
}
