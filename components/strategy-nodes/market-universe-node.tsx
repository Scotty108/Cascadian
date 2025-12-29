/**
 * MARKET UNIVERSE NODE COMPONENT
 *
 * Strategy Builder node that displays the count and sample of markets
 * that pass through filters.
 *
 * Features:
 * - Shows total count of matching markets
 * - Displays sample of market titles
 * - Groups by event_slug when present
 * - Data source badge
 */

"use client"

import { memo, useEffect, useState } from "react"
import { Handle, Position } from "@xyflow/react"
import { Globe2, ListFilter, Layers, RefreshCw } from "lucide-react"
import type { MarketUniverseConfig } from "@/lib/strategy-builder/types"

interface MarketPreview {
  market_slug: string
  title: string
  event_slug?: string
  status: string
}

interface MarketUniverseNodeProps {
  data: {
    config?: MarketUniverseConfig
    status?: "idle" | "running" | "completed" | "error"
    // Data passed from upstream filter node
    markets?: MarketPreview[]
    totalCount?: number
  }
  selected?: boolean
  id: string
}

function MarketUniverseNode({ data, selected, id }: MarketUniverseNodeProps) {
  const config = data.config
  const markets = data.markets || []
  const totalCount = data.totalCount || markets.length

  // Check if configured
  const isConfigured = config && config.version === 1

  // Group markets by event if enabled
  const eventGroups = new Map<string, MarketPreview[]>()
  if (config?.group_by_event) {
    for (const market of markets) {
      const key = market.event_slug || 'Ungrouped'
      if (!eventGroups.has(key)) {
        eventGroups.set(key, [])
      }
      eventGroups.get(key)!.push(market)
    }
  }

  const statusColor = {
    idle: "border-border",
    running: "border-emerald-500 bg-emerald-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  // If not configured, show setup prompt
  if (!isConfigured) {
    return (
      <div
        data-testid="market-universe-node"
        className={`rounded-2xl border-2 ${
          selected ? "ring-2 ring-[#00E0AA] ring-offset-2 border-[#00E0AA]" : "border-border"
        } bg-gradient-to-br from-emerald-500/10 to-green-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[220px] antialiased`}
        style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
      >
        <div className="px-4 py-3 border-b border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-500/20 p-1.5">
              <Globe2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="font-semibold text-sm">Market Universe</div>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground">
            Connect to a Market Filter to see results
          </div>
        </div>

        <Handle
          type="target"
          position={Position.Left}
          className="!bg-emerald-500 !border-2 !border-emerald-600 !w-3 !h-3"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-emerald-500 !border-2 !border-emerald-600 !w-3 !h-3"
        />
      </div>
    )
  }

  const sampleCount = config.show_sample_count || 3

  return (
    <div
      data-testid="market-universe-node"
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-emerald-500/10 to-green-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[260px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-500/20 p-1.5">
              <Globe2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="font-semibold text-sm">Market Universe</div>
          </div>

          {/* Count Badge */}
          <div className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
            {totalCount.toLocaleString()} markets
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        {/* Loading state */}
        {data.status === 'running' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Loading markets...
          </div>
        )}

        {/* Empty state */}
        {data.status !== 'running' && markets.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No markets match the current filters
          </div>
        )}

        {/* Grouped by event */}
        {config.group_by_event && eventGroups.size > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Layers className="h-3 w-3" />
              {eventGroups.size} event{eventGroups.size !== 1 ? 's' : ''}
            </div>
            {Array.from(eventGroups.entries()).slice(0, 3).map(([event, eventMarkets]) => (
              <div key={event} className="bg-muted/30 rounded-lg px-2 py-1.5">
                <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 truncate">
                  {event}
                </div>
                <div className="text-xs text-muted-foreground">
                  {eventMarkets.length} market{eventMarkets.length !== 1 ? 's' : ''}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Simple market list (when not grouping) */}
        {!config.group_by_event && markets.length > 0 && (
          <div className="space-y-1">
            {markets.slice(0, sampleCount).map((market, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs">
                <ListFilter className="h-3 w-3 text-emerald-500/70 mt-0.5 shrink-0" />
                <span className="truncate">{market.title}</span>
              </div>
            ))}
            {markets.length > sampleCount && (
              <div className="text-xs text-muted-foreground pl-5">
                + {markets.length - sampleCount} more
              </div>
            )}
          </div>
        )}

        {/* Event context hint */}
        {markets.some(m => m.event_slug) && !config.group_by_event && (
          <div className="text-xs text-muted-foreground bg-emerald-500/10 rounded px-2 py-1">
            Tip: Enable &quot;Group by event&quot; to see event context
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-emerald-500 !border-2 !border-emerald-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-emerald-500 !border-2 !border-emerald-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(MarketUniverseNode)
