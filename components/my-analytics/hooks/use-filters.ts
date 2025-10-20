"use client"

import { useState } from "react"
import type { FilterCategory, FilterItem, Filters } from "../types"

export function useFilters() {
  const [filters, setFilters] = useState<Filters>({
    profitability: {
      profitable: true,
      unprofitable: true,
    },
    status: {
      active: true,
      paused: true,
      stopped: false,
    },
    timeframe: {
      day: true,
      week: true,
      month: true,
      year: true,
    },
  })

  const handleFilterChange = (category: FilterCategory, item: FilterItem) => {
    setFilters((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        [item]: !prev[category][item as keyof (typeof prev)[typeof category]],
      },
    }))
  }

  const resetFilters = () => {
    setFilters({
      profitability: {
        profitable: true,
        unprofitable: true,
      },
      status: {
        active: true,
        paused: true,
        stopped: true,
      },
      timeframe: {
        day: true,
        week: true,
        month: true,
        year: true,
      },
    })
  }

  return {
    filters,
    handleFilterChange,
    resetFilters,
  }
}
