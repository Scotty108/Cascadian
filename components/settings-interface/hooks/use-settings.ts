"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import type {
  SettingsState,
  UserProfile,
  SecuritySettings,
  NotificationSettings,
  AppearanceSettings,
  TradingSettings,
  BotSettings,
  PrivacySettings,
  DataSettings,
} from "../types"
import { defaultSettingsState } from "../data"
import { hasUnsavedChanges, deepClone } from "../utils"

export const useSettings = () => {
  const [settings, setSettings] = useState<Omit<SettingsState, "hasUnsavedChanges">>(() => {
    const { hasUnsavedChanges: _, ...settingsWithoutFlag } = defaultSettingsState
    return settingsWithoutFlag
  })
  const [originalSettings, setOriginalSettings] = useState<Omit<SettingsState, "hasUnsavedChanges">>(() => {
    const { hasUnsavedChanges: _, ...settingsWithoutFlag } = defaultSettingsState
    return settingsWithoutFlag
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Calculate hasUnsavedChanges using useMemo to avoid infinite loops
  const hasUnsavedChangesFlag = useMemo(() => {
    return hasUnsavedChanges(originalSettings, settings)
  }, [originalSettings, settings])

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem("defibotx-settings")
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings)
        const { hasUnsavedChanges: _, ...settingsWithoutFlag } = parsed
        setSettings(settingsWithoutFlag)
        setOriginalSettings(deepClone(settingsWithoutFlag))
      } catch (error) {
        console.error("Failed to parse saved settings:", error)
      }
    }
  }, [])

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    setSettings((prev) => ({
      ...prev,
      profile: { ...prev.profile, ...updates },
    }))
  }, [])

  const updateSecurity = useCallback((updates: Partial<SecuritySettings>) => {
    setSettings((prev) => ({
      ...prev,
      security: { ...prev.security, ...updates },
    }))
  }, [])

  const updateNotifications = useCallback((updates: Partial<NotificationSettings>) => {
    setSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, ...updates },
    }))
  }, [])

  const updateAppearance = useCallback((updates: Partial<AppearanceSettings>) => {
    setSettings((prev) => ({
      ...prev,
      appearance: { ...prev.appearance, ...updates },
    }))
  }, [])

  const updateTrading = useCallback((updates: Partial<TradingSettings>) => {
    setSettings((prev) => ({
      ...prev,
      trading: { ...prev.trading, ...updates },
    }))
  }, [])

  const updateBots = useCallback((updates: Partial<BotSettings>) => {
    setSettings((prev) => ({
      ...prev,
      bots: { ...prev.bots, ...updates },
    }))
  }, [])

  const updatePrivacy = useCallback((updates: Partial<PrivacySettings>) => {
    setSettings((prev) => ({
      ...prev,
      privacy: { ...prev.privacy, ...updates },
    }))
  }, [])

  const updateData = useCallback((updates: Partial<DataSettings>) => {
    setSettings((prev) => ({
      ...prev,
      data: { ...prev.data, ...updates },
    }))
  }, [])

  const setActiveTab = useCallback((tab: string) => {
    setSettings((prev) => ({ ...prev, activeTab: tab }))
  }, [])

  const saveSettings = useCallback(async () => {
    setIsSaving(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Save to localStorage
      const settingsToSave = { ...settings, hasUnsavedChanges: false }
      localStorage.setItem("defibotx-settings", JSON.stringify(settingsToSave))

      // Update original settings to mark as saved
      setOriginalSettings(deepClone(settings))

      return { success: true }
    } catch (error) {
      console.error("Failed to save settings:", error)
      return { success: false, error: "Failed to save settings" }
    } finally {
      setIsSaving(false)
    }
  }, [settings])

  const resetSettings = useCallback(() => {
    setSettings(deepClone(originalSettings))
  }, [originalSettings])

  const resetToDefaults = useCallback(() => {
    const { hasUnsavedChanges: _, ...settingsWithoutFlag } = defaultSettingsState
    setSettings(settingsWithoutFlag)
  }, [])

  // Return settings with the calculated hasUnsavedChanges flag
  const settingsWithFlag = useMemo(
    () => ({
      ...settings,
      hasUnsavedChanges: hasUnsavedChangesFlag,
    }),
    [settings, hasUnsavedChangesFlag],
  )

  return {
    settings: settingsWithFlag,
    isLoading,
    isSaving,
    updateProfile,
    updateSecurity,
    updateNotifications,
    updateAppearance,
    updateTrading,
    updateBots,
    updatePrivacy,
    updateData,
    setActiveTab,
    saveSettings,
    resetSettings,
    resetToDefaults,
  }
}
