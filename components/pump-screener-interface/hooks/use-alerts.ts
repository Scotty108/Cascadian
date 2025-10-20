"use client"

import { useState, useCallback } from "react"
import type { PumpAlert } from "../types"

export function useAlerts() {
  const [alerts, setAlerts] = useState<PumpAlert[]>([])
  const [selectedAlert, setSelectedAlert] = useState<number | null>(null)

  const addAlert = useCallback((alert: PumpAlert) => {
    setAlerts((prev) => [alert, ...prev])
  }, [])

  const removeAlert = useCallback((alertId: number) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== alertId))
  }, [])

  const clearAlerts = useCallback(() => {
    setAlerts([])
  }, [])

  return {
    alerts,
    selectedAlert,
    setSelectedAlert,
    addAlert,
    removeAlert,
    clearAlerts,
  }
}
