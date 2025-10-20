"use client"

import { useState, useCallback } from "react"
import type { DcaBot, DcaBotFormData, DcaSettings } from "../types"
import { mockDcaBots, mockFrequencies } from "../data"

export const useDcaBot = () => {
  const [bots, setBots] = useState<DcaBot[]>(mockDcaBots)
  const [selectedBot, setSelectedBot] = useState<DcaBot | null>(mockDcaBots[0] || null)
  const [activeTab, setActiveTab] = useState("overview")
  const [isCreatingBot, setIsCreatingBot] = useState(false)

  // Modal states
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [editingBot, setEditingBot] = useState<DcaBot | null>(null)
  const [viewingBot, setViewingBot] = useState<DcaBot | null>(null)

  // Form data
  const [formData, setFormData] = useState<DcaBotFormData>({
    name: "",
    asset: "",
    exchange: "",
    frequency: "",
    amount: 50,
    startDate: "",
    autoAdjust: false,
    priceLimit: false,
    notifications: true,
    autoReinvest: false,
  })

  // Settings
  const [settings, setSettings] = useState<DcaSettings>({
    autoStart: true,
    defaultExchange: "binance",
    defaultFrequency: "daily",
    defaultAmount: 50,
    emailNotifications: true,
    pushNotifications: false,
    telegramNotifications: false,
    weeklySummary: true,
    maxDailySpend: 500,
    confirmation: false,
    twoFactor: true,
  })

  const toggleBotStatus = useCallback((botId: string) => {
    setBots((prevBots) =>
      prevBots.map((bot) =>
        bot.id === botId ? { ...bot, status: bot.status === "active" ? "paused" : "active" } : bot,
      ),
    )
  }, [])

  const handleCreateBot = useCallback(() => {
    setIsCreatingBot(true)
    setActiveTab("settings")
    setFormData({
      name: "",
      asset: "",
      exchange: settings.defaultExchange,
      frequency: settings.defaultFrequency,
      amount: settings.defaultAmount,
      startDate: new Date().toISOString().split("T")[0],
      autoAdjust: false,
      priceLimit: false,
      notifications: settings.emailNotifications,
      autoReinvest: false,
    })
  }, [settings])

  const handleCancelCreate = useCallback(() => {
    setIsCreatingBot(false)
    setActiveTab("overview")
    setFormData({
      name: "",
      asset: "",
      exchange: "",
      frequency: "",
      amount: 50,
      startDate: "",
      autoAdjust: false,
      priceLimit: false,
      notifications: true,
      autoReinvest: false,
    })
  }, [])

  const handleSaveBot = useCallback(() => {
    if (!formData.name || !formData.asset || !formData.exchange || !formData.frequency) {
      return
    }

    const newBot: DcaBot = {
      id: `dca-${Date.now()}`,
      name: formData.name,
      asset: formData.asset,
      status: settings.autoStart ? "active" : "paused",
      exchange: formData.exchange,
      frequency: mockFrequencies.find((f) => f.id === formData.frequency)?.name || formData.frequency,
      amount: formData.amount,
      totalInvested: 0,
      averagePrice: 0,
      profit: 0,
      nextExecution: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      history: [],
    }

    setBots((prevBots) => [...prevBots, newBot])
    setIsCreatingBot(false)
    setActiveTab("overview")
    setSelectedBot(newBot)
  }, [formData, settings.autoStart])

  const handleEditBot = useCallback((bot: DcaBot) => {
    setEditingBot(bot)
    setShowEditModal(true)
  }, [])

  const handleSaveEditBot = useCallback(
    (updatedBot: DcaBot) => {
      setBots((prevBots) => prevBots.map((bot) => (bot.id === updatedBot.id ? updatedBot : bot)))
      if (selectedBot?.id === updatedBot.id) {
        setSelectedBot(updatedBot)
      }
      setShowEditModal(false)
      setEditingBot(null)
    },
    [selectedBot],
  )

  const handleViewDetails = useCallback((bot: DcaBot) => {
    setViewingBot(bot)
    setShowDetailsModal(true)
  }, [])

  const handleCopyBot = useCallback(
    (botId: string) => {
      const botToCopy = bots.find((bot) => bot.id === botId)
      if (botToCopy) {
        const copiedBot: DcaBot = {
          ...botToCopy,
          id: `dca-${Date.now()}`,
          name: `${botToCopy.name} (Copy)`,
          totalInvested: 0,
          averagePrice: 0,
          profit: 0,
          status: "paused",
          createdAt: new Date().toISOString(),
          history: [],
        }
        setBots((prevBots) => [...prevBots, copiedBot])
      }
    },
    [bots],
  )

  const handleDeleteBot = useCallback(
    (botId: string) => {
      setBots((prevBots) => prevBots.filter((bot) => bot.id !== botId))
      if (selectedBot?.id === botId) {
        setSelectedBot(bots.find((bot) => bot.id !== botId) || null)
      }
    },
    [bots, selectedBot],
  )

  const updateFormData = useCallback((updates: Partial<DcaBotFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }))
  }, [])

  const updateSettings = useCallback((updates: Partial<DcaSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }))
  }, [])

  return {
    // State
    bots,
    selectedBot,
    activeTab,
    isCreatingBot,
    showEditModal,
    showDetailsModal,
    showSettingsModal,
    editingBot,
    viewingBot,
    formData,
    settings,

    // Actions
    setSelectedBot,
    setActiveTab,
    setShowEditModal,
    setShowDetailsModal,
    setShowSettingsModal,
    toggleBotStatus,
    handleCreateBot,
    handleCancelCreate,
    handleSaveBot,
    handleEditBot,
    handleSaveEditBot,
    handleViewDetails,
    handleCopyBot,
    handleDeleteBot,
    updateFormData,
    updateSettings,
  }
}
