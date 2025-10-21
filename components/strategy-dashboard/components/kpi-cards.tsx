"use client"

import { ArrowDown, ArrowUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatPercentage } from "../utils"
import type { StrategyData } from "../types"

interface KpiCardsProps {
  strategyData: StrategyData
}

export function KpiCards({ strategyData }: KpiCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Portfolio Value */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Portfolio Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(strategyData.balance)}</div>
          <div className="flex items-center text-xs text-muted-foreground mt-1">
            <Badge variant={strategyData.performance.daily >= 0 ? "default" : "destructive"} className="mr-1">
              <span className="flex items-center">
                {strategyData.performance.daily >= 0 ? (
                  <ArrowUp className="mr-1 h-3 w-3" />
                ) : (
                  <ArrowDown className="mr-1 h-3 w-3" />
                )}
                {formatPercentage(strategyData.performance.daily)}
              </span>
            </Badge>
            <span>Today</span>
          </div>
        </CardContent>
      </Card>

      {/* Total Profit */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total Profit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatPercentage(strategyData.performance.total)}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <span>Monthly: {formatPercentage(strategyData.performance.monthly)}</span>
            <span>Weekly: {formatPercentage(strategyData.performance.weekly)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Win Rate */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Win Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{strategyData.statistics.winRate}%</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <span>Wins: {strategyData.statistics.winningTrades}</span>
            <span>Losses: {strategyData.statistics.losingTrades}</span>
          </div>
        </CardContent>
      </Card>

      {/* Active Positions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Active Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{strategyData.statistics.activePositions}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <span>Total Trades: {strategyData.statistics.totalTrades}</span>
            <span>Closed: {strategyData.statistics.closedPositions}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
