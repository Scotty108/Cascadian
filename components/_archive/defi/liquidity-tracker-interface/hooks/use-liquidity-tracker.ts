"use client"

import { useState, useCallback, useMemo } from "react"
import type { LiquidityTrackerState, FilterState, CalculatorState } from "../types"
import { topLiquidityPools, myLiquidityPositions } from "../data"
import { filterPools, sortPools, calculatePortfolioMetrics } from "../utils"

const initialFilters: FilterState = {
  selectedChain: "all",
  selectedProtocol: "all",
  timeRange: "1m",
  showAdvancedFilters: false,
  minTvl: "0",
  minApy: "0",
  riskLevel: "all",
  tokenPair: "",
  feeTier: "all",
  slippageTolerance: [0.5],
}

const initialCalculator: CalculatorState = {
  investmentAmount: "1000",
  token1Amount: "0.5",
  token2Amount: "1000",
  priceImpact: "-2.1%",
  estimatedFees: "$12.5",
  autocompound: true,
  selectedPool: "uniswap-v3",
  timePeriod: "30",
  minPrice: "1800",
  maxPrice: "2200",
}

export const useLiquidityTracker = () => {
  const [state, setState] = useState<LiquidityTrackerState>({
    activeTab: "overview",
    filters: initialFilters,
    calculator: initialCalculator,
    isLoading: false,
    selectedPools: [],
    favoriteOpportunities: [],
  })

  const updateFilters = useCallback((updates: Partial<FilterState>) => {
    setState((prev) => ({
      ...prev,
      filters: { ...prev.filters, ...updates },
    }))
  }, [])

  const updateCalculator = useCallback((updates: Partial<CalculatorState>) => {
    setState((prev) => ({
      ...prev,
      calculator: { ...prev.calculator, ...updates },
    }))
  }, [])

  const setActiveTab = useCallback((tab: string) => {
    setState((prev) => ({ ...prev, activeTab: tab }))
  }, [])

  const toggleAdvancedFilters = useCallback(() => {
    setState((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        showAdvancedFilters: !prev.filters.showAdvancedFilters,
      },
    }))
  }, [])

  const resetFilters = useCallback(() => {
    setState((prev) => ({
      ...prev,
      filters: initialFilters,
    }))
  }, [])

  const togglePoolSelection = useCallback((poolId: number) => {
    setState((prev) => ({
      ...prev,
      selectedPools: prev.selectedPools.includes(poolId)
        ? prev.selectedPools.filter((id) => id !== poolId)
        : [...prev.selectedPools, poolId],
    }))
  }, [])

  const toggleFavoriteOpportunity = useCallback((opportunityId: number) => {
    setState((prev) => ({
      ...prev,
      favoriteOpportunities: prev.favoriteOpportunities.includes(opportunityId)
        ? prev.favoriteOpportunities.filter((id) => id !== opportunityId)
        : [...prev.favoriteOpportunities, opportunityId],
    }))
  }, [])

  const filteredPools = useMemo(() => {
    return filterPools(topLiquidityPools, {
      chain: state.filters.selectedChain,
      protocol: state.filters.selectedProtocol,
      minTvl: state.filters.minTvl,
      minApy: state.filters.minApy,
      riskLevel: state.filters.riskLevel,
      tokenPair: state.filters.tokenPair,
      feeTier: state.filters.feeTier,
    })
  }, [state.filters])

  const sortedPools = useMemo(() => {
    return sortPools(filteredPools, "tvl", "desc")
  }, [filteredPools])

  const portfolioMetrics = useMemo(() => {
    return calculatePortfolioMetrics(myLiquidityPositions)
  }, [])

  return {
    state,
    updateFilters,
    updateCalculator,
    setActiveTab,
    toggleAdvancedFilters,
    resetFilters,
    togglePoolSelection,
    toggleFavoriteOpportunity,
    filteredPools,
    sortedPools,
    portfolioMetrics,
  }
}
