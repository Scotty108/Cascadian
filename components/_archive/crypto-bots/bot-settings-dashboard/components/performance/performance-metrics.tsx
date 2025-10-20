"use client"

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Eye } from "lucide-react"
import { formatCurrency, formatPercentage } from "../../utils"
import type { PerformanceMetrics } from "../../types"

interface PerformanceMetricsProps {
  metrics: PerformanceMetrics
}

export function PerformanceMetrics({ metrics }: PerformanceMetricsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance Metrics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Total Profit</p>
            <p className="text-2xl font-bold text-green-500">{formatCurrency(metrics.totalProfit)}</p>
            <p className="text-sm text-muted-foreground">{formatPercentage(metrics.totalProfitPercentage)} ROI</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Win Rate</p>
            <p className="text-2xl font-bold">{metrics.winRate}%</p>
            <p className="text-sm text-muted-foreground">
              {metrics.winningTrades}/{metrics.totalTrades} trades
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Avg. Profit</p>
            <p className="text-2xl font-bold text-green-500">{formatCurrency(metrics.avgProfit)}</p>
            <p className="text-sm text-muted-foreground">per trade</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Avg. Loss</p>
            <p className="text-2xl font-bold text-red-500">{formatCurrency(metrics.avgLoss)}</p>
            <p className="text-sm text-muted-foreground">per trade</p>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Profit Factor</p>
            <p className="text-sm font-medium">{metrics.profitFactor}</p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Max Drawdown</p>
            <p className="text-sm font-medium text-red-500">{formatPercentage(metrics.maxDrawdown)}</p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Sharpe Ratio</p>
            <p className="text-sm font-medium">{metrics.sharpeRatio}</p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Total Trades</p>
            <p className="text-sm font-medium">{metrics.totalTrades}</p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Avg. Trade Duration</p>
            <p className="text-sm font-medium">{metrics.avgTradeDuration}</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t p-4">
        <Button variant="outline" size="sm" className="w-full">
          <Eye className="mr-2 h-4 w-4" />
          View Detailed Analytics
        </Button>
      </CardFooter>
    </Card>
  )
}
