"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { Filter } from "lucide-react"
import type { FilterConfig } from "@/lib/strategy-builder/types"

interface FilterNodeProps {
  data: {
    config?: FilterConfig
    status?: "idle" | "running" | "completed" | "error"
  }
  selected?: boolean
}

function FilterNode({ data, selected }: FilterNodeProps) {
  const config = data.config || {
    field: "omega_ratio",
    operator: "GREATER_THAN",
    value: 1.5,
  }

  const getOperatorSymbol = (operator: string) => {
    switch (operator) {
      case "EQUALS":
        return "="
      case "NOT_EQUALS":
        return "!="
      case "GREATER_THAN":
        return ">"
      case "GREATER_THAN_OR_EQUAL":
        return ">="
      case "LESS_THAN":
        return "<"
      case "LESS_THAN_OR_EQUAL":
        return "<="
      case "IN":
        return "IN"
      case "NOT_IN":
        return "NOT IN"
      case "CONTAINS":
        return "CONTAINS"
      case "BETWEEN":
        return "BETWEEN"
      case "IS_NULL":
        return "IS NULL"
      case "IS_NOT_NULL":
        return "IS NOT NULL"
      case "IN_PERCENTILE":
        return "IN TOP"
      case "NOT_IN_PERCENTILE":
        return "NOT IN TOP"
      default:
        return operator
    }
  }

  const formatValue = (value: any) => {
    if (Array.isArray(value)) {
      return `[${value.join(", ")}]`
    }
    if (typeof value === "string") {
      return `"${value}"`
    }
    return String(value)
  }

  const statusColor = {
    idle: "border-border",
    running: "border-purple-500 bg-purple-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  return (
    <div
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-purple-500/10 to-purple-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[200px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      <div className="px-4 py-3 border-b border-purple-500/20 bg-purple-500/5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-purple-500/20 p-1.5">
            <Filter className="h-4 w-4 text-purple-500" />
          </div>
          <div className="font-semibold text-sm">Filter</div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="text-sm font-mono bg-muted/50 rounded-lg px-3 py-2 border border-purple-500/20">
          <div className="text-foreground">
            <span className="text-purple-600 dark:text-purple-400 font-semibold">{config.field}</span>
            <span className="mx-2 text-muted-foreground">{getOperatorSymbol(config.operator)}</span>
            <span className="text-purple-600 dark:text-purple-400 font-semibold">{formatValue(config.value)}</span>
          </div>
        </div>

        {config.categorySpecific?.enabled && (
          <div className="text-xs text-muted-foreground bg-purple-500/10 rounded-md px-2 py-1">
            Category: {config.categorySpecific.category}
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

export default memo(FilterNode)
