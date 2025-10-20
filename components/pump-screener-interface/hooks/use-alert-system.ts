"use client"

import { useState, useCallback, useEffect } from "react"
import type { PumpAlert } from "../types"

interface AlertRule {
  id: string
  name: string
  enabled: boolean
  conditions: {
    minPriceChange?: number
    minVolumeChange?: number
    maxRisk?: "low" | "medium" | "high" | "very high"
    symbols?: string[]
    exchanges?: string[]
    patternTypes?: string[]
  }
  notifications: {
    browser: boolean
    sound: boolean
    email: boolean
  }
  createdAt: number
}

interface AlertNotification {
  id: string
  alertId: number
  ruleId: string
  message: string
  timestamp: number
  read: boolean
  severity: "low" | "medium" | "high" | "critical"
}

export function useAlertSystem() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [notifications, setNotifications] = useState<AlertNotification[]>([])
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false)

  // Check notification permission on mount
  useEffect(() => {
    if ("Notification" in window) {
      setBrowserNotificationsEnabled(Notification.permission === "granted")
    }
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  const createRule = useCallback((rule: Omit<AlertRule, "id" | "createdAt">) => {
    const newRule: AlertRule = {
      ...rule,
      id: Date.now().toString(),
      createdAt: Date.now(),
    }
    setRules((prev) => [...prev, newRule])
  }, [])

  const updateRule = useCallback((ruleId: string, updates: Partial<AlertRule>) => {
    setRules((prev) => prev.map((rule) => (rule.id === ruleId ? { ...rule, ...updates } : rule)))
  }, [])

  const deleteRule = useCallback((ruleId: string) => {
    setRules((prev) => prev.filter((rule) => rule.id !== ruleId))
  }, [])

  const toggleRule = useCallback((ruleId: string) => {
    setRules((prev) => prev.map((rule) => (rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule)))
  }, [])

  const processAlerts = useCallback(
    (alerts: PumpAlert[]) => {
      const activeRules = rules.filter((rule) => rule.enabled)

      alerts.forEach((alert) => {
        activeRules.forEach((rule) => {
          const conditions = rule.conditions
          let matches = true

          // Check conditions
          if (conditions.minPriceChange && alert.priceChange < conditions.minPriceChange) matches = false
          if (conditions.minVolumeChange && alert.volumeChange < conditions.minVolumeChange) matches = false
          if (conditions.maxRisk) {
            const riskLevels = { low: 1, medium: 2, high: 3, "very high": 4 }
            if (riskLevels[alert.risk] > riskLevels[conditions.maxRisk]) matches = false
          }
          if (conditions.symbols && conditions.symbols.length > 0 && !conditions.symbols.includes(alert.symbol))
            matches = false
          if (conditions.exchanges && conditions.exchanges.length > 0 && !conditions.exchanges.includes(alert.exchange))
            matches = false
          if (
            conditions.patternTypes &&
            conditions.patternTypes.length > 0 &&
            !conditions.patternTypes.includes(alert.patternType)
          )
            matches = false

          if (matches) {
            const notification: AlertNotification = {
              id: `${alert.id}-${rule.id}-${Date.now()}`,
              alertId: alert.id,
              ruleId: rule.id,
              message: `${alert.symbol} pump detected: +${alert.priceChange}% price, +${alert.volumeChange}% volume`,
              timestamp: Date.now(),
              read: false,
              severity: alert.risk === "very high" ? "critical" : alert.risk === "high" ? "high" : "medium",
            }

            setNotifications((prev) => [notification, ...prev.slice(0, 99)]) // Keep last 100

            // Trigger notifications
            if (rule.notifications.browser && browserNotificationsEnabled) {
              new Notification("Pump Alert", {
                body: notification.message,
                icon: "/favicon.ico",
              })
            }

            if (rule.notifications.sound && soundEnabled) {
              // Play notification sound (would need audio file)
              const audio = new Audio("/notification.mp3")
              audio.play().catch(() => {}) // Ignore errors
            }
          }
        })
      })
    },
    [rules, browserNotificationsEnabled, soundEnabled],
  )

  const markAsRead = useCallback((notificationId: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)))
  }, [])

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  const clearAllNotifications = useCallback(() => {
    setNotifications([])
  }, [])

  const requestNotificationPermission = useCallback(async () => {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission()
      setBrowserNotificationsEnabled(permission === "granted")
      return permission === "granted"
    }
    return false
  }, [])

  return {
    rules,
    notifications,
    unreadCount,
    soundEnabled,
    browserNotificationsEnabled,
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
    processAlerts,
    markAsRead,
    markAllAsRead,
    clearAllNotifications,
    setSoundEnabled,
    requestNotificationPermission,
  }
}
