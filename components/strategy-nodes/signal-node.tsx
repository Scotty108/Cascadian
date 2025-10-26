"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { Radio, TrendingUp, TrendingDown, Minus } from "lucide-react"
import type { SignalConfig } from "@/lib/strategy-builder/types"

interface SignalNodeProps {
  data: {
    config?: SignalConfig
    status?: "idle" | "running" | "completed" | "error"
  }
  selected?: boolean
}

function SignalNode({ data, selected }: SignalNodeProps) {
  const config = data.config || {
    signalType: "ENTRY",
    condition: "",
  }

  const getSignalIcon = () => {
    if (config.direction === "YES") {
      return <TrendingUp className="h-4 w-4" />
    }
    if (config.direction === "NO") {
      return <TrendingDown className="h-4 w-4" />
    }
    return <Minus className="h-4 w-4" />
  }

  const getSignalColor = () => {
    switch (config.signalType) {
      case "ENTRY":
        return "from-green-500/10 to-green-600/5 border-green-500/30"
      case "EXIT":
        return "from-red-500/10 to-red-600/5 border-red-500/30"
      case "HOLD":
        return "from-yellow-500/10 to-yellow-600/5 border-yellow-500/30"
      default:
        return "from-teal-500/10 to-teal-600/5 border-teal-500/30"
    }
  }

  const getSignalBadgeColor = () => {
    switch (config.signalType) {
      case "ENTRY":
        return "bg-green-500/20 text-green-600 dark:text-green-400"
      case "EXIT":
        return "bg-red-500/20 text-red-600 dark:text-red-400"
      case "HOLD":
        return "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
      default:
        return "bg-teal-500/20 text-teal-600 dark:text-teal-400"
    }
  }

  const getStrengthBars = () => {
    const strengths = {
      WEAK: 1,
      MODERATE: 2,
      STRONG: 3,
      VERY_STRONG: 4,
    }
    const count = strengths[config.strength || "MODERATE"]
    return Array.from({ length: 4 }, (_, i) => (
      <div
        key={i}
        className={`h-2 w-2 rounded-full ${
          i < count ? "bg-teal-500" : "bg-muted"
        }`}
      />
    ))
  }

  const statusColor = {
    idle: "border-border",
    running: "border-teal-500 bg-teal-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  return (
    <div
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br ${getSignalColor()} shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[200px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      <div className="px-4 py-3 border-b border-teal-500/20 bg-teal-500/5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-teal-500/20 p-1.5">
            <Radio className="h-4 w-4 text-teal-500" />
          </div>
          <div className="font-semibold text-sm">Signal</div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className={`text-sm font-semibold px-2 py-1 rounded-md ${getSignalBadgeColor()}`}>
            {config.signalType}
          </span>
          {config.direction && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {getSignalIcon()}
              <span className="font-medium">{config.direction}</span>
            </div>
          )}
        </div>

        {config.strength && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Strength</div>
            <div className="flex gap-1">
              {getStrengthBars()}
            </div>
          </div>
        )}

        {config.positionSize && (
          <div className="text-xs text-muted-foreground bg-teal-500/10 rounded-md px-2 py-1">
            Sizing: {config.positionSize.method}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-teal-500 !border-2 !border-teal-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-teal-500 !border-2 !border-teal-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(SignalNode)
