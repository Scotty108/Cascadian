"use client"

import { useState } from "react"
import type { NotificationSettings, SignalFilters, TradingSettings, AdvancedSettings } from "../types"

const initialNotificationSettings: NotificationSettings = {
  email: true,
  push: true,
  telegram: false,
  discord: false,
}

const initialSignalFilters: SignalFilters = {
  minConfidence: 75,
  favoriteProvidersOnly: false,
  includeLong: true,
  includeShort: true,
}

const initialTradingSettings: TradingSettings = {
  botName: "My Signal Bot",
  description: "Personal trading signal bot",
  defaultExchange: "binance",
  defaultPair: "btcusdt",
  positionSize: 100,
  positionSizeType: "percentage",
  maxPositions: 5,
  maxDailyTrades: 10,
}

const initialAdvancedSettings: AdvancedSettings = {
  positionSizePercent: 5,
  maxConcurrent: 3,
  stopLoss: 2,
  takeProfit: 5,
  trailingStop: false,
  partialClose: false,
  reinvestProfits: false,
}

export function useSignalBot() {
  const [botActive, setBotActive] = useState(true)
  const [autoTrade, setAutoTrade] = useState(true)
  const [riskLevel, setRiskLevel] = useState([50])
  const [notificationSettings, setNotificationSettings] = useState(initialNotificationSettings)
  const [signalFilters, setSignalFilters] = useState(initialSignalFilters)
  const [tradingSettings, setTradingSettings] = useState(initialTradingSettings)
  const [advancedSettings, setAdvancedSettings] = useState(initialAdvancedSettings)
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)
  const [showAddProvider, setShowAddProvider] = useState(false)
  const [showProviderDetails, setShowProviderDetails] = useState<string | null>(null)
  const [historyFilter, setHistoryFilter] = useState("all")

  const updateNotificationSetting = (key: keyof NotificationSettings, value: boolean) => {
    setNotificationSettings((prev) => ({ ...prev, [key]: value }))
  }

  const updateSignalFilter = (key: keyof SignalFilters, value: any) => {
    setSignalFilters((prev) => ({ ...prev, [key]: value }))
  }

  const updateTradingSetting = (key: keyof TradingSettings, value: any) => {
    setTradingSettings((prev) => ({ ...prev, [key]: value }))
  }

  const updateAdvancedSetting = (key: keyof AdvancedSettings, value: any) => {
    setAdvancedSettings((prev) => ({ ...prev, [key]: value }))
  }

  const resetFilters = () => {
    setSignalFilters(initialSignalFilters)
  }

  const resetSettings = () => {
    setTradingSettings(initialTradingSettings)
    setAdvancedSettings(initialAdvancedSettings)
    setNotificationSettings(initialNotificationSettings)
  }

  return {
    // State
    botActive,
    autoTrade,
    riskLevel,
    notificationSettings,
    signalFilters,
    tradingSettings,
    advancedSettings,
    showAdvancedSettings,
    showAddProvider,
    showProviderDetails,
    historyFilter,

    // Actions
    setBotActive,
    setAutoTrade,
    setRiskLevel,
    setShowAdvancedSettings,
    setShowAddProvider,
    setShowProviderDetails,
    setHistoryFilter,
    updateNotificationSetting,
    updateSignalFilter,
    updateTradingSetting,
    updateAdvancedSetting,
    resetFilters,
    resetSettings,
  }
}
