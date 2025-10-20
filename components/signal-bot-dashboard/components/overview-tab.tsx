"use client"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Info, Sliders, Eye } from "lucide-react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts"
import type { PerformanceStats, Signal } from "../types"
import { formatDate, getProfitColor, getStatusColor, getSignalTypeColor } from "../utils"

interface OverviewTabProps {
  performanceStats: PerformanceStats
  recentSignals: Signal[]
  autoTrade: boolean
  riskLevel: number[]
  chartData: any[]
  onAutoTradeChange: (checked: boolean) => void
  onRiskLevelChange: (value: number[]) => void
  onShowAdvancedSettings: () => void
}

export function OverviewTab({
  performanceStats,
  recentSignals,
  autoTrade,
  riskLevel,
  chartData,
  onAutoTradeChange,
  onRiskLevelChange,
  onShowAdvancedSettings,
}: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Performance Overview</CardTitle>
            <CardDescription>Signal bot performance over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[240px] w-full">
              <ChartContainer
                config={{
                  profit: {
                    label: "Profit",
                    color: "hsl(var(--chart-1))",
                  },
                  signals: {
                    label: "Signals",
                    color: "hsl(var(--chart-2))",
                  },
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="profit" stroke="var(--color-profit)" name="Profit %" />
                    <Line type="monotone" dataKey="signals" stroke="var(--color-signals)" name="Signals" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Signals</p>
                <p className="mt-1 text-xl font-semibold">{performanceStats.totalSignals}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Completed</p>
                <p className="mt-1 text-xl font-semibold">{performanceStats.completedSignals}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Stopped</p>
                <p className="mt-1 text-xl font-semibold">{performanceStats.stoppedSignals}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Auto-Trading Status</CardTitle>
            <CardDescription>Configure your auto-trading settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-medium">Auto-Trading</h4>
                <p className="text-sm text-muted-foreground">Automatically execute trades based on signals</p>
              </div>
              <Switch checked={autoTrade} onCheckedChange={onAutoTradeChange} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Risk Level</h4>
                <span className="text-sm font-medium">{riskLevel[0]}%</span>
              </div>
              <Slider
                value={riskLevel}
                onValueChange={onRiskLevelChange}
                max={100}
                step={1}
                className={cn(
                  riskLevel[0] < 30
                    ? "bg-green-100 dark:bg-green-900/30"
                    : riskLevel[0] < 70
                      ? "bg-yellow-100 dark:bg-yellow-900/30"
                      : "bg-red-100 dark:bg-red-900/30",
                )}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Conservative</span>
                <span>Balanced</span>
                <span>Aggressive</span>
              </div>
            </div>

            <div className="rounded-md border p-4">
              <div className="flex items-start gap-4">
                <div className="rounded-full bg-yellow-100 p-2 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                  <Info className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Auto-Trading is {autoTrade ? "enabled" : "disabled"}</p>
                  <p className="text-xs text-muted-foreground">
                    {autoTrade
                      ? "Your bot will automatically execute trades based on received signals according to your risk settings."
                      : "Enable auto-trading to automatically execute trades based on signals."}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full gap-2" onClick={onShowAdvancedSettings}>
              <Sliders className="h-4 w-4" />
              <span>Advanced Settings</span>
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Signals</CardTitle>
            <CardDescription>Latest trading signals from your providers</CardDescription>
          </div>
          
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-sm:pb-2">

          <div className="space-y-4 min-w-[450px]">
            {recentSignals.slice(0, 5).map((signal) => (
              <div key={signal.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={signal.providerAvatar || "/placeholder.svg"} alt={signal.provider} />
                    <AvatarFallback>{signal.provider.substring(0, 2)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{signal.asset}</p>
                      <Badge variant="outline" className={cn("text-xs", getSignalTypeColor(signal.type))}>
                        {signal.type}
                      </Badge>
                      <Badge variant="outline" className={cn("text-xs", getStatusColor(signal.status))}>
                        {signal.status.charAt(0).toUpperCase() + signal.status.slice(1)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>From: {signal.provider}</span>
                      <span>•</span>
                      <span>Confidence: {signal.confidence}%</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  {signal.profit !== null ? (
                    <div className={cn("font-medium", getProfitColor(signal.profit))}>
                      {signal.profit > 0 ? "+" : ""}
                      {signal.profit}%
                    </div>
                  ) : (
                    <div className="font-medium">In Progress</div>
                  )}
                  <div className="text-xs text-muted-foreground">{formatDate(signal.timestamp)}</div>
                </div>
              </div>
            ))}
          </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
