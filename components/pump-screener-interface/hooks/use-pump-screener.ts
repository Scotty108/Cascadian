"use client"

import { useState, useCallback } from "react"
import type { FilterParams } from "../types"
import { mockPumpAlerts, mockWatchlist, mockHistoricalPumps, mockMarketOverview } from "../data"

export function usePumpScreener() {
  const [activeTab, setActiveTab] = useState("live-scanner")
  const [refreshing, setRefreshing] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<number | null>(null)

  const [filterParams, setFilterParams] = useState<FilterParams>({
    minPriceChange: 3,
    minVolumeChange: 200,
    timeFrame: "all",
    riskLevel: "all",
    exchanges: ["all"],
  })

  // Simulate refresh
  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setTimeout(() => {
      setRefreshing(false)
    }, 1500)
  }, [])

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    setFullscreen(!fullscreen)
  }, [fullscreen])

  // Update filter parameters
  const updateFilterParams = useCallback((updates: Partial<FilterParams>) => {
    setFilterParams((prev) => ({ ...prev, ...updates }))
  }, [])

  return {
    // State
    activeTab,
    refreshing,
    fullscreen,
    selectedAlert,
    filterParams,

    // Data
    pumpAlerts: mockPumpAlerts,
    watchlist: mockWatchlist,
    historicalPumps: mockHistoricalPumps,
    marketOverview: mockMarketOverview,

    // Actions
    setActiveTab,
    setSelectedAlert,
    handleRefresh,
    toggleFullscreen,
    updateFilterParams,
  }
}
