"use client"

import { useState, useCallback } from "react"
import type { Strategy } from "../types"

export interface NewStrategyData {
  name: string
  description: string
  risk: "low" | "medium" | "high"
  timeframe: string
  conditions: string
  entryRules: string[]
  exitRules: string[]
  indicators: string[]
}

export function useStrategies(initialStrategies: Strategy[]) {
  const [strategies, setStrategies] = useState<Strategy[]>(initialStrategies)

  // Generate unique ID for new strategies
  const generateId = useCallback(() => {
    return `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }, [])

  // Add new strategy
  const addStrategy = useCallback(
    (strategyData: NewStrategyData) => {
      const newStrategy: Strategy = {
        id: generateId(),
        name: strategyData.name,
        description: strategyData.description,
        risk: strategyData.risk,
        timeframe: strategyData.timeframe,
        active: false,
      }

      setStrategies((prev) => [...prev, newStrategy])
      return newStrategy
    },
    [generateId],
  )

  // Edit existing strategy
  const editStrategy = useCallback((strategyId: string, updates: Partial<Strategy>) => {
    setStrategies((prev) =>
      prev.map((strategy) => (strategy.id === strategyId ? { ...strategy, ...updates } : strategy)),
    )
  }, [])

  // Delete strategy
  const deleteStrategy = useCallback((strategyId: string) => {
    setStrategies((prev) => prev.filter((strategy) => strategy.id !== strategyId))
  }, [])

  // Copy/Clone strategy
  const cloneStrategy = useCallback(
    (strategyId: string) => {
      const originalStrategy = strategies.find((s) => s.id === strategyId)
      if (!originalStrategy) return null

      const clonedStrategy: Strategy = {
        ...originalStrategy,
        id: generateId(),
        name: `${originalStrategy.name} (Copy)`,
        active: false, // New cloned strategies start inactive
      }

      setStrategies((prev) => [...prev, clonedStrategy])
      return clonedStrategy
    },
    [strategies, generateId],
  )

  // Toggle strategy active status
  const toggleStrategyStatus = useCallback((strategyId: string, active: boolean) => {
    setStrategies((prev) => prev.map((strategy) => (strategy.id === strategyId ? { ...strategy, active } : strategy)))
  }, [])

  // Bulk operations
  const deleteMultipleStrategies = useCallback((strategyIds: string[]) => {
    setStrategies((prev) => prev.filter((strategy) => !strategyIds.includes(strategy.id)))
  }, [])

  const activateMultipleStrategies = useCallback((strategyIds: string[]) => {
    setStrategies((prev) =>
      prev.map((strategy) => (strategyIds.includes(strategy.id) ? { ...strategy, active: true } : strategy)),
    )
  }, [])

  const deactivateMultipleStrategies = useCallback((strategyIds: string[]) => {
    setStrategies((prev) =>
      prev.map((strategy) => (strategyIds.includes(strategy.id) ? { ...strategy, active: false } : strategy)),
    )
  }, [])

  return {
    strategies,
    addStrategy,
    editStrategy,
    deleteStrategy,
    cloneStrategy,
    toggleStrategyStatus,
    deleteMultipleStrategies,
    activateMultipleStrategies,
    deactivateMultipleStrategies,
  }
}
