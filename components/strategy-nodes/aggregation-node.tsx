"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { BarChart3 } from "lucide-react"
import type { AggregationConfig } from "@/lib/strategy-builder/types"

interface AggregationNodeProps {
  data: {
    config?: AggregationConfig
    status?: "idle" | "running" | "completed" | "error"
  }
  selected?: boolean
}

function AggregationNode({ data, selected }: AggregationNodeProps) {
  const config = data.config || {
    function: "COUNT",
  }

  const getAggregationFormula = () => {
    const func = config.function
    const field = config.field

    if (func === "COUNT") {
      return "COUNT(*)"
    }

    if (func === "PERCENTILE" && config.percentile) {
      return `P${config.percentile}(${field || "value"})`
    }

    return `${func}(${field || "value"})`
  }

  const statusColor = {
    idle: "border-border",
    running: "border-orange-500 bg-orange-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  return (
    <div
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-orange-500/10 to-orange-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[200px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      <div className="px-4 py-3 border-b border-orange-500/20 bg-orange-500/5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-orange-500/20 p-1.5">
            <BarChart3 className="h-4 w-4 text-orange-500" />
          </div>
          <div className="font-semibold text-sm">Aggregation</div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="text-sm font-mono bg-muted/50 rounded-lg px-3 py-2 border border-orange-500/20">
          <div className="text-orange-600 dark:text-orange-400 font-semibold text-center">
            {getAggregationFormula()}
          </div>
        </div>

        {config.groupBy && config.groupBy.length > 0 && (
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="font-medium">Group By:</div>
            <div className="bg-orange-500/10 rounded-md px-2 py-1">
              {config.groupBy.join(", ")}
            </div>
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-orange-500 !border-2 !border-orange-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-orange-500 !border-2 !border-orange-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(AggregationNode)
