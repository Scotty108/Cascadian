"use client"

import { useState, useMemo, useCallback } from "react"
import type { ViewState, FilterState } from "../types"
import { assetsData, defiPositionsData, nftCollectionsData, transactionHistoryData } from "../data"
import { filterAssets, filterDeFiPositions, filterTransactions } from "../utils"
import { toast } from "@/hooks/use-toast"
import type { PortfolioSettings } from "../components/modals/settings-modal"

const defaultSettings: PortfolioSettings = {
  currency: "USD",
  theme: "system",
  compactView: false,
  showSmallBalances: true,
  hideZeroBalances: false,
  priceAlerts: true,
  portfolioAlerts: true,
  newsAlerts: false,
  emailNotifications: true,
  pushNotifications: false,
  hideBalances: false,
  anonymousMode: false,
  autoRefresh: true,
  refreshInterval: 30,
  syncAcrossDevices: true,
  rpcEndpoints: {},
  customTokens: [],
  priceChangeThreshold: 10,
  portfolioChangeThreshold: 5,
}

export function usePortfolio() {
  const [viewState, setViewState] = useState<ViewState>({
    timeRange: "1Y",
    viewMode: "grid",
    activeTab: "assets",
  })

  const [filters, setFilters] = useState<FilterState>({
    search: "",
    assetFilter: "all",
    transactionType: "all",
    positionType: "all",
    chain: "all",
    dateRange: {
      from: "",
      to: "",
    },
  })

  const [settings, setSettings] = useState<PortfolioSettings>(defaultSettings)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const filteredAssets = useMemo(() => filterAssets(assetsData, filters), [filters])

  const filteredDeFiPositions = useMemo(() => filterDeFiPositions(defiPositionsData, filters), [filters])

  const filteredTransactions = useMemo(() => filterTransactions(transactionHistoryData, filters), [filters])

  const updateViewState = (updates: Partial<ViewState>) => {
    setViewState((prev) => ({ ...prev, ...updates }))
  }

  const updateFilters = (updates: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  const resetFilters = () => {
    setFilters({
      search: "",
      assetFilter: "all",
      transactionType: "all",
      positionType: "all",
      chain: "all",
      dateRange: {
        from: "",
        to: "",
      },
    })
  }

  const refreshData = useCallback(async () => {
    setIsRefreshing(true)
    try {
      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // In a real app, you would fetch fresh data here
      // const freshData = await fetchPortfolioData()

      setLastRefresh(new Date())
      toast({
        title: "Portfolio refreshed",
        description: "Your portfolio data has been updated with the latest information.",
      })
    } catch (error) {
      toast({
        title: "Refresh failed",
        description: "Failed to refresh portfolio data. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  const updateSettings = useCallback((newSettings: PortfolioSettings) => {
    setSettings(newSettings)
    // In a real app, you would save settings to backend/localStorage
    localStorage.setItem("portfolio-settings", JSON.stringify(newSettings))
  }, [])

  return {
    viewState,
    filters,
    settings,
    filteredAssets,
    filteredDeFiPositions,
    filteredTransactions,
    nftCollections: nftCollectionsData,
    isRefreshing,
    lastRefresh,
    updateViewState,
    updateFilters,
    updateSettings,
    resetFilters,
    refreshData,
  }
}
