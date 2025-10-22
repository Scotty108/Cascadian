"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatPercentage, getStatusColor } from "../strategy-dashboard/utils"
import type { StrategyData } from "../strategy-dashboard/types"
import { TrendingUp, TrendingDown, Workflow, Plus, ExternalLink, Activity, Zap } from "lucide-react"
import Link from "next/link"

interface StrategyDashboardOverviewProps {
  strategies: StrategyData[]
}

export function StrategyDashboardOverview({ strategies }: StrategyDashboardOverviewProps) {
  const activeStrategies = strategies.filter(s => s.status === "active")
  const totalBalance = strategies.reduce((sum, s) => sum + s.balance, 0)
  const totalInitialBalance = strategies.reduce((sum, s) => sum + s.initialBalance, 0)
  const totalPnL = totalBalance - totalInitialBalance
  const totalPnLPercentage = (totalPnL / totalInitialBalance) * 100

  return (
    <div className="space-y-8">
      {/* Header with Gradient Background */}
      <div className="relative overflow-hidden rounded-3xl border border-border/40 bg-gradient-to-br from-background via-background to-background p-8 shadow-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(circle at 20% 20%, rgba(0,224,170,0.15), transparent 50%), radial-gradient(circle at 85% 30%, rgba(0,224,170,0.08), transparent 45%)",
          }}
          aria-hidden="true"
        />
        <div className="relative flex items-center justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00E0AA]/10 text-[#00E0AA] shadow-lg shadow-[#00E0AA]/20">
                <Workflow className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Strategy Dashboard</h1>
                <p className="text-muted-foreground">Manage and monitor all your automated strategies</p>
              </div>
            </div>
          </div>
          <Button
            asChild
            className="gap-2 rounded-full bg-[#00E0AA] px-6 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-[#00E0AA]/30 transition hover:bg-[#00E0AA]/90"
          >
            <Link href="/strategy-builder">
              <Plus className="h-4 w-4" />
              Create Strategy
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Value</CardTitle>
              <div className="rounded-full bg-[#00E0AA]/10 p-2">
                <Activity className="h-4 w-4 text-[#00E0AA]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">{formatCurrency(totalBalance)}</div>
            <div className="text-sm text-muted-foreground">
              Initial: {formatCurrency(totalInitialBalance)}
            </div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total P&L</CardTitle>
              <div className={`rounded-full p-2 ${totalPnL >= 0 ? 'bg-[#00E0AA]/10' : 'bg-red-500/10'}`}>
                {totalPnL >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-[#00E0AA]" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500" />
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className={`text-3xl font-bold tracking-tight ${totalPnL >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
              {formatCurrency(totalPnL)}
            </div>
            <div className={`flex items-center text-sm ${totalPnL >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
              {totalPnL >= 0 ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
              {formatPercentage(totalPnLPercentage)}
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
              Total: {strategies.length} strategies
            </div>
          </CardContent>
        </Card>

        <Card className="group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Win Rate</CardTitle>
              <div className="rounded-full bg-[#00E0AA]/10 p-2">
                <Activity className="h-4 w-4 text-[#00E0AA]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold tracking-tight">
              {(strategies.reduce((sum, s) => sum + s.statistics.winRate, 0) / strategies.length).toFixed(1)}%
            </div>
            <div className="text-sm text-muted-foreground">
              Across all strategies
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Strategies List */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Your Strategies</h2>
        <div className="space-y-5">
          {strategies.map((strategy) => {
            const pnl = strategy.balance - strategy.initialBalance
            const isProfitable = pnl >= 0

            // Mini chart data - last 7 points
            const chartData = strategy.performanceData.slice(-7)
            const minBalance = Math.min(...chartData.map(d => d.balance))
            const maxBalance = Math.max(...chartData.map(d => d.balance))
            const range = maxBalance - minBalance || 1

            // Generate mini chart path
            const chartWidth = 200
            const chartHeight = 60
            const path = chartData.map((point, i) => {
              const x = (i / (chartData.length - 1)) * chartWidth
              const y = chartHeight - ((point.balance - minBalance) / range) * chartHeight
              return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
            }).join(' ')

            return (
              <Card
                key={strategy.id}
                className="group overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/40 hover:shadow-xl"
              >
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`mt-1 h-3 w-3 rounded-full ${getStatusColor(strategy.status)} shadow-lg`} />
                      <div className="flex-1 space-y-1">
                        <CardTitle className="text-xl font-semibold tracking-tight">{strategy.name}</CardTitle>
                        <CardDescription className="text-sm">
                          {strategy.description}
                        </CardDescription>
                        <div className="flex items-center gap-2 pt-2">
                          <Badge
                            variant={strategy.status === "active" ? "default" : "secondary"}
                            className={strategy.status === "active" ? "bg-[#00E0AA] text-slate-950 hover:bg-[#00E0AA]/90" : ""}
                          >
                            {strategy.status.toUpperCase()}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            ID: {strategy.id}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" asChild className="shrink-0 gap-2 rounded-full border-border/60 transition hover:border-[#00E0AA]/60 hover:text-[#00E0AA]">
                      <Link href={`/strategies/${strategy.id}`}>
                        View Details
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                    {/* Performance Section */}
                    <div className="space-y-4">
                      <h4 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Performance</h4>
                      <div className="space-y-3">
                        <div>
                          <div className="text-3xl font-bold tracking-tight">{formatCurrency(strategy.balance)}</div>
                          <div className={`mt-1 flex items-center text-sm font-medium ${isProfitable ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                            {isProfitable ? <TrendingUp className="mr-1 h-4 w-4" /> : <TrendingDown className="mr-1 h-4 w-4" />}
                            {formatCurrency(pnl)} ({formatPercentage((pnl / strategy.initialBalance) * 100)})
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 rounded-xl border border-border/50 bg-muted/30 p-4">
                          <div>
                            <div className="text-xs font-medium text-muted-foreground">Daily</div>
                            <div className="text-base font-semibold">{formatPercentage(strategy.performance.daily)}</div>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-muted-foreground">Weekly</div>
                            <div className="text-base font-semibold">{formatPercentage(strategy.performance.weekly)}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Mini Chart */}
                    <div className="space-y-4">
                      <h4 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">7-Day Trend</h4>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                        <svg
                          width={chartWidth}
                          height={chartHeight}
                          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                          className="w-full"
                        >
                          <defs>
                            <linearGradient id={`gradient-${strategy.id}`} x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor={isProfitable ? "rgb(0, 224, 170)" : "rgb(239, 68, 68)"} stopOpacity="0.3" />
                              <stop offset="100%" stopColor={isProfitable ? "rgb(0, 224, 170)" : "rgb(239, 68, 68)"} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <path
                            d={`${path} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`}
                            fill={`url(#gradient-${strategy.id})`}
                          />
                          <path
                            d={path}
                            fill="none"
                            stroke={isProfitable ? "rgb(0, 224, 170)" : "rgb(239, 68, 68)"}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {chartData.map((point, i) => {
                            const x = (i / (chartData.length - 1)) * chartWidth
                            const y = chartHeight - ((point.balance - minBalance) / range) * chartHeight
                            return (
                              <circle
                                key={i}
                                cx={x}
                                cy={y}
                                r="3"
                                fill={isProfitable ? "rgb(0, 224, 170)" : "rgb(239, 68, 68)"}
                              />
                            )
                          })}
                        </svg>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="space-y-4">
                      <h4 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Statistics</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-xl border border-border/50 bg-muted/30 p-3">
                          <div className="text-xs font-medium text-muted-foreground">Win Rate</div>
                          <div className="mt-1 text-xl font-bold">{strategy.statistics.winRate}%</div>
                        </div>
                        <div className="rounded-xl border border-border/50 bg-muted/30 p-3">
                          <div className="text-xs font-medium text-muted-foreground">Total Trades</div>
                          <div className="mt-1 text-xl font-bold">{strategy.statistics.totalTrades}</div>
                        </div>
                        <div className="rounded-xl border border-border/50 bg-muted/30 p-3">
                          <div className="text-xs font-medium text-muted-foreground">Active Positions</div>
                          <div className="mt-1 text-xl font-bold">{strategy.statistics.activePositions}</div>
                        </div>
                        <div className="rounded-xl border border-border/50 bg-muted/30 p-3">
                          <div className="text-xs font-medium text-muted-foreground">Profit Factor</div>
                          <div className="mt-1 text-xl font-bold">{strategy.statistics.profitFactor.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {/* Create New Strategy Card */}
          <Card className="group overflow-hidden rounded-3xl border-2 border-dashed border-border/60 bg-gradient-to-br from-muted/30 to-muted/10 shadow-sm transition hover:border-[#00E0AA]/60 hover:shadow-xl">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 rounded-full bg-[#00E0AA]/10 p-5 shadow-lg transition group-hover:scale-110 group-hover:shadow-[#00E0AA]/20">
                <Plus className="h-10 w-10 text-[#00E0AA]" />
              </div>
              <h3 className="mb-2 text-lg font-semibold tracking-tight">Create New Strategy</h3>
              <p className="mb-6 max-w-md text-sm text-muted-foreground">
                Build a custom automated strategy with the Strategy Builder
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
        </div>
      </div>
    </div>
  )
}
