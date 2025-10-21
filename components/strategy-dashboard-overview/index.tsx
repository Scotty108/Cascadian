"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatPercentage, getStatusColor } from "../strategy-dashboard/utils"
import type { StrategyData } from "../strategy-dashboard/types"
import { TrendingUp, TrendingDown, Workflow, Plus, ArrowRight, ExternalLink } from "lucide-react"
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Workflow className="h-6 w-6" />
            <span>Strategy Dashboard</span>
          </h1>
          <p className="text-muted-foreground">Manage and monitor all your automated strategies</p>
        </div>
        <Button asChild>
          <Link href="/strategy-builder">
            <Plus className="h-4 w-4 mr-2" />
            Create Strategy
          </Link>
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalBalance)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Initial: {formatCurrency(totalInitialBalance)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(totalPnL)}
            </div>
            <div className={`text-xs mt-1 flex items-center ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {totalPnL >= 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
              {formatPercentage(totalPnLPercentage)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Strategies</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeStrategies.length}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Total: {strategies.length} strategies
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(strategies.reduce((sum, s) => sum + s.statistics.winRate, 0) / strategies.length).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Across all strategies
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mini Dashboards */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Your Strategies</h2>
        <div className="space-y-6">
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
              <Card key={strategy.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`h-3 w-3 rounded-full ${getStatusColor(strategy.status)}`} />
                      <div>
                        <CardTitle className="text-lg">{strategy.name}</CardTitle>
                        <CardDescription className="mt-1">
                          {strategy.description}
                        </CardDescription>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/strategies/${strategy.id}`}>
                        View Full Dashboard
                        <ExternalLink className="h-3 w-3 ml-2" />
                      </Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Performance Section */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-muted-foreground">Performance</h4>
                      <div>
                        <div className="text-3xl font-bold">{formatCurrency(strategy.balance)}</div>
                        <div className={`text-sm flex items-center mt-1 ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
                          {isProfitable ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}
                          {formatCurrency(pnl)} ({formatPercentage((pnl / strategy.initialBalance) * 100)})
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 pt-3 border-t">
                        <div>
                          <div className="text-xs text-muted-foreground">Daily</div>
                          <div className="text-sm font-semibold">{formatPercentage(strategy.performance.daily)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Weekly</div>
                          <div className="text-sm font-semibold">{formatPercentage(strategy.performance.weekly)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Mini Chart */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-muted-foreground">7-Day Trend</h4>
                      <svg
                        width={chartWidth}
                        height={chartHeight}
                        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                        className="w-full"
                      >
                        <path
                          d={path}
                          fill="none"
                          stroke={isProfitable ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)"}
                          strokeWidth="2"
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
                              fill={isProfitable ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)"}
                            />
                          )
                        })}
                      </svg>
                    </div>

                    {/* Stats */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-muted-foreground">Statistics</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">Win Rate</div>
                          <div className="text-lg font-bold">{strategy.statistics.winRate}%</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Total Trades</div>
                          <div className="text-lg font-bold">{strategy.statistics.totalTrades}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Active Positions</div>
                          <div className="text-lg font-bold">{strategy.statistics.activePositions}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Profit Factor</div>
                          <div className="text-lg font-bold">{strategy.statistics.profitFactor.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {/* Create New Strategy Card */}
          <Card className="border-dashed hover:border-solid hover:shadow-lg transition-all">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-primary/10 p-4 mb-4">
                <Plus className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Create New Strategy</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Build a custom automated strategy with the Strategy Builder
              </p>
              <Button asChild>
                <Link href="/strategy-builder">
                  Get Started
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
