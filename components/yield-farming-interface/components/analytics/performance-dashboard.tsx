"use client"

import Image from "next/image";
import { BarChart3, TrendingUp, TrendingDown, DollarSign, Percent, Clock } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { XAxis, YAxis, CartesianGrid, ResponsiveContainer, AreaChart, Area } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { formatCurrency, formatPercentage } from "../../utils"
import type { UserFarm, PerformanceMetrics } from "../../types"

interface PerformanceDashboardProps {
  userFarms: UserFarm[]
  totalPortfolioValue: number
  totalRewards: number
}

export function PerformanceDashboard({ userFarms, totalPortfolioValue, totalRewards }: PerformanceDashboardProps) {
  // Mock performance data - in real app this would come from API
  const performanceData = [
    { date: "1D", value: totalPortfolioValue * 0.98, pnl: -2.1 },
    { date: "7D", value: totalPortfolioValue * 0.95, pnl: -5.2 },
    { date: "30D", value: totalPortfolioValue * 0.88, pnl: -12.3 },
    { date: "90D", value: totalPortfolioValue * 0.82, pnl: -18.7 },
    { date: "Now", value: totalPortfolioValue, pnl: 0 },
  ]

  const metrics: PerformanceMetrics = {
    totalReturn: 15.6,
    annualizedReturn: 12.8,
    sharpeRatio: 1.45,
    maxDrawdown: -8.2,
    winRate: 73.5,
    averageHoldTime: 45,
  }

  const totalInvested = userFarms.reduce((sum, farm) => sum + farm.deposited, 0)
  const totalPnL = totalPortfolioValue - totalInvested + totalRewards
  const totalPnLPercentage = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Performance Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total P&L</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalPnL)}</div>
            <div className="flex items-center space-x-1">
              {totalPnLPercentage >= 0 ? (
                <TrendingUp className="h-3 w-3 text-green-500" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              <p className={`text-xs ${totalPnLPercentage >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPercentage(Math.abs(totalPnLPercentage))}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Annualized Return</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPercentage(metrics.annualizedReturn)}</div>
            <p className="text-xs text-muted-foreground">vs {formatPercentage(8.5)} market average</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sharpe Ratio</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.sharpeRatio.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Risk-adjusted returns</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPercentage(metrics.winRate)}</div>
            <p className="text-xs text-muted-foreground">Profitable positions</p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Performance</CardTitle>
          <CardDescription>Historical performance over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ChartContainer
              config={{
                value: {
                  label: "Portfolio Value",
                  color: "hsl(var(--chart-1))",
                },
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={performanceData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--color-value)"
                    fill="var(--color-value)"
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Metrics */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Risk Metrics</CardTitle>
            <CardDescription>Portfolio risk assessment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Max Drawdown</span>
                <Badge variant="outline" className="text-red-600 border-red-600">
                  {formatPercentage(Math.abs(metrics.maxDrawdown))}
                </Badge>
              </div>
              <Progress value={Math.abs(metrics.maxDrawdown)} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Volatility</span>
                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                  12.3%
                </Badge>
              </div>
              <Progress value={12.3} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Beta</span>
                <Badge variant="outline">0.85</Badge>
              </div>
              <Progress value={85} className="h-2" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Farm Performance</CardTitle>
            <CardDescription>Individual farm contributions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {userFarms.map((farm) => {
                const farmPnL = farm.depositValue - farm.deposited + farm.rewards
                const farmPnLPercentage = farm.deposited > 0 ? (farmPnL / farm.deposited) * 100 : 0

                return (
                  <div key={farm.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center space-x-3">
                      <Image src={farm.logo || "/placeholder.svg"} alt={farm.protocol} width={32} height={32} className="h-8 w-8 rounded-full" />
                      <div>
                        <p className="font-medium text-sm">{farm.protocol}</p>
                        <p className="text-xs text-muted-foreground">{farm.asset}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-medium text-sm ${farmPnLPercentage >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {formatCurrency(farmPnL)}
                      </p>
                      <p className={`text-xs ${farmPnLPercentage >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {farmPnLPercentage >= 0 ? "+" : ""}
                        {formatPercentage(farmPnLPercentage)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
