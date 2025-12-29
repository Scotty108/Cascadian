/**
 * WALLET COHORT NODE COMPONENT
 *
 * Strategy Builder node for selecting high-confidence wallet cohorts.
 * Queries internal DB for percentile-based filters.
 *
 * Features:
 * - Top X% PnL filter
 * - Trade count filter
 * - CLOB-only filter
 * - Omega filter (disabled, coming soon)
 * - Data source badge showing Internal DB
 */

"use client"

import { memo, useEffect, useState, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
import { Users, Database, TrendingUp, Hash, Filter, AlertCircle, RefreshCw } from "lucide-react"
import type { WalletCohortConfig } from "@/lib/strategy-builder/types"

interface WalletCohortMember {
  wallet_address: string
  realized_pnl_estimate: number | null
  trade_count: number
  confidence_label: string
}

// Extended config that supports both V1 format and legacy WALLET_FILTER format
interface ExtendedWalletConfig {
  version?: 1
  pnl_percentile?: number
  omega_percentile?: number
  min_trade_count?: number
  clob_only?: boolean
  time_window?: string
  limit?: number
  // Legacy fields from WALLET_FILTER for config panel compatibility
  filter_type?: string
  categories?: string[]
  conditions?: Array<{ metric: string; operator: string; value: string | number }>
  sorting?: { primary?: string; secondary?: string; tertiary?: string }
}

interface WalletCohortNodeProps {
  data: {
    config?: ExtendedWalletConfig
    status?: "idle" | "running" | "completed" | "error"
  }
  selected?: boolean
  id: string
}

function WalletCohortNode({ data, selected, id }: WalletCohortNodeProps) {
  const config = data.config

  const [wallets, setWallets] = useState<WalletCohortMember[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'clickhouse' | 'mock'>('clickhouse')

  // Fetch cohort from API
  const fetchCohort = useCallback(async () => {
    if (!config) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/wallets/cohort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pnl_percentile: config.pnl_percentile,
          min_trade_count: config.min_trade_count,
          clob_only: config.clob_only,
          time_window: config.time_window,
          limit: config.limit,
        }),
      })

      const result = await response.json()

      if (result.success && result.data) {
        setWallets(result.data.wallets)
        setTotalCount(result.data.total_matching)
        setDataSource(result.data.source)
      } else {
        setError(result.error || 'Failed to fetch cohort')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [config])

  // Fetch on config change - supports both v1 and legacy configs
  useEffect(() => {
    // Trigger fetch if we have either v1 config OR legacy config with conditions
    const hasV1Config = config?.version === 1
    const hasLegacyConfig = config?.filter_type === 'WALLET_FILTER'
    if (hasV1Config || hasLegacyConfig) {
      fetchCohort()
    }
  }, [config, fetchCohort])

  // Check if configured - supports both formats
  const isConfigured = config && (config.version === 1 || config.filter_type === 'WALLET_FILTER')

  // Status color
  const statusColor = {
    idle: "border-border",
    running: "border-pink-500 bg-pink-500/5",
    completed: "border-green-500 bg-green-500/5",
    error: "border-red-500 bg-red-500/5",
  }[data.status || "idle"]

  // If not configured, show setup prompt
  if (!isConfigured) {
    return (
      <div
        data-testid="wallet-cohort-node"
        className={`rounded-2xl border-2 ${
          selected ? "ring-2 ring-[#00E0AA] ring-offset-2 border-[#00E0AA]" : "border-border"
        } bg-gradient-to-br from-pink-500/10 to-rose-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[220px] antialiased`}
        style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
      >
        <div className="px-4 py-3 border-b border-pink-500/20 bg-pink-500/5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-pink-500/20 p-1.5">
              <Users className="h-4 w-4 text-pink-500" />
            </div>
            <div className="font-semibold text-sm">Wallet Cohort</div>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground">
            Click to configure wallet filters
          </div>
        </div>

        <Handle
          type="target"
          position={Position.Left}
          className="!bg-pink-500 !border-2 !border-pink-600 !w-3 !h-3"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-pink-500 !border-2 !border-pink-600 !w-3 !h-3"
        />
      </div>
    )
  }

  // Count active filters - include both v1 and legacy filters
  const v1FilterCount = [
    config.pnl_percentile !== undefined ? 1 : 0,
    config.min_trade_count ? 1 : 0,
    config.clob_only ? 1 : 0,
  ].reduce((a, b) => a + b, 0)
  const legacyFilterCount = config.conditions?.length || 0
  const categoryCount = config.categories?.length || 0
  const filterCount = v1FilterCount + legacyFilterCount + (categoryCount > 0 ? 1 : 0)

  return (
    <div
      data-testid="wallet-cohort-node"
      className={`rounded-2xl border-2 ${statusColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-pink-500/10 to-rose-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[260px] antialiased`}
      style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-pink-500/20 bg-pink-500/5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-pink-500/20 p-1.5">
              <Users className="h-4 w-4 text-pink-500" />
            </div>
            <div className="font-semibold text-sm">Wallet Cohort</div>
          </div>

          {/* Data Source Badge */}
          <div className={`px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 ${
            dataSource === 'mock' ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300' :
            'bg-purple-500/20 text-purple-700 dark:text-purple-300'
          }`}>
            <Database className="h-2.5 w-2.5" />
            {dataSource === 'mock' ? 'Mock' : 'Internal'}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        {/* Active Filters */}
        <div className="flex items-center gap-2 text-xs">
          <Filter className="h-3 w-3 text-pink-500/70" />
          <span className="text-muted-foreground">{filterCount} filter{filterCount !== 1 ? 's' : ''} active</span>
        </div>

        {/* PnL Percentile */}
        {config.pnl_percentile !== undefined && (
          <div className="flex items-center gap-2 text-xs">
            <TrendingUp className="h-3 w-3 text-pink-500/70" />
            <span>Top {config.pnl_percentile}% by PnL</span>
          </div>
        )}

        {/* Min Trade Count */}
        {config.min_trade_count && (
          <div className="flex items-center gap-2 text-xs">
            <Hash className="h-3 w-3 text-pink-500/70" />
            <span>Min {config.min_trade_count} trades</span>
          </div>
        )}

        {/* Omega Placeholder */}
        {config.omega_percentile !== undefined && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            <span>Omega filter coming soon</span>
          </div>
        )}

        {/* Legacy Categories */}
        {config.categories && config.categories.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {config.categories.slice(0, 3).map((cat, idx) => (
              <span key={idx} className="text-xs px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-600 dark:text-pink-400">
                {cat}
              </span>
            ))}
            {config.categories.length > 3 && (
              <span className="text-xs text-muted-foreground">+{config.categories.length - 3}</span>
            )}
          </div>
        )}

        {/* Legacy Conditions */}
        {config.conditions && config.conditions.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {config.conditions.length} performance condition{config.conditions.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Loading cohort...
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="text-xs text-red-500 bg-red-500/10 rounded px-2 py-1">
            {error}
          </div>
        )}

        {/* Results Count */}
        {!isLoading && !error && wallets.length > 0 && (
          <div className="bg-pink-500/10 rounded-lg px-3 py-2">
            <div className="text-lg font-bold text-pink-600 dark:text-pink-400">
              {totalCount.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">
              wallets match • {config.time_window} window
            </div>
          </div>
        )}

        {/* Sample Wallets */}
        {wallets.length > 0 && (
          <div className="space-y-1">
            {wallets.slice(0, 3).map((wallet, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs">
                <span className="font-mono truncate w-24">
                  {wallet.wallet_address.slice(0, 6)}...{wallet.wallet_address.slice(-4)}
                </span>
                <span className={wallet.realized_pnl_estimate && wallet.realized_pnl_estimate > 0 ? 'text-green-500' : 'text-red-500'}>
                  ${wallet.realized_pnl_estimate?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '0'}
                </span>
              </div>
            ))}
            {wallets.length > 3 && (
              <div className="text-xs text-muted-foreground">
                + {wallets.length - 3} more
              </div>
            )}
          </div>
        )}

        {/* Confidence Label */}
        {wallets.length > 0 && (
          <div className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1">
            Confidence: {wallets[0]?.confidence_label || 'INTERNAL_PRE_TIER_A'}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-pink-500 !border-2 !border-pink-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-pink-500 !border-2 !border-pink-600 !w-3 !h-3"
      />
    </div>
  )
}

export default memo(WalletCohortNode)
