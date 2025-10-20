"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { Zap, Pause, TrendingUp, LucideLineChart, Signal } from "lucide-react"
import type { PerformanceStats } from "../types"

interface StatusCardsProps {
  botActive: boolean
  performanceStats: PerformanceStats
}

export function StatusCards({ botActive, performanceStats }: StatusCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Bot Status</p>
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full",
                botActive
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
              )}
            >
              {botActive ? <Zap className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </div>
          </div>
          <div className="mt-3 flex items-baseline">
            <h3 className="text-2xl font-semibold">{botActive ? "Active" : "Paused"}</h3>
            <p className="ml-2 text-sm text-muted-foreground">
              {botActive ? "Monitoring signals" : "Not receiving signals"}
            </p>
          </div>
          <div className="mt-4">
            <Progress
              value={botActive ? 100 : 0}
              className={botActive ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30"}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Success Rate</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline">
            <h3 className="text-2xl font-semibold">{performanceStats.successRate}%</h3>
            <p className="ml-2 text-sm text-muted-foreground">Last 30 days</p>
          </div>
          <div className="mt-4">
            <Progress value={performanceStats.successRate} className="bg-blue-100 dark:bg-blue-900/30" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Avg. Profit</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <LucideLineChart className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline">
            <h3 className="text-2xl font-semibold">{performanceStats.avgProfit}%</h3>
            <p className="ml-2 text-sm text-muted-foreground">Per signal</p>
          </div>
          <div className="mt-4">
            <Progress value={performanceStats.avgProfit * 5} className="bg-green-100 dark:bg-green-900/30" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Active Signals</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
              <Signal className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline">
            <h3 className="text-2xl font-semibold">{performanceStats.activeSignals}</h3>
            <p className="ml-2 text-sm text-muted-foreground">Currently tracking</p>
          </div>
          <div className="mt-4">
            <Progress
              value={(performanceStats.activeSignals / 20) * 100}
              className="bg-purple-100 dark:bg-purple-900/30"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
