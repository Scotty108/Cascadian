"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Strategy } from "@/hooks/use-strategies"
import { Workflow, Plus, ExternalLink, Activity, Zap, TrendingUp, TrendingDown, Minus } from "lucide-react"
import Link from "next/link"
import { LineChart, Line, ResponsiveContainer } from "recharts"
import { useState, useEffect } from "react"

interface StrategyDashboardOverviewProps {
  strategies: Strategy[]
}

interface PerformanceData {
  value: number
}

interface StrategyCardProps {
  strategy: Strategy
}

function StrategyCard({ strategy }: StrategyCardProps) {
  const [performanceData, setPerformanceData] = useState<PerformanceData[]>([])
  const [performanceChange, setPerformanceChange] = useState<number>(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchPerformance() {
      try {
        const response = await fetch(`/api/strategies/${strategy.strategy_id}/performance`)
        if (response.ok) {
          const data = await response.json()
          if (data.performance && data.performance.length > 0) {
            // Use last 10 data points for sparkline
            const recentData = data.performance.slice(-10)
            const chartData = recentData.map((p: any) => ({ value: p.portfolio_value_usd || 0 }))
            setPerformanceData(chartData)

            // Calculate performance change
            const firstValue = recentData[0]?.portfolio_value_usd || 0
            const lastValue = recentData[recentData.length - 1]?.portfolio_value_usd || 0
            setPerformanceChange(firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0)
          } else {
            // No performance data - show flat line at 0
            setPerformanceData(Array(10).fill({ value: 0 }))
            setPerformanceChange(0)
          }
        } else {
          // API error - show flat line at 0
          setPerformanceData(Array(10).fill({ value: 0 }))
          setPerformanceChange(0)
        }
      } catch (error) {
        // Error fetching performance - show flat line at 0
        setPerformanceData(Array(10).fill({ value: 0 }))
        setPerformanceChange(0)
      } finally {
        setLoading(false)
      }
    }
    fetchPerformance()
  }, [strategy.strategy_id])

  return (
    <Link
      href={`/strategies/${strategy.strategy_id}`}
      className="block"
    >
      <Card className="h-full group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/40 hover:shadow-xl cursor-pointer">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between mb-2">
            <Badge
              variant={strategy.is_active ? "default" : "secondary"}
              className={strategy.is_active ? "bg-[#00E0AA] text-slate-950 hover:bg-[#00E0AA]/90" : ""}
            >
              {strategy.is_active ? "ACTIVE" : "PAUSED"}
            </Badge>
            {strategy.is_predefined && (
              <Badge variant="outline" className="text-xs">
                Default
              </Badge>
            )}
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight">
            {strategy.strategy_name}
          </CardTitle>
          <CardDescription className="text-sm line-clamp-2">
            {strategy.strategy_description || "No description provided"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Performance Chart */}
          <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">Performance</span>
              <div className="flex items-center gap-1">
                {performanceChange === 0 ? (
                  <Minus className="h-3 w-3 text-muted-foreground" />
                ) : performanceChange > 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-500" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-500" />
                )}
                <span
                  className={`text-xs font-semibold ${
                    performanceChange === 0
                      ? "text-muted-foreground"
                      : performanceChange > 0
                      ? "text-green-500"
                      : "text-red-500"
                  }`}
                >
                  {performanceChange === 0 ? "0.00" : performanceChange.toFixed(2)}%
                </span>
              </div>
            </div>
            {loading ? (
              <div className="h-10 flex items-center justify-center">
                <div className="animate-pulse text-xs text-muted-foreground">Loading...</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={40}>
                <LineChart data={performanceData}>
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={
                      performanceChange === 0
                        ? "hsl(var(--muted-foreground))"
                        : performanceChange > 0
                        ? "#22c55e"
                        : "#ef4444"
                    }
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/50 bg-muted/30 p-3">
              <div className="text-xs font-medium text-muted-foreground">Type</div>
              <div className="mt-1 text-sm font-bold truncate">{strategy.strategy_type}</div>
            </div>
            <div className="rounded-xl border border-border/50 bg-muted/30 p-3">
              <div className="text-xs font-medium text-muted-foreground">Mode</div>
              <div className="mt-1 text-sm font-bold truncate">{strategy.execution_mode}</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Executions:</span>
              <span className="font-medium">{strategy.total_executions || 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Last Run:</span>
              <span className="font-medium">
                {strategy.last_executed_at
                  ? new Date(strategy.last_executed_at).toLocaleDateString()
                  : "Never"}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Created:</span>
              <span className="font-medium">
                {new Date(strategy.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>

          <div className="pt-2 flex items-center text-xs text-muted-foreground group-hover:text-[#00E0AA] transition">
            <span>View Details</span>
            <ExternalLink className="ml-1 h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export function StrategyDashboardOverview({ strategies }: StrategyDashboardOverviewProps) {
  // Filter out archived strategies from the dashboard view
  const nonArchivedStrategies = strategies.filter(s => !s.is_archived)

  const activeStrategies = nonArchivedStrategies.filter(s => s.is_active)
  const predefinedStrategies = nonArchivedStrategies.filter(s => s.is_predefined)
  const customStrategies = nonArchivedStrategies.filter(s => !s.is_predefined)

  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b] flex flex-col h-[calc(100vh-120px)] overflow-hidden">
      {/* Header - Fixed */}
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border">
              <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Automation</span>
            </div>
            <Badge variant="outline" className="border-border/50">
              <Activity className="h-3 w-3 mr-1" />
              {nonArchivedStrategies.length} Strategies
            </Badge>
          </div>
          <Button
            asChild
            size="sm"
            className="gap-2 rounded-full bg-[#00E0AA] text-slate-950 shadow-lg shadow-[#00E0AA]/30 transition hover:bg-[#00E0AA]/90"
          >
            <Link href="/strategy-builder">
              <Plus className="h-4 w-4" />
              Create Strategy
            </Link>
          </Button>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Strategy Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Manage and monitor all your automated strategies
        </p>
      </div>

      {/* Summary Cards - Fixed */}
      <div className="shrink-0 px-6 py-6 border-b border-border/50">
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Strategies</CardTitle>
              <div className="rounded-full bg-[#00E0AA]/10 p-2">
                <Activity className="h-4 w-4 text-[#00E0AA]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">{nonArchivedStrategies.length}</div>
            <div className="text-sm text-muted-foreground">
              {predefinedStrategies.length} default, {customStrategies.length} custom
            </div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Strategies</CardTitle>
              <div className="rounded-full bg-[#00E0AA]/10 p-2">
                <Zap className="h-4 w-4 text-[#00E0AA]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">{activeStrategies.length}</div>
            <div className="text-sm text-muted-foreground">
              {nonArchivedStrategies.length - activeStrategies.length} paused
            </div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Execution Modes</CardTitle>
              <div className="rounded-full bg-[#00E0AA]/10 p-2">
                <Activity className="h-4 w-4 text-[#00E0AA]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">
              {nonArchivedStrategies.filter(s => s.execution_mode === 'AUTOMATED').length}
            </div>
            <div className="text-sm text-muted-foreground">
              Automated strategies
            </div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Strategy Types</CardTitle>
              <div className="rounded-full bg-[#00E0AA]/10 p-2">
                <Workflow className="h-4 w-4 text-[#00E0AA]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">
              {new Set(nonArchivedStrategies.map(s => s.strategy_type)).size}
            </div>
            <div className="text-sm text-muted-foreground">
              Unique strategy types
            </div>
          </CardContent>
        </Card>
      </div>

      </div>

      {/* Strategies List - Scrollable */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <h2 className="text-xl font-semibold tracking-tight mb-4">Your Strategies</h2>

        {nonArchivedStrategies.length === 0 ? (
          <Card className="group overflow-hidden rounded-3xl border-2 border-dashed border-border/60 bg-gradient-to-br from-muted/30 to-muted/10 shadow-sm transition hover:border-[#00E0AA]/60 hover:shadow-xl">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 rounded-full bg-[#00E0AA]/10 p-5 shadow-lg transition group-hover:scale-110 group-hover:shadow-[#00E0AA]/20">
                <Plus className="h-10 w-10 text-[#00E0AA]" />
              </div>
              <h3 className="mb-2 text-lg font-semibold tracking-tight">No strategies yet</h3>
              <p className="mb-6 max-w-md text-sm text-muted-foreground">
                Create your first automated strategy with the Strategy Builder
              </p>
              <Button
                asChild
                className="gap-2 rounded-full bg-[#00E0AA] px-6 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-[#00E0AA]/30 transition hover:bg-[#00E0AA]/90"
              >
                <Link href="/strategy-builder">
                  Get Started
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {nonArchivedStrategies.map((strategy) => (
              <StrategyCard key={strategy.strategy_id} strategy={strategy} />
            ))}

            {/* Create New Strategy Card */}
            <Link href="/strategy-builder" className="block">
              <Card className="h-full group overflow-hidden rounded-2xl border-2 border-dashed border-border/60 bg-gradient-to-br from-muted/30 to-muted/10 shadow-sm transition hover:border-[#00E0AA]/60 hover:shadow-xl cursor-pointer">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center h-full">
                  <div className="mb-4 rounded-full bg-[#00E0AA]/10 p-5 shadow-lg transition group-hover:scale-110 group-hover:shadow-[#00E0AA]/20">
                    <Plus className="h-10 w-10 text-[#00E0AA]" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold tracking-tight">Create New Strategy</h3>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Build a custom automated strategy
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        )}
      </div>
    </Card>
  )
}
