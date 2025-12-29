/**
 * MARKET FILTER NODE COMPONENT
 *
 * Strategy Builder node for filtering markets using Dome API.
 * Maps 1:1 to /api/markets/search fields.
 *
 * Features:
 * - Tag/category selection
 * - Volume threshold
 * - Status filter (open/closed)
 * - Event slug filter
 * - Data source badge
 */

"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { Filter, Globe, Tag, DollarSign, Clock } from "lucide-react"
import type { MarketFilterConfig } from "@/lib/strategy-builder/types"

// Extended config that supports both V1 format and legacy MARKET_FILTER format
interface ExtendedMarketConfig {
  version?: 1
  tags?: string[]
  status?: 'open' | 'closed'
  min_volume?: number
  event_slug?: string[]
  start_time?: number
  end_time?: number
  limit?: number
  // Legacy fields from MARKET_FILTER for config panel compatibility
  filter_type?: string
  categories?: string[]
  conditions?: Array<{ field: string; operator: string; value: string | number }>
  sorting?: { primary?: string; secondary?: string }
}

interface MarketFilterNodeProps {
  data: {
    config?: ExtendedMarketConfig
    status?: "idle" | "running" | "completed" | "error"
  }
  selected?: boolean
  id: string
}

function MarketFilterNode({ data, selected, id }: MarketFilterNodeProps) {
  const config = data.config

  // Check if configured - supports both V1 and legacy formats
  const isConfigured = config && (config.version === 1 || config.filter_type === 'MARKET_FILTER')

  // If not configured, show setup prompt
  if (!isConfigured || !config) {
    return (
      <div
        data-testid="market-filter-node"
        className={`rounded-2xl border-2 ${
          selected ? "ring-2 ring-[#00E0AA] ring-offset-2 border-[#00E0AA]" : "border-border"
        } bg-gradient-to-br from-cyan-500/10 to-teal-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[220px] antialiased`}
        style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
      >
        <div className="px-4 py-3 border-b border-cyan-500/20 bg-cyan-500/5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-cyan-500/20 p-1.5">
              <Filter className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="font-semibold text-sm">Market Filter</div>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground">
            Click to configure market filters
          </div>
        </div>

        <Handle
          type="target"
          position={Position.Left}
          className="!bg-cyan-500 !border-2 !border-cyan-600 !w-3 !h-3"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-cyan-500 !border-2 !border-cyan-600 !w-3 !h-3"
        />
      </div>
    )
  }

  // Count active filters - include both V1 and legacy
  const v1FilterCount = [
    config.tags?.length ? 1 : 0,
    config.status ? 1 : 0,
    config.min_volume ? 1 : 0,
    config.event_slug?.length ? 1 : 0,
    config.start_time || config.end_time ? 1 : 0,
  ].reduce((a, b) => a + b, 0)
  const legacyFilterCount = (config.categories?.length ? 1 : 0) + (config.conditions?.length || 0)
  const filterCount = v1FilterCount + legacyFilterCount

  const statusColor = {
    idle: "border-border",
    running: "border-cyan-500 bg-cyan-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  return (
    <div
      data-testid="market-filter-node"
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-cyan-500/10 to-teal-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[240px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-cyan-500/20 bg-cyan-500/5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-cyan-500/20 p-1.5">
              <Filter className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="font-semibold text-sm">Market Filter</div>
          </div>

          {/* Data Source Badge */}
          <div className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-700 dark:text-blue-300 flex items-center gap-1">
            <Globe className="h-2.5 w-2.5" />
            Dome
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-2">
        {/* Filter Count */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Active filters:</span>
          <span className={`font-semibold ${filterCount > 0 ? 'text-cyan-600 dark:text-cyan-400' : 'text-muted-foreground'}`}>
            {filterCount}
          </span>
        </div>

        {/* Tags Preview */}
        {config.tags && config.tags.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <Tag className="h-3 w-3 text-cyan-500/70" />
            <span className="truncate">
              {config.tags.slice(0, 3).join(', ')}
              {config.tags.length > 3 && ` +${config.tags.length - 3}`}
            </span>
          </div>
        )}

        {/* Volume Threshold */}
        {config.min_volume && (
          <div className="flex items-center gap-2 text-xs">
            <DollarSign className="h-3 w-3 text-cyan-500/70" />
            <span>Min volume: ${config.min_volume.toLocaleString()}</span>
          </div>
        )}

        {/* Status Filter */}
        {config.status && (
          <div className="flex items-center gap-2 text-xs">
            <Clock className="h-3 w-3 text-cyan-500/70" />
            <span className="capitalize">Status: {config.status}</span>
          </div>
        )}

        {/* Limit */}
        {config.limit && (
          <div className="text-xs text-muted-foreground">
            Limit: {config.limit} markets
          </div>
        )}

        {/* Legacy Categories */}
        {config.categories && config.categories.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {config.categories.slice(0, 3).map((cat, idx) => (
              <span key={idx} className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                {cat}
              </span>
            ))}
            {config.categories.length > 3 && (
              <span className="text-xs text-muted-foreground">+{config.categories.length - 3}</span>
            )}
          </div>
        )}

        {/* Legacy Sorting */}
        {config.sorting?.primary && (
          <div className="text-xs text-muted-foreground">
            Sort: {config.sorting.primary.replace(' DESC', ' ↓').replace(' ASC', ' ↑')}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-cyan-500 !border-2 !border-cyan-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-cyan-500 !border-2 !border-cyan-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(MarketFilterNode)
