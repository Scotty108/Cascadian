"use client"

import type React from "react"
import { Handle, Position } from "@xyflow/react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Bookmark } from "lucide-react"

export type WatchlistNodeData = {
  label?: string
  config?: {
    reason?: string
    category?: string
    autoMonitor?: boolean
  }
}

export type WatchlistNodeProps = {
  data: WatchlistNodeData
  selected?: boolean
}

export default function WatchlistNode({ data, selected }: WatchlistNodeProps) {
  const label = data.label || "Add to Watchlist"
  const reason = data.config?.reason || "smart-flow"

  return (
    <Card
      className={`min-w-[220px] transition-all ${
        selected ? "ring-2 ring-amber-500 shadow-lg shadow-amber-500/20" : "shadow-md"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-amber-500"
      />

      <CardHeader className="flex flex-row items-center gap-2 space-y-0 bg-gradient-to-r from-amber-500/10 to-amber-500/5 p-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
          <Bookmark className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
          <p className="text-xs text-muted-foreground">Watchlist Action</p>
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-2">
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Reason:</span>
            <span className="font-mono text-amber-600">{reason}</span>
          </div>

          {data.config?.category && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Category:</span>
              <span className="font-mono text-foreground">{data.config.category}</span>
            </div>
          )}

          {data.config?.autoMonitor && (
            <div className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-center">
              <span className="text-xs font-medium text-amber-600">
                Auto-monitor enabled
              </span>
            </div>
          )}
        </div>
      </CardContent>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-amber-500"
      />
    </Card>
  )
}
