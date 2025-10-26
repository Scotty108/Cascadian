"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { GitMerge } from "lucide-react"
import type { LogicConfig } from "@/lib/strategy-builder/types"

interface LogicNodeProps {
  data: {
    config?: LogicConfig
    status?: "idle" | "running" | "completed" | "error"
  }
  selected?: boolean
}

function LogicNode({ data, selected }: LogicNodeProps) {
  const config = data.config || {
    operator: "AND",
    inputs: [],
  }

  const getOperatorColor = (operator: string) => {
    switch (operator) {
      case "AND":
        return "text-green-600 dark:text-green-400"
      case "OR":
        return "text-blue-600 dark:text-blue-400"
      case "NOT":
        return "text-red-600 dark:text-red-400"
      case "XOR":
        return "text-orange-600 dark:text-orange-400"
      default:
        return "text-foreground"
    }
  }

  const getOperatorDescription = (operator: string) => {
    switch (operator) {
      case "AND":
        return "All conditions must match"
      case "OR":
        return "Any condition can match"
      case "NOT":
        return "Inverts the condition"
      case "XOR":
        return "Exactly one must match"
      default:
        return ""
    }
  }

  const statusColor = {
    idle: "border-border",
    running: "border-green-500 bg-green-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  return (
    <div
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-green-500/10 to-green-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[180px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      <div className="px-4 py-3 border-b border-green-500/20 bg-green-500/5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-green-500/20 p-1.5">
            <GitMerge className="h-4 w-4 text-green-500" />
          </div>
          <div className="font-semibold text-sm">Logic</div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="text-center">
          <div className={`text-2xl font-bold ${getOperatorColor(config.operator)}`}>
            {config.operator}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {getOperatorDescription(config.operator)}
          </div>
        </div>

        <div className="text-xs text-center text-muted-foreground bg-muted/50 rounded-md px-2 py-1">
          {(config.inputs?.length || 0)} input{(config.inputs?.length || 0) !== 1 ? "s" : ""}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-green-500 !border-2 !border-green-600 !w-3 !h-3"
        style={{ top: "30%" }}
        id="input-1"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-green-500 !border-2 !border-green-600 !w-3 !h-3"
        style={{ top: "70%" }}
        id="input-2"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-green-500 !border-2 !border-green-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(LogicNode)
