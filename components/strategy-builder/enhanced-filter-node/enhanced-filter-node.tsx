/**
 * ENHANCED FILTER NODE COMPONENT
 *
 * Task Group 7.2: ReactFlow node for enhanced multi-condition filtering
 * - Displays condition count badge (e.g., "3 conditions")
 * - Shows AND/OR logic indicator
 * - Compatible with ReactFlow patterns
 * - Extends existing filter node UI
 */

"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { Filter, Layers } from "lucide-react"
import type { EnhancedFilterConfig } from "@/lib/strategy-builder/types"

interface EnhancedFilterNodeProps {
  data: {
    config?: EnhancedFilterConfig
    status?: "idle" | "running" | "completed" | "error"
  }
  selected?: boolean
  id: string
}

function EnhancedFilterNode({ data, selected, id }: EnhancedFilterNodeProps) {
  const config = data.config

  // Check if this is an enhanced filter (version 2)
  const isEnhanced = config && config.version === 2

  // If not enhanced, show basic summary
  if (!isEnhanced || !config) {
    return (
      <div
        data-testid="enhanced-filter-node"
        className={`rounded-2xl border-2 ${
          selected ? "ring-2 ring-[#00E0AA] ring-offset-2 border-[#00E0AA]" : "border-border"
        } bg-gradient-to-br from-purple-500/10 to-purple-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[200px] antialiased`}
        style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
      >
        <div className="px-4 py-3 border-b border-purple-500/20 bg-purple-500/5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-purple-500/20 p-1.5">
              <Filter className="h-4 w-4 text-purple-500" />
            </div>
            <div className="font-semibold text-sm">Enhanced Filter</div>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground">
            No conditions configured
          </div>
        </div>

        <Handle
          type="target"
          position={Position.Left}
          className="!bg-purple-500 !border-2 !border-purple-600 !w-3 !h-3"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-purple-500 !border-2 !border-purple-600 !w-3 !h-3"
        />
      </div>
    )
  }

  const conditionCount = config.conditions.length
  const logic = config.logic

  // Determine validation status
  const hasEmptyConditions = config.conditions.some(
    (c) => !c.field || !c.operator || c.value === null || c.value === undefined || c.value === ''
  )
  const isValid = conditionCount > 0 && !hasEmptyConditions

  const statusColor = {
    idle: isValid ? "border-border" : "border-red-500/50",
    running: "border-purple-500 bg-purple-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  const summaryColor = isValid ? "text-purple-600 dark:text-purple-400" : "text-red-500"

  // Create a preview of the first condition
  const firstCondition = config.conditions[0]
  const previewText = firstCondition
    ? `${firstCondition.field} ${firstCondition.operator} ${
        typeof firstCondition.value === 'string' && firstCondition.value.length > 20
          ? firstCondition.value.substring(0, 20) + '...'
          : firstCondition.value
      }`
    : 'No conditions'

  return (
    <div
      data-testid="enhanced-filter-node"
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-purple-500/10 to-purple-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[220px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-purple-500/20 bg-purple-500/5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-purple-500/20 p-1.5">
              <Layers className="h-4 w-4 text-purple-500" />
            </div>
            <div className="font-semibold text-sm">Enhanced Filter</div>
          </div>

          {/* Condition Count Badge */}
          <div
            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              isValid
                ? "bg-purple-500/20 text-purple-700 dark:text-purple-300"
                : "bg-red-500/20 text-red-700 dark:text-red-300"
            }`}
          >
            {conditionCount} {conditionCount === 1 ? 'condition' : 'conditions'}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-2">
        {/* Logic Indicator */}
        {conditionCount > 1 && (
          <div className="flex items-center gap-2 mb-2">
            <div className="px-2 py-1 bg-purple-500/10 rounded-md border border-purple-500/20">
              <span className="text-xs font-bold text-purple-600 dark:text-purple-400">
                {logic}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">logic</span>
          </div>
        )}

        {/* First Condition Preview */}
        <div className="text-sm font-mono bg-muted/50 rounded-lg px-3 py-2 border border-purple-500/20">
          <div className={`${summaryColor} truncate`}>
            {previewText}
          </div>
        </div>

        {/* Additional Conditions Indicator */}
        {conditionCount > 1 && (
          <div className="text-xs text-muted-foreground">
            + {conditionCount - 1} more {conditionCount - 1 === 1 ? 'condition' : 'conditions'}
          </div>
        )}

        {/* Validation Error */}
        {!isValid && (
          <div className="text-xs text-red-500 mt-2">
            Configure all conditions to enable
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-purple-500 !border-2 !border-purple-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-purple-500 !border-2 !border-purple-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(EnhancedFilterNode)
