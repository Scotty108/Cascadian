"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { Database, Table } from "lucide-react"
import type { DataSourceConfig } from "@/lib/strategy-builder/types"

interface DataSourceNodeProps {
  data: {
    config?: DataSourceConfig
    status?: "idle" | "running" | "completed" | "error"
  }
  selected?: boolean
}

function DataSourceNode({ data, selected }: DataSourceNodeProps) {
  const config = data.config || {
    source: "WALLETS",
    mode: "BATCH",
  }

  const getSourceLabel = (source: string) => {
    switch (source) {
      case "WALLETS":
        return "Wallets"
      case "MARKETS":
        return "Markets"
      case "TRADES":
        return "Trades"
      case "SIGNALS":
        return "Signals"
      case "CATEGORIES":
        return "Categories"
      default:
        return source
    }
  }

  const getTableName = () => {
    if (config.prefilters?.table) {
      return config.prefilters.table
    }
    switch (config.source) {
      case "WALLETS":
        return "wallet_metrics_complete"
      case "MARKETS":
        return "markets"
      default:
        return config.source.toLowerCase()
    }
  }

  const statusColor = {
    idle: "border-border",
    running: "border-blue-500 bg-blue-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  return (
    <div
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-blue-500/10 to-blue-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[200px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      <div className="px-4 py-3 border-b border-blue-500/20 bg-blue-500/5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-blue-500/20 p-1.5">
            <Database className="h-4 w-4 text-blue-500" />
          </div>
          <div className="font-semibold text-sm">Data Source</div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Table className="h-3.5 w-3.5 text-blue-500/70" />
          <span className="font-medium text-foreground">{getSourceLabel(config.source)}</span>
          {config.mode === "REALTIME" && (
            <span className="ml-auto text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
              LIVE
            </span>
          )}
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <div>Table: {getTableName()}</div>
          {config.prefilters?.limit && (
            <div>Limit: {config.prefilters.limit.toLocaleString()}</div>
          )}
          {config.prefilters?.where && (
            <div className="truncate" title={config.prefilters.where}>
              Filter: {config.prefilters.where}
            </div>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-blue-500 !border-2 !border-blue-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(DataSourceNode)
