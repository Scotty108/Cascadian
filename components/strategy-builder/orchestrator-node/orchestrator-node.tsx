/**
 * ORCHESTRATOR NODE COMPONENT
 *
 * Task Group 14.2: ReactFlow node for portfolio orchestrator
 * - Shield icon to represent portfolio management
 * - Mode badge: "Autonomous" or "Approval Required"
 * - Pending decisions count badge
 * - Compatible with ReactFlow patterns
 * - Violet/indigo color scheme
 */

"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { Shield } from "lucide-react"
import type { OrchestratorConfig } from "@/lib/strategy-builder/types"

interface OrchestratorNodeProps {
  data: {
    config?: OrchestratorConfig
    status?: "idle" | "running" | "completed" | "error"
    pendingDecisions?: number
  }
  selected?: boolean
  id: string
}

function OrchestratorNode({ data, selected, id }: OrchestratorNodeProps) {
  const config = data.config
  const pendingDecisions = data.pendingDecisions || 0

  // Check if configured
  const isConfigured = config && config.version === 1

  // If not configured, show basic setup prompt
  if (!isConfigured || !config) {
    return (
      <div
        data-testid="orchestrator-node"
        className={`rounded-2xl border-2 ${
          selected ? "ring-2 ring-[#00E0AA] ring-offset-2 border-[#00E0AA]" : "border-border"
        } bg-gradient-to-br from-violet-500/10 to-indigo-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[220px] antialiased`}
        style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
      >
        <div className="px-4 py-3 border-b border-violet-500/20 bg-violet-500/5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-violet-500/20 p-1.5">
              <Shield className="h-4 w-4 text-violet-500" />
            </div>
            <div className="font-semibold text-sm">Portfolio Orchestrator</div>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground">
            Click to configure position sizing
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

  // Determine status color
  const statusColor = {
    idle: "border-border",
    running: "border-violet-500 bg-violet-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  // Mode badge styling
  const modeBadgeClass = config.mode === 'autonomous'
    ? "bg-green-500/20 text-green-700 dark:text-green-300"
    : "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300"

  // Pending decisions badge styling
  const hasPending = pendingDecisions > 0

  return (
    <div
      data-testid="orchestrator-node"
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-violet-500/10 to-indigo-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[240px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-violet-500/20 bg-violet-500/5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-violet-500/20 p-1.5">
              <Shield className="h-4 w-4 text-violet-500" />
            </div>
            <div className="font-semibold text-sm">Portfolio Orchestrator</div>
          </div>

          {/* Mode Badge */}
          <div
            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${modeBadgeClass}`}
          >
            {config.mode === 'autonomous' ? 'Autonomous' : 'Approval'}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-2">
        {/* Portfolio Info */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Portfolio:</span>
          <span className="font-semibold">${config.portfolio_size_usd.toLocaleString()}</span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Risk Level:</span>
          <span className={`font-semibold ${
            config.risk_tolerance <= 3
              ? 'text-green-600 dark:text-green-400'
              : config.risk_tolerance <= 7
              ? 'text-yellow-600 dark:text-yellow-400'
              : 'text-red-600 dark:text-red-400'
          }`}>
            {config.risk_tolerance}/10
          </span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Kelly Fraction:</span>
          <span className="font-semibold text-violet-600 dark:text-violet-400">
            {config.position_sizing_rules.fractional_kelly_lambda.toFixed(2)}
          </span>
        </div>

        {/* Max Position */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Max Position:</span>
          <span className="font-semibold">
            {Math.round(config.position_sizing_rules.max_per_position * 100)}%
          </span>
        </div>

        {/* Bet Range */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Bet Range:</span>
          <span className="font-semibold">
            ${config.position_sizing_rules.min_bet} - ${config.position_sizing_rules.max_bet}
          </span>
        </div>

        {/* Drawdown Protection Badge */}
        {config.position_sizing_rules.drawdown_protection?.enabled && (
          <div className="mt-2">
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/20">
              <Shield className="h-3 w-3 text-blue-500" />
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                Drawdown Protected
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Pending Decisions Badge */}
      {hasPending && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 py-2">
            <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-bold text-red-600 dark:text-red-400">
              {pendingDecisions} {pendingDecisions === 1 ? 'decision' : 'decisions'} pending
            </span>
          </div>
        </div>
      )}

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

export default memo(OrchestratorNode)
