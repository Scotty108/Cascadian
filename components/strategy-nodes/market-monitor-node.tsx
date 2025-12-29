/**
 * MARKET MONITOR NODE COMPONENT
 *
 * Strategy Builder node for real-time market price monitoring.
 * Displays current price + short recent candle chart.
 *
 * Features:
 * - Current price display
 * - Mini sparkline chart
 * - Polling vs WebSocket mode toggle
 * - Data source badge
 */

"use client"

import { memo, useEffect, useState, useCallback, useRef } from "react"
import { Handle, Position } from "@xyflow/react"
import { Activity, Globe, TrendingUp, TrendingDown, Minus, Wifi, RefreshCw } from "lucide-react"
import type { MarketMonitorConfig } from "@/lib/strategy-builder/types"

interface MarketMonitorNodeProps {
  data: {
    config?: MarketMonitorConfig
    status?: "idle" | "running" | "completed" | "error"
    // Market to monitor (passed from upstream)
    market?: {
      condition_id: string
      token_id?: string
      title: string
    }
  }
  selected?: boolean
  id: string
}

interface PriceData {
  price: number
  timestamp: number
  change?: number
}

function MarketMonitorNode({ data, selected, id }: MarketMonitorNodeProps) {
  const config = data.config
  const market = data.market

  const [currentPrice, setCurrentPrice] = useState<PriceData | null>(null)
  const [priceHistory, setPriceHistory] = useState<number[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'polling'>('disconnected')

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch price from API
  const fetchPrice = useCallback(async () => {
    if (!market?.token_id) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/markets/price?token_id=${market.token_id}`)
      const result = await response.json()

      if (result.success && result.data) {
        const newPrice = result.data.price
        const previousPrice = currentPrice?.price

        setCurrentPrice({
          price: newPrice,
          timestamp: result.data.at_time,
          change: previousPrice ? newPrice - previousPrice : undefined,
        })

        // Update history (keep last 20 points)
        setPriceHistory(prev => [...prev.slice(-19), newPrice])
        setLastUpdate(new Date())
        setConnectionStatus(config?.mode === 'websocket' ? 'connected' : 'polling')
      }
    } catch (error) {
      console.error('[MarketMonitor] Error fetching price:', error)
      setConnectionStatus('disconnected')
    } finally {
      setIsLoading(false)
    }
  }, [market?.token_id, currentPrice?.price, config?.mode])

  // Set up polling
  useEffect(() => {
    if (!config || !market?.token_id) return

    // Initial fetch
    fetchPrice()

    // Set up polling interval
    const intervalMs = (config.poll_interval_seconds || 60) * 1000
    pollIntervalRef.current = setInterval(fetchPrice, intervalMs)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [config?.poll_interval_seconds, market?.token_id, fetchPrice])

  // Check if configured
  const isConfigured = config && config.version === 1

  // Status color
  const statusColor = {
    idle: "border-border",
    running: "border-amber-500 bg-amber-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  // Trend indicator
  const getTrendIcon = () => {
    if (!currentPrice?.change) return <Minus className="h-3 w-3 text-muted-foreground" />
    if (currentPrice.change > 0) return <TrendingUp className="h-3 w-3 text-green-500" />
    return <TrendingDown className="h-3 w-3 text-red-500" />
  }

  // Mini sparkline
  const renderSparkline = () => {
    if (priceHistory.length < 2) return null

    const min = Math.min(...priceHistory)
    const max = Math.max(...priceHistory)
    const range = max - min || 1

    const points = priceHistory.map((price, i) => {
      const x = (i / (priceHistory.length - 1)) * 80
      const y = 20 - ((price - min) / range) * 20
      return `${x},${y}`
    }).join(' ')

    const lastPrice = priceHistory[priceHistory.length - 1]
    const firstPrice = priceHistory[0]
    const isUp = lastPrice >= firstPrice

    return (
      <svg width="80" height="24" className="overflow-visible">
        <polyline
          points={points}
          fill="none"
          stroke={isUp ? '#22c55e' : '#ef4444'}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  // If not configured, show setup prompt
  if (!isConfigured) {
    return (
      <div
        data-testid="market-monitor-node"
        className={`rounded-2xl border-2 ${
          selected ? "ring-2 ring-[#00E0AA] ring-offset-2 border-[#00E0AA]" : "border-border"
        } bg-gradient-to-br from-amber-500/10 to-orange-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[220px] antialiased`}
        style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
      >
        <div className="px-4 py-3 border-b border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-amber-500/20 p-1.5">
              <Activity className="h-4 w-4 text-amber-500" />
            </div>
            <div className="font-semibold text-sm">Market Monitor</div>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground">
            Click to configure monitoring
          </div>
        </div>

        <Handle
          type="target"
          position={Position.Left}
          className="!bg-amber-500 !border-2 !border-amber-600 !w-3 !h-3"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-amber-500 !border-2 !border-amber-600 !w-3 !h-3"
        />
      </div>
    )
  }

  return (
    <div
      data-testid="market-monitor-node"
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-amber-500/10 to-orange-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[260px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-amber-500/20 bg-amber-500/5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-amber-500/20 p-1.5">
              <Activity className="h-4 w-4 text-amber-500" />
            </div>
            <div className="font-semibold text-sm">Market Monitor</div>
          </div>

          {/* Connection Status */}
          <div className={`px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 ${
            connectionStatus === 'connected' ? 'bg-green-500/20 text-green-700 dark:text-green-300' :
            connectionStatus === 'polling' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300' :
            'bg-gray-500/20 text-gray-700 dark:text-gray-300'
          }`}>
            {connectionStatus === 'polling' ? (
              <RefreshCw className="h-2.5 w-2.5" />
            ) : (
              <Wifi className="h-2.5 w-2.5" />
            )}
            {config.mode === 'websocket' ? 'WS' : `${config.poll_interval_seconds}s`}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        {/* Market Title */}
        {market && (
          <div className="text-xs font-medium truncate text-muted-foreground">
            {market.title}
          </div>
        )}

        {/* No market selected */}
        {!market && (
          <div className="text-xs text-muted-foreground">
            Connect to a Market Universe to monitor
          </div>
        )}

        {/* Price Display */}
        {currentPrice && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {(currentPrice.price * 100).toFixed(1)}%
              </span>
              {getTrendIcon()}
            </div>
            {renderSparkline()}
          </div>
        )}

        {/* Loading */}
        {isLoading && !currentPrice && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Loading price...
          </div>
        )}

        {/* Last Update */}
        {lastUpdate && (
          <div className="text-xs text-muted-foreground">
            Updated: {lastUpdate.toLocaleTimeString()}
          </div>
        )}

        {/* Data Source Badge */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Globe className="h-2.5 w-2.5" />
          <span>Dome API</span>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-amber-500 !border-2 !border-amber-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-amber-500 !border-2 !border-amber-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(MarketMonitorNode)
