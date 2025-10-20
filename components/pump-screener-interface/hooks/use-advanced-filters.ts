"use client"

import { useState, useMemo, useCallback } from "react"
import type { PumpAlert, FilterParams } from "../types"

interface CustomFilters {
  minMarketCap?: number
  maxMarketCap?: number
  minVolume24h?: number
  maxVolume24h?: number
  minSocialMentions?: number
  patternTypes: string[]
  excludeSymbols: string[]
}

export function useAdvancedFilters(alerts: PumpAlert[], filterParams: FilterParams) {
  const [searchQuery, setSearchQuery] = useState("")
  const [sortBy, setSortBy] = useState<"timestamp" | "priceChange" | "volumeChange" | "confidence" | "risk">(
    "timestamp",
  )
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [showFavorites, setShowFavorites] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [customFilters, setCustomFilters] = useState<CustomFilters>({
    patternTypes: [],
    excludeSymbols: [],
  })

  // Filter and sort alerts
  const filteredAlerts = useMemo(() => {
    const filtered = alerts.filter((alert) => {
      // Basic filters
      if (alert.priceChange < filterParams.minPriceChange) return false
      if (alert.volumeChange < filterParams.minVolumeChange) return false
      if (filterParams.timeFrame !== "all" && alert.timeFrame !== filterParams.timeFrame) return false
      if (filterParams.riskLevel !== "all" && alert.risk !== filterParams.riskLevel) return false
      if (!filterParams.exchanges.includes("all") && !filterParams.exchanges.includes(alert.exchange)) return false

      // Search query
      if (
        searchQuery &&
        !alert.symbol.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !alert.exchange.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !alert.patternType.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false
      }

      // Custom filters
      if (customFilters.minMarketCap && alert.marketCap < customFilters.minMarketCap) return false
      if (customFilters.maxMarketCap && alert.marketCap > customFilters.maxMarketCap) return false
      if (customFilters.minVolume24h && alert.volume24h < customFilters.minVolume24h) return false
      if (customFilters.maxVolume24h && alert.volume24h > customFilters.maxVolume24h) return false
      if (customFilters.minSocialMentions && alert.socialMentions < customFilters.minSocialMentions) return false
      if (customFilters.patternTypes.length > 0 && !customFilters.patternTypes.includes(alert.patternType)) return false
      if (customFilters.excludeSymbols.includes(alert.symbol)) return false

      // Favorites filter
      if (showFavorites && !favorites.has(alert.symbol)) return false

      return true
    })

    // Sort
    filtered.sort((a, b) => {
      let aVal: any, bVal: any

      switch (sortBy) {
        case "priceChange":
          aVal = a.priceChange
          bVal = b.priceChange
          break
        case "volumeChange":
          aVal = a.volumeChange
          bVal = b.volumeChange
          break
        case "confidence":
          aVal = a.confidence
          bVal = b.confidence
          break
        case "risk":
          const riskOrder = { low: 1, medium: 2, high: 3, "very high": 4 }
          aVal = riskOrder[a.risk]
          bVal = riskOrder[b.risk]
          break
        default:
          aVal = a.timestamp
          bVal = b.timestamp
      }

      if (sortOrder === "asc") {
        return aVal > bVal ? 1 : -1
      } else {
        return aVal < bVal ? 1 : -1
      }
    })

    return filtered
  }, [alerts, filterParams, searchQuery, sortBy, sortOrder, showFavorites, favorites, customFilters])

  // Filter stats
  const filterStats = useMemo(() => {
    const activeFiltersCount = [
      filterParams.minPriceChange > 0,
      filterParams.minVolumeChange > 0,
      filterParams.timeFrame !== "all",
      filterParams.riskLevel !== "all",
      !filterParams.exchanges.includes("all"),
      searchQuery.length > 0,
      customFilters.minMarketCap !== undefined,
      customFilters.maxMarketCap !== undefined,
      customFilters.minVolume24h !== undefined,
      customFilters.maxVolume24h !== undefined,
      customFilters.minSocialMentions !== undefined,
      customFilters.patternTypes.length > 0,
      customFilters.excludeSymbols.length > 0,
      showFavorites,
    ].filter(Boolean).length

    return {
      totalAlerts: alerts.length,
      filteredAlerts: filteredAlerts.length,
      activeFiltersCount,
    }
  }, [alerts.length, filteredAlerts.length, filterParams, searchQuery, customFilters, showFavorites])

  // Actions
  const updateSearchQuery = useCallback((query: string) => {
    setSearchQuery(query)
  }, [])

  const updateSorting = useCallback(
    (newSortBy: typeof sortBy, newSortOrder?: "asc" | "desc") => {
      if (newSortBy === sortBy) {
        setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
      } else {
        setSortBy(newSortBy)
        setSortOrder(newSortOrder || "desc")
      }
    },
    [sortBy],
  )

  const updateCustomFilters = useCallback((updates: Partial<CustomFilters>) => {
    setCustomFilters((prev) => ({ ...prev, ...updates }))
  }, [])

  const toggleFavorite = useCallback((symbol: string) => {
    setFavorites((prev) => {
      const newFavorites = new Set(prev)
      if (newFavorites.has(symbol)) {
        newFavorites.delete(symbol)
      } else {
        newFavorites.add(symbol)
      }
      return newFavorites
    })
  }, [])

  const toggleShowFavorites = useCallback(() => {
    setShowFavorites((prev) => !prev)
  }, [])

  const clearAllFilters = useCallback(() => {
    setSearchQuery("")
    setShowFavorites(false)
    setCustomFilters({
      patternTypes: [],
      excludeSymbols: [],
    })
  }, [])

  return {
    filteredAlerts,
    searchQuery,
    sortBy,
    sortOrder,
    showFavorites,
    customFilters,
    favorites,
    filterStats,
    updateSearchQuery,
    updateSorting,
    updateCustomFilters,
    toggleFavorite,
    toggleShowFavorites,
    clearAllFilters,
  }
}
