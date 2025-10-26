"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { Zap, ListPlus, Bell, FileText, Webhook } from "lucide-react"
import type { ActionConfig } from "@/lib/strategy-builder/types"

interface ActionNodeProps {
  data: {
    config?: ActionConfig
    status?: "idle" | "running" | "completed" | "error"
  }
  selected?: boolean
}

function ActionNode({ data, selected }: ActionNodeProps) {
  const config = data.config || {
    action: "LOG_RESULT",
  }

  const getActionIcon = () => {
    switch (config.action) {
      case "ADD_TO_WATCHLIST":
        return <ListPlus className="h-4 w-4 text-pink-500" />
      case "REMOVE_FROM_WATCHLIST":
        return <ListPlus className="h-4 w-4 text-pink-500" />
      case "SEND_ALERT":
        return <Bell className="h-4 w-4 text-pink-500" />
      case "LOG_RESULT":
        return <FileText className="h-4 w-4 text-pink-500" />
      case "WEBHOOK":
        return <Webhook className="h-4 w-4 text-pink-500" />
      default:
        return <Zap className="h-4 w-4 text-pink-500" />
    }
  }

  const getActionLabel = () => {
    switch (config.action) {
      case "ADD_TO_WATCHLIST":
        return "Add to Watchlist"
      case "REMOVE_FROM_WATCHLIST":
        return "Remove from Watchlist"
      case "SEND_ALERT":
        return "Send Alert"
      case "LOG_RESULT":
        return "Log Result"
      case "WEBHOOK":
        return "Webhook"
      default:
        return config.action
    }
  }

  const statusColor = {
    idle: "border-border",
    running: "border-pink-500 bg-pink-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  return (
    <div
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-pink-500/10 to-pink-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[200px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      <div className="px-4 py-3 border-b border-pink-500/20 bg-pink-500/5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-pink-500/20 p-1.5">
            {getActionIcon()}
          </div>
          <div className="font-semibold text-sm">Action</div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="text-sm font-medium text-center text-pink-600 dark:text-pink-400">
          {getActionLabel()}
        </div>

        {config.params && Object.keys(config.params).length > 0 && (
          <div className="text-xs text-muted-foreground bg-pink-500/10 rounded-md px-2 py-1 space-y-1">
            {Object.entries(config.params).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2">
                <span className="font-medium">{key}:</span>
                <span className="truncate" title={String(value)}>
                  {String(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-pink-500 !border-2 !border-pink-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(ActionNode)
