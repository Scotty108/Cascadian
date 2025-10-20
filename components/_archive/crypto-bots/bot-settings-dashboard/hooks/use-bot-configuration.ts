"use client"

import { useState, useCallback } from "react"

export const useBotConfiguration = () => {
  const [activeTab, setActiveTab] = useState("general")
  const [isLoading, setIsLoading] = useState(false)

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab)
  }, [])

  const handleSave = useCallback(async () => {
    setIsLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return { success: true }
    } catch (error) {
      return { success: false, error: "Failed to save configuration" }
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    activeTab,
    setActiveTab: handleTabChange,
    isLoading,
    handleSave,
  }
}
