"use client"

import { useState, useEffect, useCallback } from "react"
import type { PumpAlert, MarketOverview } from "../types"
import { mockPumpAlerts, mockMarketOverview } from "../data"

export function useRealTimeData() {
  const [alerts, setAlerts] = useState<PumpAlert[]>(mockPumpAlerts)
  const [marketOverview, setMarketOverview] = useState<MarketOverview>(mockMarketOverview)
  const [isConnected, setIsConnected] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now())

  // Simulate real-time data updates
  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate new alerts
      const newAlert: PumpAlert = {
        id: Date.now(),
        symbol: `${["BTC", "ETH", "SOL", "DOGE", "SHIB"][Math.floor(Math.random() * 5)]}/USDT`,
        exchange: "Binance",
        priceChange: Math.random() * 20 + 1,
        volumeChange: Math.random() * 1000 + 100,
        timeFrame: ["1m", "5m", "15m", "30m"][Math.floor(Math.random() * 4)],
        currentPrice: Math.random() * 100,
        timestamp: Date.now(),
        risk: ["low", "medium", "high", "very high"][Math.floor(Math.random() * 4)] as any,
        confidence: Math.floor(Math.random() * 40) + 60,
        marketCap: Math.random() * 1000000000000,
        volume24h: Math.random() * 50000000000,
        socialMentions: Math.floor(Math.random() * 5000),
        patternType: ["Volume Spike", "Price Surge", "Social Spike"][Math.floor(Math.random() * 3)],
        previousPumps: Math.floor(Math.random() * 10),
      }

      setAlerts((prev) => [newAlert, ...prev.slice(0, 49)]) // Keep last 50 alerts
      setLastUpdate(Date.now())
    }, 10000) // Update every 10 seconds

    return () => clearInterval(interval)
  }, [])

  const reconnect = useCallback(() => {
    setIsConnected(false)
    setTimeout(() => {
      setIsConnected(true)
      setLastUpdate(Date.now())
    }, 2000)
  }, [])

  return {
    alerts,
    marketOverview,
    isConnected,
    lastUpdate,
    reconnect,
  }
}
