"use client"

import { useState, useEffect, useCallback } from "react"
import type { ExecutionLog, UseExecutionLogsReturn } from "../types"
import { generateMockLogs } from "../utils"

export const useExecutionLogs = (): UseExecutionLogsReturn => {
  const [logs, setLogs] = useState<ExecutionLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAutoRefresh, setAutoRefresh] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(30000) // 30 seconds

  const fetchLogs = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // In a real application, this would be an API call
      // const response = await fetch('/api/execution-logs')
      // const data = await response.json()

      // For demo purposes, generate mock data
      const mockLogs = generateMockLogs(100)
      setLogs(mockLogs)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch logs")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshLogs = useCallback(() => {
    fetchLogs()
  }, [fetchLogs])

  // Initial load
  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  // Auto refresh
  useEffect(() => {
    if (!isAutoRefresh) return

    const interval = setInterval(() => {
      fetchLogs()
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [isAutoRefresh, refreshInterval, fetchLogs])

  return {
    logs,
    isLoading,
    error,
    refreshLogs,
    isAutoRefresh,
    setAutoRefresh,
    refreshInterval,
    setRefreshInterval,
  }
}
