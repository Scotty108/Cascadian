"use client"

import { useState, useMemo, useCallback } from "react"
import { mockOpportunities, mockArbitrageBots, mockExchanges } from "../data"
import type { GlobalBotStatus, ArbitrageBot } from "../types"

export function useArbitrageDashboard() {
  const [globalBotStatus, setGlobalBotStatus] = useState<GlobalBotStatus>("active")
  const [isCreatingBot, setIsCreatingBot] = useState(false)
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  const [bots, setBots] = useState(mockArbitrageBots)
  const [opportunities, setOpportunities] = useState(mockOpportunities)
  const [exchanges, setExchanges] = useState(mockExchanges)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter opportunities by status
  const activeOpportunities = useMemo(() => opportunities.filter((opp) => opp.status === "active"), [opportunities])

  const completedOpportunities = useMemo(
    () => opportunities.filter((opp) => opp.status === "completed"),
    [opportunities],
  )

  const failedOpportunities = useMemo(() => opportunities.filter((opp) => opp.status === "failed"), [opportunities])

  // Filter bots by status
  const activeBots = useMemo(() => bots.filter((bot) => bot.status === "active"), [bots])

  const pausedBots = useMemo(() => bots.filter((bot) => bot.status === "paused"), [bots])

  const stoppedBots = useMemo(() => bots.filter((bot) => bot.status === "stopped"), [bots])

  // Filter exchanges by status
  const connectedExchanges = useMemo(() => exchanges.filter((exchange) => exchange.status === "connected"), [exchanges])

  const disconnectedExchanges = useMemo(
    () => exchanges.filter((exchange) => exchange.status !== "connected"),
    [exchanges],
  )

  // Get selected bot
  const selectedBot = useMemo(
    () => (selectedBotId ? bots.find((bot) => bot.id === selectedBotId) : null),
    [selectedBotId, bots],
  )

  // Execute opportunity
  const executeOpportunity = useCallback(async (opportunityId: string) => {
    setIsLoading(true)
    setError(null)

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      setOpportunities((prev) =>
        prev.map((opp) =>
          opp.id === opportunityId
            ? { ...opp, status: "completed" as const, executionTime: Math.random() * 2 + 0.5 }
            : opp,
        ),
      )
    } catch (err) {
      setError("Failed to execute opportunity")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Pause bot
  const pauseBot = useCallback(async (botId: string) => {
    setIsLoading(true)
    setError(null)

    try {
      await new Promise((resolve) => setTimeout(resolve, 500))

      setBots((prev) => prev.map((bot) => (bot.id === botId ? { ...bot, status: "paused" as const } : bot)))
    } catch (err) {
      setError("Failed to pause bot")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Resume bot
  const resumeBot = useCallback(async (botId: string) => {
    setIsLoading(true)
    setError(null)

    try {
      await new Promise((resolve) => setTimeout(resolve, 500))

      setBots((prev) =>
        prev.map((bot) => (bot.id === botId ? { ...bot, status: "active" as const, lastActive: new Date() } : bot)),
      )
    } catch (err) {
      setError("Failed to resume bot")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Delete bot
  const deleteBot = useCallback(
    async (botId: string) => {
      setIsLoading(true)
      setError(null)

      try {
        await new Promise((resolve) => setTimeout(resolve, 500))

        setBots((prev) => prev.filter((bot) => bot.id !== botId))

        if (selectedBotId === botId) {
          setSelectedBotId(null)
        }
      } catch (err) {
        setError("Failed to delete bot")
      } finally {
        setIsLoading(false)
      }
    },
    [selectedBotId],
  )

  // Create bot
  const createBot = useCallback(async (botData: Partial<ArbitrageBot>) => {
    setIsLoading(true)
    setError(null)

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const newBot: ArbitrageBot = {
        id: `bot-${Date.now()}`,
        name: botData.name || "New Bot",
        status: "stopped",
        exchanges: botData.exchanges || [],
        pairs: botData.pairs || [],
        minSpread: botData.minSpread || 0.5,
        maxVolume: botData.maxVolume || 10000,
        profitThreshold: botData.profitThreshold || 0.2,
        createdAt: new Date(),
        lastActive: new Date(),
        totalTrades: 0,
        successRate: 0,
        totalProfit: 0,
        ...botData,
      }

      setBots((prev) => [...prev, newBot])
      setIsCreatingBot(false)
    } catch (err) {
      setError("Failed to create bot")
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Connect exchange
  const connectExchange = useCallback(async (exchangeId: string) => {
    setIsLoading(true)
    setError(null)

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      setExchanges((prev) =>
        prev.map((exchange) => (exchange.id === exchangeId ? { ...exchange, status: "connected" as const } : exchange)),
      )
    } catch (err) {
      setError("Failed to connect exchange")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Disconnect exchange
  const disconnectExchange = useCallback(async (exchangeId: string) => {
    setIsLoading(true)
    setError(null)

    try {
      await new Promise((resolve) => setTimeout(resolve, 500))

      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === exchangeId ? { ...exchange, status: "disconnected" as const } : exchange,
        ),
      )
    } catch (err) {
      setError("Failed to disconnect exchange")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Toggle global bot status
  const toggleGlobalBotStatus = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      await new Promise((resolve) => setTimeout(resolve, 500))

      const newStatus = globalBotStatus === "active" ? "paused" : "active"
      setGlobalBotStatus(newStatus)

      // Update all active bots
      if (newStatus === "paused") {
        setBots((prev) => prev.map((bot) => (bot.status === "active" ? { ...bot, status: "paused" as const } : bot)))
      } else {
        setBots((prev) =>
          prev.map((bot) =>
            bot.status === "paused" ? { ...bot, status: "active" as const, lastActive: new Date() } : bot,
          ),
        )
      }
    } catch (err) {
      setError("Failed to update global bot status")
    } finally {
      setIsLoading(false)
    }
  }, [globalBotStatus])

  // Clear error
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // Refresh data
  const refreshData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Simulate data refresh
      setOpportunities([...mockOpportunities])
      setBots([...mockArbitrageBots])
      setExchanges([...mockExchanges])
    } catch (err) {
      setError("Failed to refresh data")
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    // State
    globalBotStatus,
    isCreatingBot,
    selectedBotId,
    selectedBot,
    isLoading,
    error,

    // Filtered data
    activeOpportunities,
    completedOpportunities,
    failedOpportunities,
    activeBots,
    pausedBots,
    stoppedBots,
    connectedExchanges,
    disconnectedExchanges,
    allBots: bots,
    allOpportunities: opportunities,
    allExchanges: exchanges,

    // Actions
    setGlobalBotStatus,
    setIsCreatingBot,
    setSelectedBotId,
    executeOpportunity,
    pauseBot,
    resumeBot,
    deleteBot,
    createBot,
    connectExchange,
    disconnectExchange,
    toggleGlobalBotStatus,
    clearError,
    refreshData,
  }
}
