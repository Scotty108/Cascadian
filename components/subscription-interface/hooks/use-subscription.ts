"use client"

import { useState, useCallback } from "react"
import type { BillingCycle, SubscriptionSettings } from "../types"
import { plans, currentPlanIndex, defaultSettings } from "../data"
import { BILLING_CYCLES } from "../constants"

export const useSubscription = () => {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(BILLING_CYCLES.MONTHLY)
  const [settings, setSettings] = useState<SubscriptionSettings>(defaultSettings)
  const [showCancelDialog, setShowCancelDialog] = useState(false)

  const currentPlan = plans[currentPlanIndex]

  const toggleBillingCycle = useCallback(() => {
    setBillingCycle((prev) => (prev === BILLING_CYCLES.MONTHLY ? BILLING_CYCLES.ANNUAL : BILLING_CYCLES.MONTHLY))
  }, [])

  const updateSetting = useCallback((key: keyof SubscriptionSettings, value: boolean) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }))
  }, [])

  const openCancelDialog = useCallback(() => {
    setShowCancelDialog(true)
  }, [])

  const closeCancelDialog = useCallback(() => {
    setShowCancelDialog(false)
  }, [])

  const upgradePlan = useCallback((planName: string) => {
    console.log(`Upgrading to ${planName}`)
    // Implement upgrade logic
  }, [])

  const cancelSubscription = useCallback((reason: string, feedback?: string) => {
    console.log(`Cancelling subscription. Reason: ${reason}`, feedback)
    setShowCancelDialog(false)
    // Implement cancellation logic
  }, [])

  return {
    billingCycle,
    setBillingCycle,
    toggleBillingCycle,
    currentPlan,
    settings,
    updateSetting,
    showCancelDialog,
    openCancelDialog,
    closeCancelDialog,
    upgradePlan,
    cancelSubscription,
  }
}
