/**
 * MANUAL COPY TRADE NODE COMPONENT
 *
 * Strategy Builder node for manual wallet-based copy trading.
 * User enters comma-separated wallets and configures consensus rules.
 *
 * Features:
 * - CSV wallet input
 * - Consensus mode selection (any, two_agree, n_of_m, all)
 * - Real-time trade log display
 * - Dry-run by default (no real execution)
 * - Status indicators for each decision
 */

"use client"

import { memo, useEffect, useState, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
import {
  Copy,
  Users,
  Play,
  Square,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Filter,
  Settings,
  Activity,
} from "lucide-react"
import type { ManualCopyTradeConfig, CopyTradeDecision, ConsensusMode } from "@/lib/contracts/strategyBuilder"

// ============================================================================
// Types
// ============================================================================

interface ManualCopyTradeNodeProps {
  data: {
    config?: ManualCopyTradeConfig
    status?: "idle" | "running" | "completed" | "error"
    // Optional market filter input from upstream
    allowedConditionIds?: string[]
  }
  selected?: boolean
  id: string
}

// ============================================================================
// Component
// ============================================================================

function ManualCopyTradeNode({ data, selected, id }: ManualCopyTradeNodeProps) {
  const config = data.config
  const allowedConditionIds = data.allowedConditionIds

  // Engine state
  const [isEngineRunning, setIsEngineRunning] = useState(false)
  const [walletCount, setWalletCount] = useState(0)

  // Log state
  const [decisions, setDecisions] = useState<CopyTradeDecision[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)

  // Check engine status
  const checkEngineStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/copytrade/engine")
      const result = await response.json()
      if (result.success) {
        setIsEngineRunning(result.data.isRunning)
        setWalletCount(result.data.walletCount)
      }
    } catch (err) {
      console.error("Failed to check engine status:", err)
    }
  }, [])

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    setIsLoadingLogs(true)
    try {
      const response = await fetch("/api/copytrade/logs?limit=20")
      const result = await response.json()
      if (result.success) {
        setDecisions(result.data.decisions)
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err)
    } finally {
      setIsLoadingLogs(false)
    }
  }, [])

  // Start engine
  const startEngine = useCallback(async () => {
    if (!config) return

    try {
      const response = await fetch("/api/copytrade/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          config,
          allowedConditionIds,
        }),
      })
      const result = await response.json()
      if (result.success) {
        setIsEngineRunning(true)
        setWalletCount(result.data.walletCount)
      }
    } catch (err) {
      console.error("Failed to start engine:", err)
    }
  }, [config, allowedConditionIds])

  // Stop engine
  const stopEngine = useCallback(async () => {
    try {
      const response = await fetch("/api/copytrade/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      })
      const result = await response.json()
      if (result.success) {
        setIsEngineRunning(false)
        setWalletCount(0)
      }
    } catch (err) {
      console.error("Failed to stop engine:", err)
    }
  }, [])

  // Initial load and polling
  useEffect(() => {
    checkEngineStatus()
    fetchLogs()

    // Poll for updates every 3 seconds when running
    const interval = setInterval(() => {
      if (isEngineRunning) {
        fetchLogs()
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [isEngineRunning, checkEngineStatus, fetchLogs])

  // Check if configured
  const isConfigured = config && config.walletsCsv && config.walletsCsv.trim().length > 0

  // Status color
  const borderColor = {
    idle: "border-border",
    running: "border-violet-500 bg-violet-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  // If not configured, show setup prompt
  if (!isConfigured) {
    return (
      <div
        data-testid="manual-copy-trade-node"
        className={`rounded-2xl border-2 ${
          selected ? "ring-2 ring-[#00E0AA] ring-offset-2 border-[#00E0AA]" : "border-border"
        } bg-gradient-to-br from-violet-500/10 to-purple-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[260px] antialiased`}
        style={{ backfaceVisibility: "hidden", transform: "translateZ(0)" }}
      >
        <div className="px-4 py-3 border-b border-violet-500/20 bg-violet-500/5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-violet-500/20 p-1.5">
              <Copy className="h-4 w-4 text-violet-500" />
            </div>
            <div className="font-semibold text-sm">Manual Copy Trade</div>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground">
            Click to configure wallet list and consensus rules
          </div>
        </div>

        <Handle
          type="target"
          position={Position.Left}
          className="!bg-violet-500 !border-2 !border-violet-600 !w-3 !h-3"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-violet-500 !border-2 !border-violet-600 !w-3 !h-3"
        />
      </div>
    )
  }

  // Parse wallet count from CSV
  const csvWalletCount = config.walletsCsv
    .split(/[,\n]/)
    .map(w => w.trim())
    .filter(w => w.length > 0 && w.startsWith("0x")).length

  // Get consensus label
  const getConsensusLabel = (mode: ConsensusMode, nRequired?: number): string => {
    switch (mode) {
      case "any":
        return "Any 1"
      case "two_agree":
        return "2 Agree"
      case "n_of_m":
        return `${nRequired || 2} of N`
      case "all":
        return "All"
      default:
        return mode
    }
  }

  // Get status icon and color
  const getStatusDisplay = (status: CopyTradeDecision["status"]) => {
    switch (status) {
      case "executed":
        return { icon: CheckCircle, color: "text-green-500", bg: "bg-green-500/10" }
      case "simulated":
        return { icon: Activity, color: "text-blue-500", bg: "bg-blue-500/10" }
      case "skipped":
        return { icon: XCircle, color: "text-yellow-500", bg: "bg-yellow-500/10" }
      case "filtered":
        return { icon: Filter, color: "text-gray-500", bg: "bg-gray-500/10" }
      case "error":
        return { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10" }
      default:
        return { icon: Clock, color: "text-gray-500", bg: "bg-gray-500/10" }
    }
  }

  return (
    <div
      data-testid="manual-copy-trade-node"
      className={`rounded-2xl border-2 ${borderColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-violet-500/10 to-purple-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[320px] max-w-[360px] antialiased`}
      style={{ backfaceVisibility: "hidden", transform: "translateZ(0)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-violet-500/20 bg-violet-500/5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-violet-500/20 p-1.5">
              <Copy className="h-4 w-4 text-violet-500" />
            </div>
            <div className="font-semibold text-sm">Manual Copy Trade</div>
          </div>

          {/* Status Badge */}
          <div
            className={`px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 ${
              isEngineRunning
                ? "bg-green-500/20 text-green-700 dark:text-green-300"
                : "bg-gray-500/20 text-gray-700 dark:text-gray-300"
            }`}
          >
            {isEngineRunning ? (
              <>
                <Activity className="h-2.5 w-2.5 animate-pulse" />
                Running
              </>
            ) : (
              <>
                <Square className="h-2.5 w-2.5" />
                Stopped
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        {/* Dry Run Warning */}
        {config.dryRun && (
          <div className="flex items-start gap-2 text-xs bg-blue-500/10 border border-blue-500/20 rounded-lg px-2 py-1.5">
            <AlertCircle className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
            <span className="text-blue-700 dark:text-blue-300">
              Dry-run mode: No real trades executed
            </span>
          </div>
        )}

        {/* Wallet Count */}
        <div className="flex items-center gap-2 text-xs">
          <Users className="h-3 w-3 text-violet-500/70" />
          <span>
            {csvWalletCount} wallet{csvWalletCount !== 1 ? "s" : ""} configured
          </span>
        </div>

        {/* Consensus Mode */}
        <div className="flex items-center gap-2 text-xs">
          <Settings className="h-3 w-3 text-violet-500/70" />
          <span>
            Consensus: <span className="font-semibold">{getConsensusLabel(config.consensusMode, config.nRequired)}</span>
          </span>
        </div>

        {/* Market Filter Status */}
        {allowedConditionIds && allowedConditionIds.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <Filter className="h-3 w-3 text-violet-500/70" />
            <span>{allowedConditionIds.length} markets filtered</span>
          </div>
        )}

        {/* Control Buttons */}
        <div className="flex gap-2">
          {!isEngineRunning ? (
            <button
              onClick={startEngine}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-semibold hover:bg-violet-600 transition-colors"
            >
              <Play className="h-3 w-3" />
              Start Watching
            </button>
          ) : (
            <button
              onClick={stopEngine}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
          )}
          <button
            onClick={fetchLogs}
            disabled={isLoadingLogs}
            className="px-2 py-1.5 rounded-lg border border-border text-xs hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isLoadingLogs ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Recent Decisions Log */}
        {decisions.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground font-semibold">
              Recent Decisions ({decisions.length})
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
              {decisions.slice(0, 10).map((decision) => {
                const statusDisplay = getStatusDisplay(decision.status)
                const StatusIcon = statusDisplay.icon

                return (
                  <div
                    key={decision.decisionId}
                    className={`flex items-center justify-between text-xs ${statusDisplay.bg} rounded px-2 py-1`}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <StatusIcon className={`h-3 w-3 shrink-0 ${statusDisplay.color}`} />
                      <span className="font-mono truncate">
                        {decision.sourceWallet.slice(0, 6)}...
                      </span>
                      <span className={decision.side === "buy" ? "text-green-600" : "text-red-600"}>
                        {decision.side.toUpperCase()}
                      </span>
                      <span className="text-muted-foreground truncate">
                        {decision.outcome}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-muted-foreground">
                        {decision.matchedCount}/{decision.requiredCount}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Empty State */}
        {decisions.length === 0 && isEngineRunning && (
          <div className="text-xs text-muted-foreground text-center py-3 bg-muted/20 rounded-lg">
            Watching for trades...
          </div>
        )}

        {decisions.length === 0 && !isEngineRunning && (
          <div className="text-xs text-muted-foreground text-center py-3 bg-muted/20 rounded-lg">
            Start watching to see trade decisions
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-violet-500 !border-2 !border-violet-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-violet-500 !border-2 !border-violet-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(ManualCopyTradeNode)
