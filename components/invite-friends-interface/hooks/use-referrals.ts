"use client"

import { useState, useCallback } from "react"
import type { ReferralStats, Referral, ReferralSettings } from "../types"
import { mockReferralStats, mockRecentReferrals, defaultReferralSettings } from "../data"

export const useReferrals = () => {
  const [stats, setStats] = useState<ReferralStats>(mockReferralStats)
  const [referrals, setReferrals] = useState<Referral[]>(mockRecentReferrals)
  const [settings, setSettings] = useState<ReferralSettings>(defaultReferralSettings)
  const [isLoading, setIsLoading] = useState(false)

  const updateSettings = useCallback((newSettings: Partial<ReferralSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }))
  }, [])

  const refreshStats = useCallback(async () => {
    setIsLoading(true)
    try {
      // In a real app, this would fetch from an API
      await new Promise((resolve) => setTimeout(resolve, 1000))
      // Update stats here
    } catch (error) {
      console.error("Failed to refresh stats:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    stats,
    referrals,
    settings,
    isLoading,
    updateSettings,
    refreshStats,
  }
}
