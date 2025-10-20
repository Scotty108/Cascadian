"use client"

import { useState, useCallback, useEffect } from "react"
import type { BotSettingsState } from "../types"
import { defaultBotSettings } from "../data"

export function useBotSettings() {
  const [settings, setSettings] = useState<BotSettingsState>(defaultBotSettings)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem("bot-settings")
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings)
        setSettings({ ...defaultBotSettings, ...parsed })
      } catch (error) {
        console.error("Failed to parse saved settings:", error)
      }
    }
  }, [])

  const updateSetting = useCallback(<K extends keyof BotSettingsState>(key: K, value: BotSettingsState[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setHasUnsavedChanges(true)
  }, [])

  const saveSettings = useCallback(async () => {
    setIsLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Save to localStorage
      localStorage.setItem("bot-settings", JSON.stringify(settings))
      setHasUnsavedChanges(false)

      return { success: true }
    } catch (error) {
      console.error("Failed to save settings:", error)
      return { success: false, error: "Failed to save settings" }
    } finally {
      setIsLoading(false)
    }
  }, [settings])

  const resetSettings = useCallback(() => {
    setSettings(defaultBotSettings)
    setHasUnsavedChanges(true)
  }, [])

  return {
    settings,
    updateSetting,
    saveSettings,
    resetSettings,
    hasUnsavedChanges,
    isLoading,
  }
}
