"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowUpRight } from "lucide-react"
import { formatCurrency, formatPercentage } from "../utils"
import type { DcaStats } from "../types"

interface StatsOverviewProps {
  stats: DcaStats
}

export function StatsOverview({ stats }: StatsOverviewProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Total Bots</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalBots}</div>
          <p className="text-xs text-muted-foreground">
            {stats.activeBots} active, {stats.totalBots - stats.activeBots} paused
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Total Invested</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(stats.totalInvested)}</div>
          <p className="text-xs text-muted-foreground">Across all DCA strategies</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Average Profit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center">
            <span className="text-2xl font-bold">{formatPercentage(stats.averageProfit)}</span>
            <ArrowUpRight className="ml-2 h-4 w-4 text-green-500" />
          </div>
          <p className="text-xs text-muted-foreground">Based on current market prices</p>
        </CardContent>
      </Card>
    </div>
  )
}
