"use client"

import { useState } from "react"
import { mockBotData } from "../data/mock-data"
import type { BotData, RiskSettings, Strategy } from "../types"

export function useBotState() {
  const [botData, setBotData] = useState<BotData>(mockBotData)
  const [botRunning, setBotRunning] = useState(botData.status === "active")
  const [selectedStrategy, setSelectedStrategy] = useState(botData.strategies.find((s) => s.active)?.id || "1")
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(botData.riskSettings)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Handle bot start/stop
  const toggleBotStatus = () => {
    setBotRunning(!botRunning)
    setBotData({
      ...botData,
      status: !botRunning ? "active" : "inactive",
    })
  }

  // Handle strategy change
  const handleStrategyChange = (strategyId: string) => {
    setSelectedStrategy(strategyId)

    // Update active strategy in bot data
    const updatedStrategies = botData.strategies.map((strategy) => ({
      ...strategy,
      active: strategy.id === strategyId,
    }))

    setBotData({
      ...botData,
      strategies: updatedStrategies,
    })
  }

  // Handle strategy updates
  const updateStrategies = (strategies: Strategy[]) => {
    setBotData({
      ...botData,
      strategies,
    })
  }

  // Handle risk settings update
  const updateRiskSettings = (settings: RiskSettings) => {
    setRiskSettings(settings)
    setBotData({
      ...botData,
      riskSettings: settings,
    })
  }

  // Handle refresh data
  const handleRefresh = () => {
    setIsRefreshing(true)

    // Simulate data refresh
    setTimeout(() => {
      setIsRefreshing(false)
    }, 1000)
  }

  return {
    botData,
    setBotData,
    botRunning,
    selectedStrategy,
    riskSettings,
    setRiskSettings: updateRiskSettings,
    isRefreshing,
    toggleBotStatus,
    handleStrategyChange,
    handleRefresh,
    updateStrategies,
  }
}
