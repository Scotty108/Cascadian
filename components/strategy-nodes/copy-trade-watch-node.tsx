/**
 * COPY TRADE WATCH NODE COMPONENT
 *
 * Strategy Builder V1 placeholder for copy trading observability.
 * Accepts wallet list input, shows live activity feed.
 * NO EXECUTION. Observability only.
 *
 * Features:
 * - Accepts wallet list from upstream WalletCohortNode
 * - Shows "watching" status
 * - Displays last trade timestamp
 * - No execution logic
 */

"use client"

import { memo, useEffect, useState, useRef } from "react"
import { Handle, Position } from "@xyflow/react"
import { Eye, Activity, Clock, Wallet, AlertCircle, Wifi, WifiOff } from "lucide-react"
import type { CopyTradeWatchConfig } from "@/lib/strategy-builder/types"

interface WatchedWallet {
  address: string
  lastTrade?: {
    timestamp: number
    side: 'BUY' | 'SELL'
    market: string
    price: number
  }
  isActive: boolean
}

interface CopyTradeWatchNodeProps {
  data: {
    config?: CopyTradeWatchConfig
    status?: "idle" | "running" | "completed" | "error"
    // Wallet list from upstream WalletCohortNode
    wallets?: Array<{
      wallet_address: string
      realized_pnl_estimate?: number
    }>
  }
  selected?: boolean
  id: string
}

function CopyTradeWatchNode({ data, selected, id }: CopyTradeWatchNodeProps) {
  const config = data.config
  const inputWallets = data.wallets || []

  const [watchedWallets, setWatchedWallets] = useState<WatchedWallet[]>([])
  const [recentTrades, setRecentTrades] = useState<Array<{
    wallet: string
    side: 'BUY' | 'SELL'
    market: string
    price: number
    timestamp: number
  }>>([])
  const [isWatching, setIsWatching] = useState(false)

  // Initialize watched wallets from input
  useEffect(() => {
    if (inputWallets.length > 0) {
      setWatchedWallets(inputWallets.map(w => ({
        address: w.wallet_address,
        isActive: false,
      })))
    }
  }, [inputWallets])

  // Check if configured
  const isConfigured = config && config.version === 1

  // Status color
  const statusColor = {
    idle: "border-border",
    running: "border-indigo-500 bg-indigo-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  // If not configured, show setup prompt
  if (!isConfigured) {
    return (
      <div
        data-testid="copy-trade-watch-node"
        className={`rounded-2xl border-2 ${
          selected ? "ring-2 ring-[#00E0AA] ring-offset-2 border-[#00E0AA]" : "border-border"
        } bg-gradient-to-br from-indigo-500/10 to-blue-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[220px] antialiased`}
        style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
      >
        <div className="px-4 py-3 border-b border-indigo-500/20 bg-indigo-500/5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-indigo-500/20 p-1.5">
              <Eye className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="font-semibold text-sm">Copy Trade Watch</div>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground">
            Click to configure watching
          </div>
        </div>

        <Handle
          type="target"
          position={Position.Left}
          className="!bg-indigo-500 !border-2 !border-indigo-600 !w-3 !h-3"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-indigo-500 !border-2 !border-indigo-600 !w-3 !h-3"
        />
      </div>
    )
  }

  const maxTrades = config.max_recent_trades || 5

  return (
    <div
      data-testid="copy-trade-watch-node"
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-indigo-500/10 to-blue-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[280px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-indigo-500/20 bg-indigo-500/5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-indigo-500/20 p-1.5">
              <Eye className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="font-semibold text-sm">Copy Trade Watch</div>
          </div>

          {/* Watch Status Badge */}
          <div className={`px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 ${
            isWatching
              ? 'bg-green-500/20 text-green-700 dark:text-green-300'
              : 'bg-gray-500/20 text-gray-700 dark:text-gray-300'
          }`}>
            {isWatching ? (
              <>
                <Wifi className="h-2.5 w-2.5" />
                Watching
              </>
            ) : (
              <>
                <WifiOff className="h-2.5 w-2.5" />
                Idle
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        {/* V1 Notice */}
        <div className="flex items-start gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-2 py-1.5">
          <AlertCircle className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" />
          <span className="text-yellow-700 dark:text-yellow-300">
            V1: Observe only. No execution.
          </span>
        </div>

        {/* Wallet Count */}
        <div className="flex items-center gap-2 text-xs">
          <Wallet className="h-3 w-3 text-indigo-500/70" />
          <span className="text-muted-foreground">
            {watchedWallets.length} wallet{watchedWallets.length !== 1 ? 's' : ''} in watch list
          </span>
        </div>

        {/* No wallets connected */}
        {watchedWallets.length === 0 && (
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
            Connect a Wallet Cohort node to start watching
          </div>
        )}

        {/* Watched Wallets Preview */}
        {watchedWallets.length > 0 && (
          <div className="space-y-1">
            {watchedWallets.slice(0, 3).map((wallet, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1">
                <span className="font-mono truncate">
                  {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                </span>
                <div className="flex items-center gap-1">
                  <div className={`h-1.5 w-1.5 rounded-full ${wallet.isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                  <span className="text-muted-foreground">
                    {wallet.isActive ? 'active' : 'idle'}
                  </span>
                </div>
              </div>
            ))}
            {watchedWallets.length > 3 && (
              <div className="text-xs text-muted-foreground text-center">
                + {watchedWallets.length - 3} more wallets
              </div>
            )}
          </div>
        )}

        {/* Recent Trades Feed */}
        {recentTrades.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Activity className="h-3 w-3" />
              Recent Activity
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {recentTrades.slice(0, maxTrades).map((trade, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs bg-muted/20 rounded px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${trade.side === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>
                      {trade.side}
                    </span>
                    <span className="truncate max-w-24">{trade.market}</span>
                  </div>
                  {config.show_timestamps && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(trade.timestamp * 1000).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty Activity */}
        {watchedWallets.length > 0 && recentTrades.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-2">
            No recent trades detected
          </div>
        )}

        {/* Mode Indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Mode:</span>
          <span className={`px-1.5 py-0.5 rounded ${
            config.watch_mode === 'alert'
              ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300'
              : 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
          }`}>
            {config.watch_mode === 'alert' ? 'Alert' : 'Observe'}
          </span>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-indigo-500 !border-2 !border-indigo-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-indigo-500 !border-2 !border-indigo-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(CopyTradeWatchNode)
