"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts"
import { Tooltip as RechartsTooltip } from "recharts"
import { mockPerformanceData } from "../data/mock-data"
import type { PerformanceData } from "../types"

type TimePeriod = "24h" | "7d" | "30d" | "90d" | "1y" | "all"
type Metric = "balance" | "profit" | "trades" | "winrate"

export function PerformanceChart() {
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("30d")
  const [selectedMetric, setSelectedMetric] = useState<Metric>("balance")

  // Filter data based on selected time period
  const filteredData = useMemo(() => {
    switch (selectedPeriod) {
      case "24h":
        // Show last 7 data points for 24h view
        return mockPerformanceData.slice(-7)
      case "7d":
        // Show last 14 data points for 7d view
        return mockPerformanceData.slice(-14)
      case "30d":
        // Show last 30 data points for 30d view
        return mockPerformanceData.slice(-30)
      case "90d":
        // Show data from last 3 months
        return mockPerformanceData.slice(-45)
      case "1y":
        // Show all data for 1 year view
        return mockPerformanceData
      case "all":
      default:
        return mockPerformanceData
    }
  }, [selectedPeriod])

  // Get metric configuration
  const metricConfig = useMemo(() => {
    switch (selectedMetric) {
      case "balance":
        return {
          dataKey: "balance" as keyof PerformanceData,
          color: "hsl(var(--primary))",
          formatter: (value: number) => `$${value.toLocaleString()}`,
          label: "Balance",
        }
      case "profit":
        return {
          dataKey: "profit" as keyof PerformanceData,
          color: "hsl(142, 76%, 36%)", // Green color
          formatter: (value: number) => `$${value.toLocaleString()}`,
          label: "Profit",
        }
      case "trades":
        return {
          dataKey: "trades" as keyof PerformanceData,
          color: "hsl(221, 83%, 53%)", // Blue color
          formatter: (value: number) => value.toString(),
          label: "Trades",
        }
      case "winrate":
        return {
          dataKey: "winrate" as keyof PerformanceData,
          color: "hsl(262, 83%, 58%)", // Purple color
          formatter: (value: number) => `${value}%`,
          label: "Win Rate",
        }
      default:
        return {
          dataKey: "balance" as keyof PerformanceData,
          color: "hsl(var(--primary))",
          formatter: (value: number) => `$${value.toLocaleString()}`,
          label: "Balance",
        }
    }
  }, [selectedMetric])

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    if (filteredData.length === 0) return null

    const currentItem = filteredData[filteredData.length - 1]
    const previousItem = filteredData[0]

    if (!currentItem || !previousItem) return null

    const currentValue = currentItem[selectedMetric]
    const previousValue = previousItem[selectedMetric]
    const change = currentValue - previousValue
    const changePercent = previousValue !== 0 ? (change / previousValue) * 100 : 0

    return {
      current: currentValue,
      change,
      changePercent,
      isPositive: change >= 0,
    }
  }, [filteredData, selectedMetric])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Performance Overview</CardTitle>
            {summaryStats && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-bold">{metricConfig.formatter(summaryStats.current)}</span>
                <span className={`text-sm font-medium ${summaryStats.isPositive ? "text-green-600" : "text-red-600"}`}>
                  {summaryStats.isPositive ? "+" : ""}
                  {metricConfig.formatter(summaryStats.change)} ({summaryStats.changePercent.toFixed(1)}%)
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedPeriod} onValueChange={(value: TimePeriod) => setSelectedPeriod(value)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Time period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedMetric} onValueChange={(value: Metric) => setSelectedMetric(value)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Metric" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="balance">Balance</SelectItem>
              <SelectItem value="profit">Profit</SelectItem>
              <SelectItem value="trades">Trades</SelectItem>
              <SelectItem value="winrate">Win Rate</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {filteredData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={filteredData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`${selectedMetric}Gradient`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={metricConfig.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={metricConfig.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                className="text-xs fill-muted-foreground"
                tickFormatter={(value: string) => {
                  const date = new Date(value)
                  if (selectedPeriod === "24h" || selectedPeriod === "7d") {
                    return date.toLocaleDateString([], { month: "short", day: "numeric" })
                  }
                  return date.toLocaleDateString([], { month: "short", day: "numeric" })
                }}
              />
              <YAxis className="text-xs fill-muted-foreground" tickFormatter={metricConfig.formatter} />
              <RechartsTooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length && label) {
                    const data = payload[0].payload as PerformanceData
                    return (
                      <div className="rounded-lg border bg-background p-3 shadow-md">
                        <p className="font-medium">{new Date(label.toString()).toLocaleDateString()}</p>
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-muted-foreground">{metricConfig.label}:</span>
                            <span className="font-medium" style={{ color: metricConfig.color }}>
                              {metricConfig.formatter(data[selectedMetric])}
                            </span>
                          </div>
                          {selectedMetric === "balance" && (
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-sm text-muted-foreground">Profit:</span>
                              <span className="font-medium text-green-500">${data.profit.toLocaleString()}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-muted-foreground">Trades:</span>
                            <span className="font-medium">{data.trades}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-muted-foreground">Win Rate:</span>
                            <span className="font-medium">{data.winrate}%</span>
                          </div>
                        </div>
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Area
                type="monotone"
                dataKey={metricConfig.dataKey}
                stroke={metricConfig.color}
                fillOpacity={1}
                fill={`url(#${selectedMetric}Gradient)`}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            <div className="text-center">
              <p className="text-lg font-medium">No data available</p>
              <p className="text-sm">Try selecting a different time period</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
