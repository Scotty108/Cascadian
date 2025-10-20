"use client"

import { useState, useEffect, useMemo } from "react"
import type { Protocol, ProtocolFilters, SortConfig } from "../types"
import { PROTOCOLS } from "../constants"

export function useProtocols() {
  const [filters, setFilters] = useState<ProtocolFilters>({
    category: "All",
    chain: "all",
    searchQuery: "",
    showOnlyFavorites: false,
    showOnlyAudited: false,
    riskFilter: [],
  })

  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: "tvl",
    order: "desc",
  })

  const [favorites, setFavorites] = useState<string[]>(PROTOCOLS.filter((p) => p.favorite).map((p) => p.id))

  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Simulate loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 1000)
    return () => clearTimeout(timer)
  }, [])

  const filteredProtocols = useMemo(() => {
    let result = [...PROTOCOLS]

    // Filter by search query
    if (filters.searchQuery) {
      result = result.filter(
        (protocol) =>
          protocol.name.toLowerCase().includes(filters.searchQuery.toLowerCase()) ||
          protocol.category.toLowerCase().includes(filters.searchQuery.toLowerCase()),
      )
    }

    // Filter by category
    if (filters.category !== "All") {
      result = result.filter((protocol) => protocol.category === filters.category)
    }

    // Filter by chain
    if (filters.chain !== "all") {
      result = result.filter((protocol) => protocol.chains.includes(filters.chain))
    }

    // Filter by favorites
    if (filters.showOnlyFavorites) {
      result = result.filter((protocol) => favorites.includes(protocol.id))
    }

    // Filter by audit status
    if (filters.showOnlyAudited) {
      result = result.filter((protocol) => protocol.audited)
    }

    // Filter by risk level
    if (filters.riskFilter.length > 0) {
      result = result.filter((protocol) => filters.riskFilter.includes(protocol.risk))
    }

    // Sort protocols
    result.sort((a, b) => {
      let valueA: any, valueB: any

      switch (sortConfig.field) {
        case "name":
          valueA = a.name
          valueB = b.name
          break
        case "tvl":
          valueA = a.tvl
          valueB = b.tvl
          break
        case "tvlChange":
          valueA = a.tvlChange
          valueB = b.tvlChange
          break
        case "apy":
          valueA = a.apy
          valueB = b.apy
          break
        default:
          valueA = a.tvl
          valueB = b.tvl
      }

      if (sortConfig.order === "asc") {
        return valueA > valueB ? 1 : -1
      } else {
        return valueA < valueB ? 1 : -1
      }
    })

    return result
  }, [filters, sortConfig, favorites])

  const toggleSortOrder = (field: string) => {
    if (sortConfig.field === field) {
      setSortConfig({
        field,
        order: sortConfig.order === "asc" ? "desc" : "asc",
      })
    } else {
      setSortConfig({
        field,
        order: "desc",
      })
    }
  }

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id)
      } else {
        return [...prev, id]
      }
    })
  }

  const toggleRiskFilter = (risk: string) => {
    setFilters((prev) => ({
      ...prev,
      riskFilter: prev.riskFilter.includes(risk)
        ? prev.riskFilter.filter((item) => item !== risk)
        : [...prev.riskFilter, risk],
    }))
  }

  const updateFilters = (newFilters: Partial<ProtocolFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
  }

  const getProtocolDetails = (id: string): Protocol | undefined => {
    return PROTOCOLS.find((protocol) => protocol.id === id)
  }

  return {
    protocols: filteredProtocols,
    filters,
    sortConfig,
    favorites,
    selectedProtocol,
    isLoading,
    updateFilters,
    toggleSortOrder,
    toggleFavorite,
    toggleRiskFilter,
    setSelectedProtocol,
    getProtocolDetails,
  }
}
