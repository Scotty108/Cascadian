"use client"

import { useState, useCallback } from "react"
import type { BotConfig, CreateBotFormData } from "../types"
import { botConfigs } from "../data"

export function useBotManagement() {
  const [bots, setBots] = useState<BotConfig[]>(botConfigs)
  const [isLoading, setIsLoading] = useState(false)

  const createBot = useCallback(async (formData: CreateBotFormData) => {
    setIsLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const newBot: BotConfig = {
        id: `bot-${Date.now()}`,
        name: formData.name,
        type: formData.type,
        icon: getBotIcon(formData.type),
        status: "inactive",
        exchange: formData.exchange,
        pair: formData.pair,
        strategy: formData.strategy,
        profitability: 0,
        lastRun: "Never",
        description: formData.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalTrades: 0,
        winRate: 0,
        balance: 0,
      }

      setBots((prev) => [newBot, ...prev])
      return { success: true, bot: newBot }
    } catch (error) {
      console.error("Failed to create bot:", error)
      return { success: false, error: "Failed to create bot" }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const deleteBot = useCallback(async (botId: string) => {
    setIsLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500))

      setBots((prev) => prev.filter((bot) => bot.id !== botId))
      return { success: true }
    } catch (error) {
      console.error("Failed to delete bot:", error)
      return { success: false, error: "Failed to delete bot" }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const updateBotStatus = useCallback(async (botId: string, status: BotConfig["status"]) => {
    setIsLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500))

      setBots((prev) =>
        prev.map((bot) => (bot.id === botId ? { ...bot, status, updatedAt: new Date().toISOString() } : bot)),
      )
      return { success: true }
    } catch (error) {
      console.error("Failed to update bot status:", error)
      return { success: false, error: "Failed to update bot status" }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const duplicateBot = useCallback(
    async (botId: string) => {
      setIsLoading(true)
      try {
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 800))

        const originalBot = bots.find((bot) => bot.id === botId)
        if (!originalBot) {
          throw new Error("Bot not found")
        }

        const duplicatedBot: BotConfig = {
          ...originalBot,
          id: `bot-${Date.now()}`,
          name: `${originalBot.name} (Copy)`,
          status: "inactive",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          totalTrades: 0,
          profitability: 0,
          lastRun: "Never",
          balance: 0,
        }

        setBots((prev) => [duplicatedBot, ...prev])
        return { success: true, bot: duplicatedBot }
      } catch (error) {
        console.error("Failed to duplicate bot:", error)
        return { success: false, error: "Failed to duplicate bot" }
      } finally {
        setIsLoading(false)
      }
    },
    [bots],
  )

  return {
    bots,
    setBots,
    createBot,
    deleteBot,
    updateBotStatus,
    duplicateBot,
    isLoading,
  }
}

function getBotIcon(type: string): string {
  const icons: Record<string, string> = {
    ai: "🤖",
    dca: "📈",
    signal: "📡",
    arbitrage: "⚡",
    grid: "🔲",
    momentum: "🚀",
  }
  return icons[type] || "🤖"
}
