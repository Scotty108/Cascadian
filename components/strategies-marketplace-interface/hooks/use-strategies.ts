"use client"

import { useState, useCallback } from "react"
import type { Strategy } from "../types"
import { mockStrategies } from "../data"

export const useStrategies = () => {
  const [strategies, setStrategies] = useState<Strategy[]>(mockStrategies)

  const toggleFavorite = useCallback((strategyId: string) => {
    setStrategies((prev) =>
      prev.map((strategy) =>
        strategy.id === strategyId ? { ...strategy, isFavorite: !strategy.isFavorite } : strategy,
      ),
    )
  }, [])

  const purchaseStrategy = useCallback((strategyId: string) => {
    setStrategies((prev) =>
      prev.map((strategy) => (strategy.id === strategyId ? { ...strategy, isPurchased: true } : strategy)),
    )
  }, [])

  return {
    strategies,
    toggleFavorite,
    purchaseStrategy,
  }
}
